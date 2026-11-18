'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RoomApi } from '@watchparty/ui/room';
import { Sheet } from '@watchparty/ui';
import { getBrowserClient } from '@/lib/supabase/client';
import { movieCall, type Movie } from '@/lib/movie-api';
import { checkMovie, type MovieDetails } from '@/lib/movie-check';
import type { PreparedMovie } from '@/lib/movie-prepare';
import { uploadMovie, uploadRecord } from '@/lib/movie-upload';
import { useWakeLock } from '@/lib/use-wake-lock';
import { errorSentence } from '@/lib/errors';
const button = 'rounded-lg bg-amber px-4 py-3 font-semibold text-amber-ink disabled:opacity-50';
const gb = (n: number) => (n / 1e9).toFixed(2) + ' GB';
type Usage = {
  quota: number;
  used: number;
  site_used: number;
  site_cap: number;
};
export function Movies({ owner }: { owner: string }) {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<File[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [compress, setCompress] = useState(false);
  const [compressionUsed, setCompressionUsed] = useState(false);
  const [originalSize, setOriginalSize] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [storageRetry, setStorageRetry] = useState<{ source: File; resumeId?: string } | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const operation = useRef(false);
  const [paused, setPaused] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [details, setDetails] = useState<MovieDetails | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [preparation, setPreparation] = useState('');
  const [preparationFraction, setPreparationFraction] = useState<number | undefined>();
  const [progress, setProgress] = useState({ bytes: 0, total: 0, start: 0 });
  const [resume, setResume] = useState<string | undefined>();
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);
  const prepareAbort = useRef<AbortController | null>(null);
  const prepared = useRef<PreparedMovie | null>(null);
  const selection = useRef(0);
  useWakeLock(busy || checking);
  const refresh = useCallback(async () => {
    try {
      const db = getBrowserClient();
      const [list, meter] = await Promise.all([
        db
          .from('movie_library')
          .select('*')
          .neq('status', 'failed')
          .order('created_at', { ascending: false }),
        db.rpc('movie_usage'),
      ]);
      if (list.error || meter.error || !meter.data?.ok) {
        setLibraryError('Your movie library could not load. Try again shortly.');
        return;
      }
      setMovies(list.data ?? []);
      setUsage(meter.data.data);
      setLibraryError('');
      const images: Record<string, string> = {};
      await Promise.all(
        (list.data ?? []).map(async (m: Movie) => {
          if (m.poster_path) {
            const { data } = await db.storage.from('posters').createSignedUrl(m.poster_path, 3600);
            if (data) images[m.id] = data.signedUrl;
          }
        }),
      );
      setPosters(images);
    } catch {
      setLibraryError('Your movie library could not load. Try again shortly.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (busy || checking) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, checking]);
  useEffect(() => () => { abort.current?.abort(); prepareAbort.current?.abort(); }, []);
  async function choose(chosen: File | null, resumeId?: string, destination?: FileSystemFileHandle) {
    prepareAbort.current?.abort();
    const controller = new AbortController();
    prepareAbort.current = controller;
    const epoch = ++selection.current;
    setStorageRetry(null);
    // Drop the old File snapshot; the on-disk cache still supports identical-file resume.
    prepared.current = null;
    setFile(null);
    setDetails(null);
    setResume(resumeId);
    setPaused(false);
    setError('');
    setChecking(false);
    if (!chosen) return;
    setChecking(true);
    setPreparationFraction(undefined);
    setPreparation('Checking the video and preparing its poster…');
    try {
      const saved = resumeId ? await uploadRecord(owner) : null;
      const alreadyPrepared = saved && saved.name === chosen.name && saved.size === chosen.size && saved.lastModified === chosen.lastModified;
      const useCompression = resumeId ? Boolean(saved?.compression && !alreadyPrepared) : compress;
      setCompressionUsed(useCompression);
      setOriginalSize(chosen.size);
      const { prepareMovie } = await import('@/lib/movie-prepare');
      const ready = await prepareMovie(chosen, owner, controller.signal, (message, fraction) => {
        if (selection.current === epoch) {
          setPreparation(message);
          setPreparationFraction(fraction);
        }
      }, destination, useCompression);
      controller.signal.throwIfAborted();
      prepared.current = ready;
      setPreparationFraction(undefined);
      setPreparation('Checking the video and preparing its poster…');
      const result = await checkMovie(ready.file);
      if (selection.current !== epoch) return;
      setFile(ready.file);
      setDetails(result);
      setTitle(
        (resumeId ? movies.find((m) => m.id === resumeId)?.title : undefined) ??
          chosen.name
            .replace(/\.[^.]+$/, '')
            .replace(/[_.]+/g, ' ')
            .slice(0, 120),
      );
    } catch (e) {
      if (selection.current === epoch && !controller.signal.aborted) {
        setQueueRunning(false);
        setError(e instanceof Error ? e.message : 'This file could not be read.');
        if (e instanceof Error && e.name === 'MoviePreparationStorageError')
          setStorageRetry({ source: chosen, resumeId });
      }
    } finally {
      if (selection.current === epoch) setChecking(false);
    }
  }
  async function prepareInFolder() {
    if (!storageRetry || checking || busy) return;
    const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    if (!picker) return;
    const epoch = selection.current;
    const retry = storageRetry;
    try {
      // Call directly from the click: opening the picker requires a user gesture.
      const destination = await picker.call(window, {
        suggestedName: retry.source.name.replace(/\.[^.]+$/, '.mp4'),
        types: [{ description: 'Prepared MP4 movie', accept: { 'video/mp4': ['.mp4'] } }],
        excludeAcceptAllOption: true,
      });
      if (selection.current === epoch) await choose(retry.source, retry.resumeId, destination);
    } catch (error) {
      if (selection.current === epoch && !(error instanceof DOMException && error.name === 'AbortError'))
        setError(error instanceof Error ? error.message : 'The destination could not be opened.');
    }
  }
  useEffect(() => {
    if (queueRunning && file && details && !busy && !checking && !paused && !error) void start();
  }, [queueRunning, file, details, busy, checking, paused, error]);
  async function start() {
    if (!file || !details || busy || !title.trim()) return;
    if (
      !resume &&
      usage &&
      file.size > Math.min(usage.quota - usage.used, usage.site_cap - usage.site_used)
    ) {
      setQueueRunning(false);
      setError('There is not enough free storage for this file.');
      return;
    }
    setBusy(true);
    setPaused(false);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ bytes: 0, total: file.size, start: Date.now() });
    let completed = false;
    try {
      await uploadMovie({
        owner,
        file,
        title: title.trim(),
        details,
        resumeId: resume,
        compression: compressionUsed,
        signal: controller.signal,
        progress: (bytes, total) => setProgress((p) => ({ ...p, bytes, total })),
      });
      completed = true;
      await prepared.current?.release();
      prepared.current = null;
      setFile(null);
      setDetails(null);
      setResume(undefined);
    } catch (e) {
      setQueueRunning(false);
      if (controller.signal.aborted) setPaused(true);
      else
        setError(
          e instanceof Error ? e.message : 'The upload stopped. Choose the same file to resume.',
        );
      try {
        const saved = await uploadRecord(owner);
        if (saved) {
          const { data: reserved } = await getBrowserClient()
            .from('movie_library')
            .select('status')
            .eq('id', saved.movie_id)
            .maybeSingle();
          if (reserved?.status === 'uploading') setResume(saved.movie_id);
          if (reserved?.status === 'completing') {
            setFile(null);
            setDetails(null);
            setResume(undefined);
          }
        }
      } catch {
        // The server record still provides cancellation when local recovery is unavailable.
      }
    } finally {
      abort.current = null;
      setBusy(false);
      await refresh();
    }
    if (completed && queue.length) {
      const [next, ...rest] = queue;
      setQueue(rest);
      await choose(next!);
    } else if (completed) setQueueRunning(false);
  }
  async function action(key: string, work: () => Promise<void>) {
    if (operation.current || busy) return;
    operation.current = true;
    setPending(key);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This action did not finish. Try again shortly.');
    } finally {
      operation.current = false;
      setPending('');
    }
  }
  async function remove(movie: Movie) {
    if (!window.confirm(`Delete ${movie.title}? Rooms watching it will stop.`)) return;
    await action(`delete:${movie.id}`, async () => {
      await movieCall('movie-delete', { movie_id: movie.id });
      try {
        const saved = await uploadRecord(owner);
        if (saved?.movie_id === movie.id) await uploadRecord(owner, null);
      } catch {
        /* Server cleanup already succeeded. */
      }
      if (resume === movie.id) {
        await prepared.current?.release();
        prepared.current = null;
        setResume(undefined);
        setFile(null);
        setDetails(null);
        setPaused(false);
      }
      await refresh();
    });
  }
  async function watch(movie: Movie) {
    await action(`watch:${movie.id}`, async () => {
      const result = await new RoomApi(getBrowserClient()).createRoom({
        title: movie.title.slice(0, 80),
        source: 'upload',
        content_ref: movie.id,
        visibility: 'private',
        control_mode: 'host',
      });
      if (!result.ok) {
        throw new Error(errorSentence(result.code));
      }
      const url = new URL(result.data.room_link, window.location.origin);
      url.searchParams.set('invite', '1');
      router.push(url.pathname + url.search + url.hash);
    });
  }
  const unfinished = movies.find((m) => m.status === 'uploading' || m.status === 'completing');
  const waitingForFile = Boolean(unfinished && !resume && !busy);
  const seconds = Math.max(1, (Date.now() - progress.start) / 1000);
  const rate = progress.bytes / seconds;
  const remaining = !resume && seconds >= 5 && rate > 0 ? Math.ceil((progress.total - progress.bytes) / rate / 60) : null;
  const uploadPercent = Math.min(100, Math.max(0, Math.floor((progress.bytes / Math.max(1, progress.total)) * 100)));
  const uploadStatus = !busy
    ? `Upload ${paused ? 'paused' : 'stopped'} at ${uploadPercent}%`
    : progress.bytes === progress.total ? 'Finishing your movie…' : `${uploadPercent}% uploaded`;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-5 sm:p-8">
      <nav aria-label="Movie navigation" className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link href="/home">Your rooms</Link>
        <Link href="/new">Start a room</Link>
        <Link href="/android">Android app</Link>
      </nav>
      <div>
        <p className="slate">Your private library</p>
        <h1 className="marquee text-5xl sm:text-6xl">Your movies</h1>
      </div>
      {loading ? <p role="status">Loading your movie library…</p> : null}
      {libraryError ? (
        <div role="alert">
          <p>{libraryError}</p>
          <button className="min-h-11 underline" onClick={() => void refresh()}>
            Try loading again
          </button>
        </div>
      ) : null}
      {usage ? (
        <section aria-label="Storage" className="rounded-xl bg-surface-1 p-4">
          <p>
            {gb(usage.used)} of {gb(usage.quota)} used on your account
          </p>
          <p className="text-sm text-muted">
            {gb(usage.site_used)} of {gb(usage.site_cap)} shared storage used
          </p>
          <progress
            aria-label="Shared storage used"
            className="movie-progress"
            value={usage.site_used}
            max={usage.site_cap}
          />
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-surface-2 p-4">
          {error}
        </p>
      ) : null}
      {storageRetry && !checking && typeof window !== 'undefined' && 'showSaveFilePicker' in window ? (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-1 p-4">
          <p>Save a prepared MP4 in a folder with enough free disk space, then upload it here. This avoids the browser’s temporary-storage limit. The saved MP4 stays in your folder; choose that MP4 if you resume after closing this page.</p>
          <button className={button} disabled={busy || Boolean(pending)} onClick={() => void prepareInFolder()}>Prepare using a folder</button>
        </div>
      ) : null}
      {usage?.quota === 0 ? (
        <p>
          Movie uploads are available only to approved accounts. You can still watch movies shared
          in a room.
        </p>
      ) : usage && waitingForFile ? (
        <p role="status">
          {unfinished?.status === 'completing'
            ? 'Your movie is being finalized. Use Finish upload below to retry after a few minutes if it does not become ready.'
            : 'You have an unfinished upload. Choose the same file in its card below to continue, or cancel it before choosing another movie.'}
        </p>
      ) : usage ? (
        <section className="flex flex-col gap-4 rounded-xl bg-surface-1 p-5">
          <h2 className="text-xl font-bold">{resume ? 'Resume your upload' : 'Upload a movie'}</h2>
          <p className="text-sm text-muted">
            MP4, WebM or MKV. MKV files are prepared on your device before uploading; compatible
            video is copied without quality loss. Other codecs need device support for conversion.
            The main audio track is included; extra audio tracks and subtitles are not imported.
            Keep this page open. A 2 GB file takes about 27 minutes on a 10 Mbps upload connection.
          </p>
          <p className="text-sm text-muted">
            Maximum file size: 5 GiB. Upload only movies you have the right to share.
          </p>
          {paused ? (
            <p role="status">
              Upload paused. Press Resume upload to continue with this file. If you close the page,
              choose the same file when you return.
            </p>
          ) : null}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={compress} disabled={busy || checking || Boolean(file) || Boolean(resume)} onChange={(e) => setCompress(e.target.checked)} />
            Compress before uploading (up to 720p)
          </label>
          <p className="text-sm text-muted">Choose compression before selecting files. It reduces picture quality and may take time; already-small movies may not shrink. Requires a supported browser and temporary disk space.</p>
          {queue.length > 0 ? <div aria-label="Upload queue">
            <p>{queue.length} more movies queued. Keep this page open; queued selections are not saved after closing it.</p>
            <ul>{queue.map((queued, index) => <li key={index}>{queued.name}</li>)}</ul>
            <button className="min-h-11 underline" disabled={busy || checking} onClick={() => { setQueue([]); setQueueRunning(false); }}>Clear remaining queue</button>
          </div> : null}
          <label>
            Choose a movie
            <input
              type="file"
              multiple
              accept=".mp4,.m4v,.webm,.mkv,video/x-matroska"
              className="block w-full min-w-0 max-w-full py-3 text-sm"
              disabled={busy || checking || Boolean(resume) || Boolean(pending)}
              onChange={(e) => {
                const selected = Array.from(e.target.files ?? []);
                setQueueRunning(false);
                setQueue(selected.slice(1));
                void choose(selected[0] ?? null);
              }}
            />
          </label>
          {checking ? <div>
            <progress aria-label="Movie preparation progress" className="movie-progress" max={1} value={preparationFraction} />
            <p role="status">{preparation}</p>
            <button className="min-h-11 underline" onClick={() => {
              prepareAbort.current?.abort();
              setQueueRunning(false);
              selection.current++;
              setChecking(false);
              setFile(null);
              setDetails(null);
            }}>Cancel preparation</button>
          </div> : null}
          {details ? (
            <>
              {compressionUsed && file ? <p role="status">Original: {gb(originalSize)} → prepared: {gb(file.size)} ({file.size < originalSize ? `${Math.round((1 - file.size / originalSize) * 100)}% smaller` : 'no size reduction'}).</p> : null}
              <label>
                Movie title
                <input
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy || Boolean(resume)}
                  className="mt-2 block w-full rounded-lg bg-surface-2 p-3"
                />
              </label>
              {details.slowStart ? (
                <p>This file may take longer to start because its index is at the end.</p>
              ) : null}
              <button
                className={button}
                disabled={busy || Boolean(pending) || !title.trim()}
                onClick={() => { setQueueRunning(queue.length > 0); void start(); }}
              >
                {resume ? 'Resume upload' : 'Upload movie'}
              </button>
            </>
          ) : null}
          {busy || paused || (resume && progress.total > 0) ? (
            <>
              <progress
                aria-label="Upload progress"
                className="movie-progress"
                max={progress.total || 1}
                value={progress.bytes}
              />
              <p role="status">
                {uploadStatus}
                {busy && remaining !== null && progress.bytes < progress.total
                  ? `, about ${Math.max(1, remaining)} minutes left`
                  : ''}
              </p>
              {busy ? <button
                className="min-h-11 underline disabled:opacity-50"
                disabled={progress.bytes === progress.total}
                onClick={() => abort.current?.abort()}
              >
                Pause upload
              </button> : null}
            </>
          ) : null}
        </section>
      ) : null}
      <section
        className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Movie library"
      >
        {movies.map((movie) => (
          <article
            key={movie.id}
            className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface-1 p-4"
          >
            {posters[movie.id] ? (
              <img
                src={posters[movie.id]}
                alt=""
                className="aspect-video w-full rounded-lg object-cover"
              />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg bg-surface-2 text-muted">
                {movie.status === 'ready' ? 'Ready to watch' : 'Upload in progress'}
              </div>
            )}
            <h2 className="text-xl font-bold [overflow-wrap:anywhere]">{movie.title}</h2>
            {movie.status === 'ready' ? editing === movie.id ? <form onSubmit={(event) => {
              event.preventDefault();
              void action(`rename:${movie.id}`, async () => {
                const result = await getBrowserClient().rpc('rename_movie', { movie_id: movie.id, title: editedTitle.trim() });
                if (result.error || !result.data?.ok) throw new Error('The title could not be saved. Try again.');
                setEditing(null); await refresh();
              });
            }}>
              <label>New movie title<input className="block w-full rounded-lg bg-surface-2 p-3" value={editedTitle} onChange={(e) => setEditedTitle(e.target.value)} maxLength={120} required /></label>
              <button className={button} disabled={!editedTitle.trim() || busy || Boolean(pending)}>Save title</button>
              <button type="button" className="min-h-11 underline" disabled={Boolean(pending)} onClick={() => setEditing(null)}>Cancel title edit</button>
            </form> : <button className="min-h-11 underline" disabled={busy || Boolean(pending)} onClick={() => { setEditing(movie.id); setEditedTitle(movie.title); }}>Edit title</button> : null}
            <p className="text-sm text-muted">
              {Math.max(1, Math.round(movie.duration_sec / 60))} min · {gb(movie.size_bytes)} ·{' '}
              {{
                ready: 'Ready to watch',
                uploading: 'Upload waiting to finish',
                completing: 'Finishing upload',
                deleting: 'Removing movie',
              }[movie.status] ?? 'Updating movie'}
            </p>
            {movie.status === 'ready' ? (
              <>
                <button
                  className={button}
                  disabled={busy || Boolean(pending)}
                  onClick={() => void watch(movie)}
                >
                  {pending === `watch:${movie.id}` ? 'Creating your room…' : 'Watch together'}
                </button>
                <button
                  className="min-h-11 underline"
                  disabled={busy || Boolean(pending)}
                  onClick={() =>
                    void action(`preview:${movie.id}`, async () => {
                      const result = await movieCall<{ url: string }>('movie-play-url', {
                        movie_id: movie.id,
                      });
                      setPreview({ url: result.url, title: movie.title });
                    })
                  }
                >
                  {pending === `preview:${movie.id}` ? 'Opening preview…' : 'Preview movie'}
                </button>
              </>
            ) : movie.status === 'completing' ? (
              <button
                className={button}
                disabled={busy || Boolean(pending)}
                onClick={() =>
                  void action(`finish:${movie.id}`, async () => {
                    await movieCall('movie-upload-complete', {
                      movie_id: movie.id,
                    });
                    await refresh();
                  })
                }
              >
                {pending === `finish:${movie.id}` ? 'Finishing upload…' : 'Finish upload'}
              </button>
            ) : movie.status === 'uploading' ? (
              <label className="cursor-pointer underline">
                Choose the same file to resume
                <input
                  type="file"
                  accept=".mp4,.m4v,.webm,.mkv,video/x-matroska"
                  className="block w-full min-w-0 max-w-full py-2 text-sm"
                  disabled={busy || checking || Boolean(pending)}
                  onChange={(e) => void choose(e.target.files?.[0] ?? null, movie.id)}
                />
              </label>
            ) : (
              <p>Storage is being updated. Retry after a few minutes if it does not finish.</p>
            )}
            <button
              className="min-h-11 underline"
              disabled={busy || Boolean(pending)}
              onClick={() => void remove(movie)}
            >
              {pending === `delete:${movie.id}`
                ? 'Removing movie…'
                : movie.status === 'deleting'
                  ? 'Finish deleting'
                  : movie.status === 'ready'
                    ? 'Delete movie'
                    : 'Cancel upload'}
            </button>
          </article>
        ))}
      </section>
      {!movies.length && usage ? (
        <p>
          {usage.quota
            ? 'Your library is empty. Choose a movie above to get started.'
            : "Movies shared with you play inside your friend's room. Open Your rooms or join with an invitation link."}
        </p>
      ) : null}
      <Sheet
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? `Preview: ${preview.title}` : 'Movie preview'}
      >
        {preview ? <video controls playsInline src={preview.url} className="w-full" /> : null}
      </Sheet>
    </main>
  );
}
