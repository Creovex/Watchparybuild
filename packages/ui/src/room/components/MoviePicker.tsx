'use client';
import { useEffect, useState } from 'react';
import type { RoomApi } from '../api';
export function MoviePicker({ api, onChoose }: { api: RoomApi; onChoose: (id: string) => void }) {
  const [movies, setMovies] = useState<Array<{ id: string; title: string; poster_path: string | null }>>([]);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    let active = true;
    void api
      .movies()
      .then(async (rows) => {
        if (!active) return;
        setMovies(rows);
        const images: Record<string, string> = {};
        await Promise.all(
          rows.map(async (m) => {
            if (m.poster_path) {
              const url = await api.poster(m.poster_path);
              if (url) images[m.id] = url;
            }
          }),
        );
        if (active) setPosters(images);
      })
      .catch(() => {
        if (active) setError('Your movies could not load. Try again.');
      });
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <section aria-label="Your movies" className="grid grid-cols-2 gap-3">
      {error ? <p role="alert">{error}</p> : null}
      {!movies.length ? <p>No ready movies in your library yet.</p> : null}
      {movies.map((movie) => (
        <button
          type="button"
          aria-pressed={selected === movie.id}
          key={movie.id}
          className={`rounded-lg p-3 text-left ring-1 ${selected === movie.id ? 'ring-amber' : 'ring-line'}`}
          onClick={() => {
            setSelected(movie.id);
            onChoose(movie.id);
          }}
        >
          {posters[movie.id] ? (
            <img src={posters[movie.id]} alt="" className="mb-2 aspect-video w-full rounded object-cover" />
          ) : null}
          {movie.title}
        </button>
      ))}
    </section>
  );
}
