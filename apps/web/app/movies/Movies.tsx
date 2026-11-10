'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RoomApi } from '@watchparty/ui/room';
import { getBrowserClient } from '@/lib/supabase/client';
import { movieCall, type Movie } from '@/lib/movie-api';
import { checkMovie, type MovieDetails } from '@/lib/movie-check';
import { uploadMovie, uploadRecord } from '@/lib/movie-upload';
import { useWakeLock } from '@/lib/use-wake-lock';
import { errorSentence } from '@/lib/errors';
const button = 'rounded-lg bg-amber px-4 py-3 font-semibold text-amber-ink disabled:opacity-50';
const gb = (n: number) => (n / 1e9).toFixed(2) + ' GB';
type Usage = { quota: number; used: number; site_used: number; site_cap: number };
export function Movies({ owner }: { owner: string }) {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [details, setDetails] = useState<MovieDetails | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ bytes: 0, total: 0, start: 0 });
  const [resume, setResume] = useState<string | undefined>();
  const [preview, setPreview] = useState<string | null>(null);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);
  const selection = useRef(0);
  useWakeLock(busy);
  const refresh = useCallback(async () => {
    const db = getBrowserClient();
    const [list, meter] = await Promise.all([
      db.from('movie_library').select('*').neq('status', 'failed').order('created_at', { ascending: false }),
      db.rpc('movie_usage'),
    ]);
    if (list.error || meter.error || !meter.data?.ok) {
      setError('Your movie library could not load. Try again shortly.');
      return;
    }
    setMovies(list.data ?? []);
    setUsage(meter.data.data);
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
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (busy) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  useEffect(() => () => abort.current?.abort(), []);
  async function choose(chosen: File | null, resumeId?: string) {
    const epoch = ++selection.current;
    setFile(chosen);
    setDetails(null);
    setResume(resumeId);
    setError('');
    if (!chosen) return;
    setChecking(true);
    try {
      const result = await checkMovie(chosen);
      if (selection.current !== epoch) return;
      setDetails(result);
      setTitle(
        chosen.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_.]+/g, ' ')
          .slice(0, 120),
      );
    } catch (e) {
      if (selection.current === epoch)
        setError(e instanceof Error ? e.message : 'This file could not be read.');
    } finally {
      if (selection.current === epoch) setChecking(false);
    }
  }
  async function start() {
    if (!file || !details || busy || !title.trim()) return;
    if (
      !resume &&
      usage &&
      file.size > Math.min(usage.quota - usage.used, usage.site_cap - usage.site_used)
    ) {
      setError('There is not enough free storage for this file.');
      return;
    }
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ bytes: 0, total: file.size, start: Date.now() });
    try {
      await uploadMovie({
        owner,
        file,
        title: title.trim(),
        details,
        resumeId: resume,
        signal: controller.signal,
        progress: (bytes, total) => setProgress((p) => ({ ...p, bytes, total })),
      });
      setFile(null);
      setDetails(null);
      setResume(undefined);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'The upload stopped. Choose the same file to resume.');
    } finally {
      abort.current = null;
      setBusy(false);
      await refresh();
    }
  }
  async function remove(movie: Movie) {
    if (!window.confirm(`Delete ${movie.title}? Rooms watching it will stop.`)) return;
    setError('');
    try {
      await movieCall('movie-delete', { movie_id: movie.id });
      try {
        const saved = await uploadRecord(owner);
        if (saved?.movie_id === movie.id) await uploadRecord(owner, null);
      } catch {
        /* Server cleanup already succeeded. */
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deletion did not finish. Try again shortly.');
    }
  }
  async function watch(movie: Movie) {
    setError('');
    const result = await new RoomApi(getBrowserClient()).createRoom({
      title: movie.title.slice(0, 80),
      source: 'upload',
      content_ref: movie.id,
      visibility: 'private',
      control_mode: 'host',
    });
    if (!result.ok) {
      setError(errorSentence(result.code));
      return;
    }
    const url = new URL(result.data.room_link, window.location.origin);
    url.searchParams.set('invite', '1');
    router.push(url.pathname + url.search + url.hash);
  }
  const seconds = Math.max(1, (Date.now() - progress.start) / 1000);
  const rate = progress.bytes / seconds;
  const remaining = rate > 0 ? Math.ceil((progress.total - progress.bytes) / rate / 60) : null;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-5 sm:p-8">
      <nav className="flex gap-5">
        <Link href="/home">Your rooms</Link>
        <Link href="/new">Start a room</Link>
        <Link href="/android">Android app</Link>
      </nav>
      <div>
        <p className="slate">Your private library</p>
        <h1 className="marquee text-6xl">Your movies</h1>
      </div>
      {usage ? (
        <section aria-label="Storage" className="rounded-xl bg-surface-1 p-4">
          <p>
            {gb(usage.used)} of {gb(usage.quota)} used on your account
          </p>
          <p className="text-sm text-muted">
            {gb(usage.site_used)} of {gb(usage.site_cap)} shared storage used
          </p>
          <progress className="w-full" value={usage.site_used} max={usage.site_cap} />
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-surface-2 p-4">
          {error}
        </p>
      ) : null}
      {usage?.quota === 0 ? (
        <p>
          Movie uploads are available only to approved accounts. You can still watch movies shared in a room.
        </p>
      ) : usage ? (
        <section className="flex flex-col gap-4 rounded-xl bg-surface-1 p-5">
          <h2 className="text-xl font-bold">{resume ? 'Resume your upload' : 'Upload a movie'}</h2>
          <p className="text-sm text-muted">
            MP4 with H.264 video and AAC sound, or WebM with VP9 or AV1 video and Opus sound. Keep this page
            open. A 2 GB file takes about 27 minutes on a 10 Mbps upload connection.
          </p>
          <label>
            Choose a movie
            <input
              type="file"
              accept=".mp4,.m4v,.webm"
              className="block py-3"
              disabled={busy || checking}
              onChange={(e) => void choose(e.target.files?.[0] ?? null)}
            />
          </label>
          {checking ? <p role="status">Checking the video and preparing its poster…</p> : null}
          {details ? (
            <>
              <label>
                Movie title
                <input
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  className="mt-2 block w-full rounded-lg bg-surface-2 p-3"
                />
              </label>
              {details.slowStart ? (
                <p>This file may take longer to start because its index is at the end.</p>
              ) : null}
              <button className={button} disabled={busy || !title.trim()} onClick={() => void start()}>
                {resume ? 'Resume upload' : 'Upload movie'}
              </button>
            </>
          ) : null}
          {busy ? (
            <>
              <progress aria-label="Upload progress" max={progress.total || 1} value={progress.bytes} />
              <p role="status">
                {Math.floor((progress.bytes / Math.max(1, progress.total)) * 100)}% uploaded
                {remaining !== null ? `, about ${remaining} minutes left` : ''}
              </p>
              <button className="underline" onClick={() => abort.current?.abort()}>
                Pause upload
              </button>
            </>
          ) : null}
        </section>
      ) : null}
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Movie library">
        {movies.map((movie) => (
          <article key={movie.id} className="flex flex-col gap-3 rounded-xl bg-surface-1 p-4">
            {posters[movie.id] ? (
              <img src={posters[movie.id]} alt="" className="aspect-video w-full rounded-lg object-cover" />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg bg-surface-2 text-muted">
                {movie.status === 'ready' ? 'Ready to watch' : 'Upload in progress'}
              </div>
            )}
            <h2 className="text-xl font-bold">{movie.title}</h2>
            <p className="text-sm text-muted">
              {Math.round(movie.duration_sec / 60)} min · {gb(movie.size_bytes)} · {movie.status}
            </p>
            {movie.status === 'ready' ? (
              <>
                <button className={button} disabled={busy} onClick={() => void watch(movie)}>
                  Watch together
                </button>
                <button
                  className="underline"
                  onClick={() =>
                    void movieCall<{ url: string }>('movie-play-url', { movie_id: movie.id })
                      .then((r) => setPreview(r.url))
                      .catch((e) => setError(e.message))
                  }
                >
                  Preview movie
                </button>
              </>
            ) : movie.status === 'completing' ? (
              <button
                className={button}
                onClick={() =>
                  void movieCall('movie-upload-complete', { movie_id: movie.id })
                    .then(() => refresh())
                    .catch((e) => setError(e.message))
                }
              >
                Finish upload
              </button>
            ) : movie.status === 'uploading' ? (
              <label className="cursor-pointer underline">
                Choose the same file to resume
                <input
                  type="file"
                  accept=".mp4,.m4v,.webm"
                  className="block py-2"
                  disabled={busy || checking}
                  onChange={(e) => void choose(e.target.files?.[0] ?? null, movie.id)}
                />
              </label>
            ) : (
              <p>Storage is being updated. Retry after a few minutes if it does not finish.</p>
            )}
            <button className="min-h-11 underline" disabled={busy} onClick={() => void remove(movie)}>
              {movie.status === 'deleting'
                ? 'Finish deleting'
                : movie.status === 'ready'
                  ? 'Delete movie'
                  : 'Cancel upload'}
            </button>
          </article>
        ))}
      </section>
      {!movies.length && usage ? <p>Your library is empty. Uploaded movies will appear here.</p> : null}
      {preview ? (
        <section className="rounded-xl bg-surface-1 p-4">
          <button className="mb-3 underline" onClick={() => setPreview(null)}>
            Close preview
          </button>
          <video controls playsInline src={preview} className="w-full" />
        </section>
      ) : null}
    </main>
  );
}
