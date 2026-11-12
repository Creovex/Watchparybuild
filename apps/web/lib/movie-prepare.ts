import {
  BlobSource, Conversion, Input, MATROSKA, Mp4OutputFormat, Output, StreamTarget,
} from 'mediabunny';

export interface PreparedMovie {
  file: File;
  release: () => Promise<void>;
}

const MAX_SIZE = 5 * 1024 ** 3;
const UNSUPPORTED = 'This MKV uses a codec this device cannot convert. Try Chrome on a computer, or convert it to MP4 with H.264 video and AAC sound.';

async function sourceKey(file: File) {
  const bytes = await new Blob([
    JSON.stringify([file.name, file.size, file.lastModified]),
    file.slice(0, 1024 * 1024),
    file.slice(Math.max(0, file.size - 1024 * 1024)),
  ]).arrayBuffer();
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Keep one disk-backed result per uploader. The completed copy survives a reload so
// multipart recovery uses exactly the same bytes, even when encoding isn't deterministic.
export async function prepareMovie(
  source: File,
  owner: string,
  signal: AbortSignal,
  progress: (message: string, fraction?: number) => void,
): Promise<PreparedMovie> {
  if (!/\.mkv$/i.test(source.name)) return { file: source, release: async () => {} };
  if (!navigator.locks) throw new Error('MKV preparation needs a newer browser. Try the latest Chrome.');
  return navigator.locks.request(`synvello-mkv:${owner}`, { signal }, () =>
    prepareMkv(source, owner, signal, progress));
}

async function prepareMkv(
  source: File,
  owner: string,
  signal: AbortSignal,
  progress: (message: string, fraction?: number) => void,
): Promise<PreparedMovie> {
  if (!source.size || source.size > MAX_SIZE) throw new Error('Choose a movie smaller than 5 GiB.');
  signal.throwIfAborted();
  progress('Reading MKV…');
  const key = await sourceKey(source);
  signal.throwIfAborted();
  let directory: FileSystemDirectoryHandle;
  try {
    const root = await navigator.storage.getDirectory();
    const cache = await root.getDirectoryHandle('synvello-mkv', { create: true });
    directory = await cache.getDirectoryHandle(owner, { create: true });
  } catch {
    throw new Error('MKV preparation needs temporary device storage. Use a regular browser window with free disk space.');
  }
  const release = async () => {
    await Promise.allSettled(['movie.mp4', 'ready.json'].map((name) => directory.removeEntry(name)));
  };
  const prepared = async (): Promise<PreparedMovie> => ({
    file: new File([await (await directory.getFileHandle('movie.mp4')).getFile()],
      source.name.replace(/\.mkv$/i, '.mp4'), { type: 'video/mp4', lastModified: source.lastModified }),
    release,
  });
  try {
    const record = JSON.parse(await (await (await directory.getFileHandle('ready.json')).getFile()).text());
    if (record.key === key) {
      const result = await prepared();
      if (result.file.size === record.size && result.file.size > 0) return result;
    }
  } catch {
    // Missing or interrupted preparation: regenerate instead of using partial bytes.
  }
  await release();
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(source), formats: [MATROSKA] });
  let conversion: Conversion | undefined;
  let writable: FileSystemWritableFileStream | undefined;
  const stop = () => { void conversion?.cancel(); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) throw new Error('This MKV does not contain a video track.');
    const videoCodec = await video.getCodec();
    const audioCodec = await audio?.getCodec();
    if (videoCodec !== 'avc' && !(await video.canDecode())) throw new Error(UNSUPPORTED);
    if (audio && audioCodec !== 'aac') {
      if (audioCodec === 'ac3' || audioCodec === 'eac3')
        (await import('@mediabunny/ac3')).registerAc3Decoder();
      if (audioCodec === 'dts') (await import('@mediabunny/dts')).registerDtsDecoder();
      if (audioCodec === 'truehd') (await import('@mediabunny/truehd')).registerTrueHdDecoder();
      (await import('@mediabunny/aac-encoder')).registerAacEncoder();
    }
    signal.throwIfAborted();
    const handle = await directory.getFileHandle('movie.mp4', { create: true });
    writable = await handle.createWritable();
    let size = 0;
    const stream = writable;
    const target = new StreamTarget(new WritableStream({
      async write(chunk) {
        signal.throwIfAborted();
        size = Math.max(size, chunk.position + chunk.data.byteLength);
        if (size > MAX_SIZE) throw new Error('The prepared movie exceeds the 5 GiB upload limit.');
        await stream.write(chunk);
      },
    }), { chunked: true, chunkSize: 4 * 1024 * 1024 });
    conversion = await Conversion.init({
      input,
      output: new Output({ target, format: new Mp4OutputFormat({ fastStart: 'reserve' }) }),
      tracks: 'primary',
      video: { codec: 'avc' },
      audio: { codec: 'aac', ...(audioCodec !== 'aac' ? { numberOfChannels: 2, bitrate: 192000 } : {}) },
      // Do not propagate untrusted attachments or movie metadata into the prepared file.
      tags: {},
      showWarnings: false,
    });
    // Never silently upload a picture with its original sound missing.
    if (!conversion.isValid || !conversion.utilizedTracks.includes(video) ||
        (audio && !conversion.utilizedTracks.includes(audio))) throw new Error(UNSUPPORTED);
    signal.throwIfAborted();
    conversion.onProgress = (fraction) => progress(`Preparing MKV for playback… ${Math.floor(fraction * 100)}%`, Math.max(0, Math.min(1, fraction)));
    await conversion.execute();
    signal.throwIfAborted();
    await writable.close();
    writable = undefined;
    const result = await prepared();
    const manifest = await (await directory.getFileHandle('ready.json', { create: true })).createWritable();
    await manifest.write(JSON.stringify({ key, size: result.file.size }));
    await manifest.close();
    return result;
  } catch (error) {
    await conversion?.cancel().catch(() => {});
    await writable?.abort().catch(() => {});
    await release();
    signal.throwIfAborted();
    if (error instanceof DOMException && error.name === 'QuotaExceededError')
      throw new Error('There is not enough free device storage to prepare this MKV. Free some space and try again.');
    throw error instanceof Error ? error : new Error('This MKV could not be prepared.');
  } finally {
    signal.removeEventListener('abort', stop);
    input.dispose();
  }
}
