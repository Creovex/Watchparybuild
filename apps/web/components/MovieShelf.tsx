'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RoomApi } from '@watchparty/ui/room';
import { getBrowserClient } from '@/lib/supabase/client';
export function MovieShelf() {
  const [movies, setMovies] = useState<Array<{ id: string; title: string; poster: string | null }>>([]);
  const [error, setError] = useState('');
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const api = new RoomApi(getBrowserClient());
    void api
      .movies()
      .then(async (rows) => {
        const cards = await Promise.all(
          rows
            .slice(0, 4)
            .map(async (m) => ({
              id: m.id,
              title: m.title,
              poster: m.poster_path ? await api.poster(m.poster_path) : null,
            })),
        );
        if (active) setMovies(cards);
      })
      .catch(() => {
        if (active) setError('Your movies could not load. Open the library to try again.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function watch(movie: { id: string; title: string }) {
    const result = await new RoomApi(getBrowserClient()).createRoom({
      title: movie.title.slice(0, 80),
      source: 'upload',
      content_ref: movie.id,
      visibility: 'private',
      control_mode: 'host',
    });
    if (!result.ok) {
      setError('The room could not be created. Try again shortly.');
      return;
    }
    const url = new URL(result.data.room_link, location.origin);
    url.searchParams.set('invite', '1');
    router.push(url.pathname + url.search + url.hash);
  }
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {movies.map((movie) => (
            <article key={movie.id}>
              {movie.poster ? (
                <img src={movie.poster} alt="" className="mb-2 aspect-video w-full rounded-lg object-cover" />
              ) : null}
              <h3 className="font-semibold">{movie.title}</h3>
              <button
                className="mt-2 min-h-11 rounded-lg bg-amber px-4 font-semibold text-amber-ink"
                onClick={() => void watch(movie)}
              >
                Watch together
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-muted">Upload a movie or start watching from your private library.</p>
      )}
    </section>
  );
}
