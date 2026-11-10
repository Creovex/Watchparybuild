import { movieCall } from './movie-api';
import type { MovieDetails } from './movie-check';
const PART = 16 * 1024 * 1024;
interface SavedUpload {
  movie_id: string;
  name: string;
  size: number;
  lastModified: number;
  fingerprint: string;
  title?: string;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('synvello-uploads', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('uploads');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Upload recovery storage is unavailable.'));
  });
}
export async function uploadRecord(owner: string, value?: SavedUpload | null): Promise<SavedUpload | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('uploads', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('uploads');
      const req =
        value === undefined
          ? store.get(owner)
          : value === null
            ? store.delete(owner)
            : store.put(value, owner);
      let result: SavedUpload | null = null;
      req.onsuccess = () => {
        result = value === undefined ? (req.result ?? null) : (value ?? null);
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(new Error('Upload recovery storage could not be saved.'));
      tx.onabort = () => reject(new Error('Upload recovery storage could not be saved.'));
    });
  } finally {
    db.close();
  }
}
async function fingerprint(file: File) {
  const bytes = await new Blob([
    file.slice(0, 1024 * 1024),
    file.slice(Math.max(0, file.size - 1024 * 1024)),
  ]).arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
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
export async function uploadMovie(args: {
  owner: string;
  file: File;
  title: string;
  details: MovieDetails;
  resumeId?: string;
  signal: AbortSignal;
  progress: (bytes: number, total: number) => void;
}) {
  const { owner, file, signal } = args;
  const hash = await fingerprint(file);
  const old = await uploadRecord(owner);
  let id = args.resumeId ?? crypto.randomUUID();
  if (args.resumeId) {
    if (
      !old ||
      old.movie_id !== args.resumeId ||
      old.name !== file.name ||
      old.size !== file.size ||
      old.lastModified !== file.lastModified ||
      old.fingerprint !== hash
    )
      throw new Error(
        'Choose the same file in the browser where this upload started, or cancel it and start again.',
      );
  } else {
    await uploadRecord(owner, {
      movie_id: id,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      fingerprint: hash,
      title: args.title,
    });
  }
  // Reconcile a reservation whose initial storage request may have been interrupted.
  await movieCall('movie-upload-start', {
    movie_id: id,
    title: args.resumeId ? (old?.title ?? args.title) : args.title,
    size_bytes: file.size,
    content_type: args.details.content_type,
    duration_sec: args.details.duration_sec,
    width: args.details.width,
    height: args.details.height,
  });
  const count = Math.ceil(file.size / PART);
  let completed = 0;
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
    args.progress(completed, file.size);
    let cursor = 0;
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(3, pending.length) }, async () => {
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
              const response = await fetch(url, { method: 'PUT', body: blob, signal });
              if (response.ok && response.headers.get('ETag')) {
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
              if (signal.aborted) throw error;
            }
            if (attempt < 5) await sleep(1000 * 2 ** attempt, signal);
          }
          if (!success)
            throw new Error('The connection stopped. Choose this file again to resume the upload.');
          completed += blob.size;
          args.progress(completed, file.size);
        }
      }),
    );
    const failed = workers.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  signal.throwIfAborted();
  await movieCall('movie-upload-complete', { movie_id: id });
  try {
    await uploadRecord(owner, null);
  } catch {
    /* The movie is already committed; local recovery cleanup is optional. */
  }
  if (args.details.poster) {
    try {
      const { error } = await (await import('./supabase/client'))
        .getBrowserClient()
        .storage.from('posters')
        .upload(`${owner}/${id}.jpg`, args.details.poster, { contentType: 'image/jpeg', upsert: true });
      if (!error)
        await (await import('./supabase/client'))
          .getBrowserClient()
          .rpc('movie_set_poster', { movie_id: id });
    } catch {
      /* Playback is ready even if the optional poster failed. */
    }
  }
  return id;
}
