import { createFile, type MP4BoxBuffer, type Movie } from 'mp4box';

export interface MovieDetails {
  content_type: 'video/mp4' | 'video/webm';
  duration_sec: number;
  width: number;
  height: number;
  poster: Blob | null;
  slowStart: boolean;
}
const CONVERT =
  "This file's video or sound format is unsupported. Convert it to MP4 with H.264 video and AAC sound, then try again.";
export function allowedCodecs(type: string, video: string[], audio: string[]): boolean {
  return (
    video.length > 0 &&
    video.every((c) => (type === 'video/mp4' ? /^avc[13](\.|$)/i.test(c) : ['V_VP9', 'V_AV1'].includes(c))) &&
    audio.every((c) => (type === 'video/mp4' ? /^mp4a\.40\.(2|5|29)$/.test(c) : c === 'A_OPUS'))
  );
}
export function webmCodecs(bytes: Uint8Array): { video: string[]; audio: string[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let doc = '';
  const tracks: { type: number; codec: string }[] = [];
  function vint(at: number, id = false): { value: number; length: number; unknown: boolean } {
    const first = bytes[at];
    if (!first) throw new Error(CONVERT);
    let length = 1;
    while (length <= 8 && !(first & (1 << (8 - length)))) length++;
    if (length > 8 || at + length > bytes.length) throw new Error(CONVERT);
    let value = id ? first : first & ((1 << (8 - length)) - 1);
    let unknown = !id && value === (1 << (8 - length)) - 1;
    for (let i = 1; i < length; i++) {
      value = value * 256 + view.getUint8(at + i);
      unknown = unknown && view.getUint8(at + i) === 255;
    }
    return { value, length, unknown };
  }
  function walk(start: number, end: number, track?: { type: number; codec: string }, depth = 0) {
    if (depth > 4) throw new Error(CONVERT);
    let at = start;
    while (at < end) {
      const id = vint(at, true);
      const size = vint(at + id.length);
      const body = at + id.length + size.length;
      const stop = size.unknown ? end : Math.min(end, body + size.value);
      if (stop < body) throw new Error(CONVERT);
      if (id.value === 0x4282) doc = new TextDecoder().decode(bytes.subarray(body, stop));
      if (id.value === 0x1a45dfa3 || id.value === 0x18538067 || id.value === 0x1654ae6b)
        walk(body, stop, track, depth + 1);
      if (id.value === 0xae) {
        const current = { type: 0, codec: '' };
        walk(body, stop, current, depth + 1);
        tracks.push(current);
      }
      if (track && id.value === 0x83) {
        track.type = 0;
        for (let i = body; i < stop; i++) track.type = track.type * 256 + bytes[i]!;
      }
      if (track && id.value === 0x86) track.codec = new TextDecoder().decode(bytes.subarray(body, stop));
      if (id.value === 0x1f43b675) break;
      at = stop;
    }
  }
  walk(0, bytes.length);
  if (doc !== 'webm' || tracks.some((t) => ![1, 2].includes(t.type))) throw new Error(CONVERT);
  return {
    video: tracks.filter((t) => t.type === 1).map((t) => t.codec),
    audio: tracks.filter((t) => t.type === 2).map((t) => t.codec),
  };
}
async function mp4Info(file: File): Promise<{ info: Movie; slowStart: boolean }> {
  const parser = createFile();
  let info: Movie | null = null;
  let failed = false;
  let at = 0;
  let read = 0;
  let skippedMedia = false;
  parser.onReady = (ready) => {
    info = ready;
  };
  parser.onError = () => {
    failed = true;
  };
  while (!info && !failed && at < file.size && read < 32 * 1024 * 1024) {
    const raw = await file.slice(at, Math.min(file.size, at + 1024 * 1024)).arrayBuffer();
    const buffer = raw as MP4BoxBuffer;
    buffer.fileStart = at;
    const next = parser.appendBuffer(buffer);
    read += raw.byteLength;
    if (next > at + raw.byteLength) skippedMedia = true;
    at = Number.isFinite(next) && next > at ? next : at + raw.byteLength;
  }
  parser.flush();
  if (!info || failed) throw new Error(CONVERT);
  return { info, slowStart: skippedMedia };
}
function wait(video: HTMLVideoElement, event: string, work: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener('error', bad);
    };
    const ok = () => {
      done();
      resolve();
    };
    const bad = () => {
      done();
      reject(new Error(CONVERT));
    };
    const timer = setTimeout(bad, 15000);
    video.addEventListener(event, ok, { once: true });
    video.addEventListener('error', bad, { once: true });
    work();
  });
}
export async function checkMovie(file: File): Promise<MovieDetails> {
  const type = /\.(mp4|m4v)$/i.test(file.name)
    ? 'video/mp4'
    : /\.webm$/i.test(file.name)
      ? 'video/webm'
      : null;
  if (!type) throw new Error('Choose an MP4 or WebM file.');
  if (file.size < 1 || file.size > 5 * 1024 ** 3) throw new Error('Choose a movie smaller than 5 GiB.');
  let slowStart = false;
  let browserCodecs: string[] = [];
  if (type === 'video/mp4') {
    let parsed: Awaited<ReturnType<typeof mp4Info>>;
    try {
      parsed = await mp4Info(file);
    } catch {
      throw new Error(CONVERT);
    }
    slowStart = parsed.slowStart;
    browserCodecs = [
      ...parsed.info.videoTracks.map((t) => t.codec),
      ...parsed.info.audioTracks.map((t) => t.codec),
    ];
    if (
      !allowedCodecs(
        type,
        parsed.info.videoTracks.map((t) => t.codec),
        parsed.info.audioTracks.map((t) => t.codec),
      )
    )
      throw new Error(CONVERT);
  } else {
    const tracks = webmCodecs(new Uint8Array(await file.slice(0, 8 * 1024 * 1024).arrayBuffer()));
    browserCodecs = [
      ...tracks.video.map((c) => (c === 'V_AV1' ? 'av01.0.00M.08' : 'vp9')),
      ...tracks.audio.map(() => 'opus'),
    ];
    if (!allowedCodecs(type, tracks.video, tracks.audio)) throw new Error(CONVERT);
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (!video.canPlayType(`${type}; codecs="${browserCodecs.join(',')}"`)) throw new Error(CONVERT);
  const url = URL.createObjectURL(file);
  try {
    await wait(video, 'loadeddata', () => {
      video.src = url;
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth)
      throw new Error(CONVERT);
    let poster: Blob | null = null;
    try {
      await wait(video, 'seeked', () => {
        video.currentTime = Math.min(video.duration * 0.1, video.duration - 0.01);
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(640, video.videoWidth);
      canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.6, 0.4]) {
        poster = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (poster && poster.size <= 300000) break;
        poster = null;
      }
    } catch {
      /* A missing poster does not reject a compatible movie. */
    }
    return {
      content_type: type,
      duration_sec: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      poster,
      slowStart,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
