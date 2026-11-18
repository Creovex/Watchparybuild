import {
  BlobSource, Conversion, Input, ALL_FORMATS, Mp4OutputFormat, Output, StreamTarget,
} from 'mediabunny';

export interface PreparedMovie {
  file: File;
  release: () => Promise<void>;
}

export class MoviePreparationStorageError extends Error {
  override name = 'MoviePreparationStorageError';
}

const MAX_SIZE = 5 * 1024 ** 3;
const UNSUPPORTED = 'This movie uses a codec this device cannot convert. Try Chrome on a computer, or convert it to MP4 with H.264 video and AAC sound.';

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
  destination?: FileSystemFileHandle,
  compress = false,
): Promise<PreparedMovie> {
  if (!compress && !/\.mkv$/i.test(source.name)) return { file: source, release: async () => {} };
  if (!navigator.locks) throw new Error('MKV preparation needs a newer browser. Try the latest Chrome.');
  return navigator.locks.request(`synvello-mkv:${owner}`, { signal }, () =>
    prepareMkv(source, owner, signal, progress, destination, compress));
}

async function prepareMkv(
  source: File,
  owner: string,
  signal: AbortSignal,
  progress: (message: string, fraction?: number) => void,
  destination?: FileSystemFileHandle,
  compress = false,
): Promise<PreparedMovie> {
  if (!source.size || source.size > MAX_SIZE) throw new Error('Choose a movie smaller than 5 GiB.');
  signal.throwIfAborted();
  progress(compress ? 'Reading movie for compression…' : 'Reading MKV…');
  const key = (await sourceKey(source)) + (compress ? ':720p-1500k-v1' : '');
  signal.throwIfAborted();
  let directory: FileSystemDirectoryHandle | undefined;
  if (!destination) {
    try {
      const root = await navigator.storage.getDirectory();
      const cache = await root.getDirectoryHandle('synvello-mkv', { create: true });
      directory = await cache.getDirectoryHandle(owner, { create: true });
    } catch {
      throw new MoviePreparationStorageError('Browser temporary storage is unavailable. This is separate from your Synvello storage allowance. Try preparing using a folder in Chrome or Edge on a computer.');
    }
  } else if (!/\.mp4$/i.test(destination.name)) {
    throw new Error('Save the prepared movie with an .mp4 filename.');
  }
  const release = async () => {
    // User-selected output belongs to the user and must survive upload/cancellation.
    if (directory) await Promise.allSettled(['movie.mp4', 'ready.json'].map((name) => directory!.removeEntry(name)));
  };
  const prepared = async (): Promise<PreparedMovie> => {
    const disk = await (destination ?? await directory!.getFileHandle('movie.mp4')).getFile();
    return {
      file: new File([disk], destination ? disk.name : source.name.replace(/\.[^.]+$/, '.mp4'),
        { type: 'video/mp4', lastModified: destination ? disk.lastModified : source.lastModified }),
      release,
    };
  };
  if (directory) try {
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
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  let conversion: Conversion | undefined;
  let writable: FileSystemWritableFileStream | undefined;
  const stop = () => { void conversion?.cancel(); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) throw new Error('This movie does not contain a video track.');
    const videoCodec = await video.getCodec();
    const audioCodec = await audio?.getCodec();
    if ((compress || videoCodec !== 'avc') && !(await video.canDecode())) throw new Error(UNSUPPORTED);
    if (audio && (compress || audioCodec !== 'aac')) {
      if (audioCodec === 'ac3' || audioCodec === 'eac3')
        (await import('@mediabunny/ac3')).registerAc3Decoder();
      if (audioCodec === 'dts') (await import('@mediabunny/dts')).registerDtsDecoder();
      if (audioCodec === 'truehd') (await import('@mediabunny/truehd')).registerTrueHdDecoder();
      (await import('@mediabunny/aac-encoder')).registerAacEncoder();
    }
    signal.throwIfAborted();
    const handle = destination ?? await directory!.getFileHandle('movie.mp4', { create: true });
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
      video: { codec: 'avc', ...(compress ? { forceTranscode: true, bitrate: 1500000, height: Math.max(2, Math.floor(Math.min(720, await video.getDisplayHeight()) / 2) * 2) } : {}) },
      audio: { codec: 'aac', ...(compress || audioCodec !== 'aac' ? { forceTranscode: true, numberOfChannels: 2, bitrate: compress ? 128000 : 192000 } : {}) },
      // Do not propagate untrusted attachments or movie metadata into the prepared file.
      tags: {},
      showWarnings: false,
    });
    // Never silently upload a picture with its original sound missing.
    if (!conversion.isValid || !conversion.utilizedTracks.includes(video) ||
        (audio && !conversion.utilizedTracks.includes(audio))) throw new Error(UNSUPPORTED);
    signal.throwIfAborted();
    conversion.onProgress = (fraction) => progress(`${compress ? 'Compressing movie' : 'Preparing MKV for playback'}… ${Math.floor(fraction * 100)}%`, Math.max(0, Math.min(1, fraction)));
    await conversion.execute();
    signal.throwIfAborted();
    await writable.close();
    writable = undefined;
    const result = await prepared();
    if (directory) {
      const manifest = await (await directory.getFileHandle('ready.json', { create: true })).createWritable();
      try {
        await manifest.write(JSON.stringify({ key, size: result.file.size }));
        await manifest.close();
      } catch (error) {
        await manifest.abort().catch(() => {});
        throw error;
      }
    }
    return result;
  } catch (error) {
    await conversion?.cancel().catch(() => {});
    await writable?.abort().catch(() => {});
    await release();
    signal.throwIfAborted();
    if (error instanceof DOMException && error.name === 'QuotaExceededError')
      throw new MoviePreparationStorageError(destination
        ? 'The selected disk cannot store the prepared MP4. Choose a folder on a disk with more free space.'
        : 'The browser ran out of temporary storage while preparing this movie. This is separate from your Synvello storage allowance. Choose Prepare using a folder in Chrome or Edge on a computer, or free device space and try again.');
    throw error instanceof Error ? error : new Error('This MKV could not be prepared.');
  } finally {
    signal.removeEventListener('abort', stop);
    input.dispose();
  }
}
