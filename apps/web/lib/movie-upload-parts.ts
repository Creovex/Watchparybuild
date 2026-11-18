import { movieCall } from './movie-api';
import { uploadPart } from './movie-part-upload';
const PART = 16 * 1024 * 1024;

export function movieUploadConcurrency(): number {
  if (typeof navigator === 'undefined') return 6;
  const device = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  if (device.connection?.saveData || ['slow-2g', '2g'].includes(device.connection?.effectiveType ?? '') ||
      (device.deviceMemory !== undefined && device.deviceMemory <= 2)) return 2;
  return 6;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Stopped', 'AbortError'));
      return;
    }
    const stop = () => {
      clearTimeout(id);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    const id = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
export async function uploadMovieParts(
  id: string,
  file: File,
  signal: AbortSignal,
  progress: (bytes: number, total: number) => void,
  concurrency = movieUploadConcurrency(),
) {
  concurrency = Math.max(1, Math.min(6, Math.floor(concurrency) || 1));
  const count = Math.ceil(file.size / PART);
  let completed = 0;
  const inFlight = new Map<number, number>();
  const report = () => progress(
    Math.min(file.size, completed + [...inFlight.values()].reduce((sum, bytes) => sum + bytes, 0)),
    file.size,
  );
  for (let first = 1; first <= count; first += 50) {
    signal.throwIfAborted();
    const requested = Array.from({ length: Math.min(50, count - first + 1) }, (_, i) => first + i);
    const batch = await movieCall<{
      urls: Record<string, string>;
      uploaded: { part_number: number; size: number; etag: string }[];
    }>('movie-upload-urls', { movie_id: id, part_numbers: requested });
    const uploaded = new Map(batch.uploaded.map((p) => [p.part_number, p]));
    const pending = requested.filter((p) => {
      const found = uploaded.get(p);
      if (found?.size === Math.min(PART, file.size - (p - 1) * PART)) {
        completed += found.size;
        return false;
      }
      return true;
    });
    report();
    let cursor = 0;
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
        while (cursor < pending.length) {
          const part = pending[cursor++];
          if (!part) break;
          const blob = file.slice((part - 1) * PART, Math.min(file.size, part * PART));
          let url = batch.urls[String(part)];
          if (!url) throw new Error('An upload URL was missing.');
          let success = false;
          for (let attempt = 0; attempt <= 5; attempt++) {
            signal.throwIfAborted();
            try {
              const response = await uploadPart(url, blob, signal, (bytes) => {
                inFlight.set(part, bytes);
                report();
              });
              if (response.status >= 200 && response.status < 300 && response.etag) {
                success = true;
                break;
              }
              if (response.status === 403) {
                const refreshed = await movieCall<{ urls: Record<string, string> }>('movie-upload-urls', {
                  movie_id: id,
                  part_numbers: [part],
                });
                url = refreshed.urls[String(part)] ?? url;
              }
            } catch (error) {
              if (signal.aborted) { inFlight.delete(part); report(); throw error; }
            }
            inFlight.delete(part);
            report();
            if (attempt < 5) await sleep(1000 * 2 ** attempt, signal);
          }
          if (!success)
            throw new Error('The upload connection stopped. Press Resume upload to try again with the same file.');
          inFlight.delete(part);
          completed += blob.size;
          report();
        }
      }),
    );
    const failed = workers.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
