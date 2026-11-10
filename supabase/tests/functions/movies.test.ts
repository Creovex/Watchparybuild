import { assertEquals, assert } from '@std/assert';
import { createMovieHandler, publicMovie, type StoredMovie } from '../../functions/_shared/movie-handler.ts';
import type { MovieStorage } from '../../functions/_shared/r2.ts';
import { FakeSupabase, HOST, GUEST, post, body, seed, testEnv } from './fakes.ts';
const mid = '22222222-2222-4222-8222-222222222222';
const movie: StoredMovie = {
  id: mid,
  owner_id: HOST,
  title: 'Test movie',
  status: 'uploading',
  size_bytes: 9,
  content_type: 'video/mp4',
  duration_sec: 20,
  width: 640,
  height: 360,
  object_key: 'm/owner/private.mp4',
  upload_id: 'private-multipart',
  lease_token: 'lease',
  poster_path: null,
  created_at: new Date().toISOString(),
  ready_at: null,
};
function setup() {
  const db = new FakeSupabase();
  seed(db);
  db.tables.movies = [{ ...movie }];
  let completed = false;
  const storage: MovieStorage = {
    create: async () => 'new-upload',
    parts: async () => [{ part_number: 1, size: 9, etag: 'test' }],
    signPart: async () => 'https://test.invalid/signed',
    complete: async () => {
      completed = true;
    },
    head: async () => null,
    abort: async () => {},
    remove: async () => {},
    playUrl: async () => ({ url: 'https://test.invalid/signed', expires_at: new Date().toISOString() }),
  };
  return {
    db,
    storage,
    completed: () => completed,
    handler: (op: Parameters<typeof createMovieHandler>[0]) =>
      createMovieHandler(op, { env: testEnv(), admin: db.client(), r2: storage }),
  };
}
Deno.test('movies: public metadata excludes storage keys, upload ids and operation leases', () => {
  const safe = publicMovie(movie);
  assert(!('object_key' in safe));
  assert(!('upload_id' in safe));
  assert(!('lease_token' in safe));
  assertEquals(safe.title, 'Test movie');
});
Deno.test('movies: another owner cannot obtain upload URLs', async () => {
  const h = setup();
  const res = await h.handler('urls')(post({ movie_id: mid, part_numbers: [1] }, { jwt: 'guest-jwt' }));
  assertEquals(await body(res), { ok: false, code: 'movie_unavailable' });
});
Deno.test('movies: refuses parts beyond the reservation', async () => {
  const h = setup();
  const res = await h.handler('urls')(post({ movie_id: mid, part_numbers: [2] }, { jwt: 'host-jwt' }));
  assertEquals(await body(res), { ok: false, code: 'invalid_input' });
});
Deno.test('movies: reserves before creating a storage upload', async () => {
  const h = setup();
  let called = false;
  h.storage.create = async () => {
    called = true;
    return 'id';
  };
  h.db.rpcResult = { ok: false, code: 'storage_full' };
  const res = await h.handler('start')(
    post(
      {
        movie_id: mid,
        title: 'Movie',
        size_bytes: 9,
        content_type: 'video/mp4',
        duration_sec: 1,
        width: 640,
        height: 360,
      },
      { jwt: 'host-jwt' },
    ),
  );
  assertEquals(await body(res), { ok: false, code: 'storage_full' });
  assertEquals(called, false);
});
Deno.test('movies: incomplete or oversized parts cannot complete', async () => {
  const h = setup();
  h.db.rpcResult = { ok: true, data: { ...movie, status: 'completing' } };
  h.storage.parts = async () => [{ part_number: 1, size: 10, etag: 'test' }];
  const res = await h.handler('complete')(post({ movie_id: mid }, { jwt: 'host-jwt' }));
  assertEquals(await body(res), { ok: false, code: 'size_mismatch' });
  assertEquals(h.completed(), false);
});
Deno.test('movies: completed retries return safe metadata without re-uploading', async () => {
  const h = setup();
  h.db.rpcResult = { ok: true, data: { ...movie, status: 'ready' } };
  const res = await h.handler('complete')(post({ movie_id: mid }, { jwt: 'host-jwt' }));
  const json = await body(res);
  assertEquals(json.ok, true);
  assertEquals(h.completed(), false);
  assert(!JSON.stringify(json).includes(movie.object_key));
});
Deno.test('movies: strangers cannot obtain library playback URLs', async () => {
  const h = setup();
  h.db.tables.movies = [{ ...movie, status: 'ready' }];
  const res = await h.handler('play')(post({ movie_id: mid }, { jwt: 'guest-jwt' }));
  assertEquals(await body(res), { ok: false, code: 'movie_unavailable' });
});
