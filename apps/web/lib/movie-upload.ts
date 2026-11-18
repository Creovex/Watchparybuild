import { movieCall } from './movie-api';
import { uploadMovieParts } from './movie-upload-parts';
import type { MovieDetails } from './movie-check';
interface SavedUpload {
  movie_id: string;
  name: string;
  size: number;
  lastModified: number;
  fingerprint: string;
  title?: string;
  compression?: boolean;
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
export async function uploadMovie(args: {
  owner: string;
  file: File;
  title: string;
  details: MovieDetails;
  resumeId?: string;
  compression?: boolean;
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
      compression: args.compression,
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
  await uploadMovieParts(id, file, signal, args.progress);
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
