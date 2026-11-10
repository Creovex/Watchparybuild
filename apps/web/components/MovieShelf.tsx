'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RoomApi } from '@watchparty/ui/room';
import { getBrowserClient } from '@/lib/supabase/client';
import { errorSentence } from '@/lib/errors';
export function MovieShelf() {
  const [movies, setMovies] = useState<Array<{ id: string; title: string; poster: string | null }>>(
    [],
  );
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const api = new RoomApi(getBrowserClient());
    void Promise.all([api.movies(), getBrowserClient().rpc('movie_usage')])
      .then(async ([rows, usage]) => {
        if (active) setAllowed(Boolean(usage.data?.data?.quota));
        const cards = await Promise.all(
          rows.slice(0, 4).map(async (m) => ({
            id: m.id,
            title: m.title,
            poster: m.poster_path ? await api.poster(m.poster_path) : null,
          })),
        );
        if (active) setMovies(cards);
      })
      .catch(() => {
        if (active) setError('Your movies could not load. Open the library to try again.');
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);
  async function watch(movie: { id: string; title: string }) {
    if (pending) return;
    setPending(movie.id);
    setError('');
    try {
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
      const url = new URL(result.data.room_link, location.origin);
      url.searchParams.set('invite', '1');
      router.push(url.pathname + url.search + url.hash);
    } catch {
      setError('The room could not be created. Try again shortly.');
    } finally {
      setPending(null);
    }
  }
  if (!loading && !allowed && !movies.length && !error) return null;
  return (
    <section className="rounded-xl bg-surface-1 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Your movies</h2>
        <Link href="/movies" className="min-h-11 underline">
          Open library
        </Link>
      </div>
      {error ? <p role="status">{error}</p> : null}
      {movies.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {movies.map((movie) => (
            <article key={movie.id} className="min-w-0">
              {movie.poster ? (
                <img
                  src={movie.poster}
                  alt=""
                  className="mb-2 aspect-video w-full rounded-lg object-cover"
                />
              ) : null}
              <h3 className="font-semibold [overflow-wrap:anywhere]">{movie.title}</h3>
              <button
                disabled={Boolean(pending)}
                className="mt-2 min-h-11 rounded-lg bg-amber px-4 font-semibold text-amber-ink"
                onClick={() => void watch(movie)}
              >
                {pending === movie.id ? 'Creating your room…' : 'Watch together'}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-muted">
          {loading
            ? 'Loading your movies…'
            : allowed
              ? 'Open your library to upload a movie and watch together.'
              : 'Join a room from an invitation to watch a movie shared with you. Uploads are limited to approved accounts.'}
        </p>
      )}
    </section>
  );
}
