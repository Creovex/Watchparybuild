import { assertEquals } from '@std/assert';
import { createMovieInviteHandler } from '../../functions/movie-invite/handler.ts';
import { FakeSupabase, seed, testEnv, post, body } from './fakes.ts';
Deno.test('movie invite: validates the key through the caller-scoped database function', async () => {
  const db = new FakeSupabase();
  seed(db);
  db.rpcResult = { ok: false, code: 'bad_key' };
  const handler = createMovieInviteHandler({
    env: testEnv(),
    admin: db.client(),
    createUserClient: (jwt) => db.client(jwt),
  });
  const response = await handler(post({ slug: 'abcdefghij', join_key: 'wrong' }, { jwt: 'guest-jwt' }));
  assertEquals(response.status, 403);
  assertEquals(await body(response), { ok: false, code: 'bad_key' });
  assertEquals(db.rpcCalls[0], {
    jwt: 'guest-jwt',
    name: 'movie_invitation',
    args: { slug: 'abcdefghij', join_key: 'wrong' },
  });
});
Deno.test('movie invite: returns only authorized presentation fields', async () => {
  const db = new FakeSupabase();
  seed(db);
  db.rpcResult = {
    ok: true,
    data: { title: 'Authorized movie', host_name: 'Host', poster_path: null, object_key: 'never-return' },
  };
  const handler = createMovieInviteHandler({
    env: testEnv(),
    admin: db.client(),
    createUserClient: (jwt) => db.client(jwt),
  });
  const response = await handler(post({ slug: 'abcdefghij', join_key: 'valid' }, { jwt: 'guest-jwt' }));
  assertEquals(await body(response), {
    ok: true,
    data: { title: 'Authorized movie', host_name: 'Host', poster_url: null },
  });
});
