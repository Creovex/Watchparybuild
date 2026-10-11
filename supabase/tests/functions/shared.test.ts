// The parts every function shares: CORS, the method and JWT checks, input parsing, the status map.

import { assert, assertEquals } from '@std/assert';
import { allowedOrigins } from '../../functions/_shared/cors.ts';
import { envFromRecord } from '../../functions/_shared/env.ts';
import { FUNCTION_STATUS } from '../../functions/_shared/http.ts';
import { createDeleteAccountHandler } from '../../functions/delete-account/handler.ts';
import { createLiveKitTokenHandler } from '../../functions/livekit-token/handler.ts';
import { createModerateHandler } from '../../functions/moderate/handler.ts';
import { createTurnCredentialsHandler } from '../../functions/turn-credentials/handler.ts';
import {
  EXTENSION,
  FakeRoomService,
  FakeSupabase,
  PREVIEW,
  SITE,
  body,
  captureErrors,
  post,
  preflightRequest,
  seed,
  testEnv,
} from './fakes.ts';

function handlers() {
  const db = new FakeSupabase();
  seed(db);
  const env = testEnv();
  const admin = db.client();
  return {
    db,
    all: {
      'turn-credentials': createTurnCredentialsHandler({ env, admin }),
      'livekit-token': createLiveKitTokenHandler({ env, admin }),
      moderate: createModerateHandler({
        env,
        admin,
        createUserClient: (jwt) => db.client(jwt),
        roomService: () => new FakeRoomService(),
        sleep: () => Promise.resolve(),
      }),
      'delete-account': createDeleteAccountHandler({ env, admin }),
    },
  };
}

Deno.test('the status map matches the build prompt', () => {
  assertEquals(FUNCTION_STATUS, {
    invalid_input: 400,
    unauthorized: 401,
    not_member: 403,
    not_host: 403,
    wrong_voice_mode: 403,
    voice_muted: 403,
    not_found: 404,
    rate_limited: 429,
    internal: 500,
    voice_sync_failed: 500,
  });
});

Deno.test('the codes equal FUNCTION_CODES in the shared sync-core schemas', async () => {
  const source = await Deno.readTextFile(new URL('../../../packages/sync-core/src/schemas.ts', import.meta.url));
  const block = /export const FUNCTION_CODES = \[([^\]]*)\]/.exec(source)?.[1];
  assert(block, 'FUNCTION_CODES not found in packages/sync-core/src/schemas.ts');
  const codes = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assertEquals(codes, Object.keys(FUNCTION_STATUS).sort());
});

Deno.test('every function has the same import map, and the tests use it too', async () => {
  const read = async (path: string) =>
    JSON.parse(await Deno.readTextFile(new URL(path, import.meta.url))) as { imports: Record<string, string> };
  const fns = ['turn-credentials', 'livekit-token', 'moderate', 'delete-account'];
  const maps = await Promise.all(fns.map((f) => read(`../../functions/${f}/deno.json`)));
  for (const map of maps) assertEquals(map, maps[0]);
  const tests = await read('./deno.json');
  for (const [name, target] of Object.entries(maps[0]?.imports ?? {})) assertEquals(tests.imports[name], target);
});

Deno.test('allowed origins come from SITE_URL, PREVIEW_URL and EXTENSION_ORIGINS', () => {
  const origins = allowedOrigins(
    envFromRecord({
      SITE_URL: 'https://watch.example/some/path',
      PREVIEW_URL: 'https://dev.watch.example/',
      EXTENSION_ORIGINS: 'chrome-extension://aaaa, chrome-extension://bbbb/ ,,not an origin',
    }),
  );
  assertEquals([...origins].sort(), [
    'chrome-extension://aaaa',
    'chrome-extension://bbbb',
    'https://dev.watch.example',
    'https://watch.example',
  ]);
  assertEquals(allowedOrigins(envFromRecord({})).size, 0);
});

for (const name of ['turn-credentials', 'livekit-token', 'moderate', 'delete-account'] as const) {
  Deno.test(`${name}: answers CORS preflights for the site, the preview domain and the extension`, async () => {
    const handler = handlers().all[name];
    for (const origin of [SITE, PREVIEW, EXTENSION]) {
      const res = await handler(preflightRequest(origin));
      assertEquals(res.status, 204);
      assertEquals(res.headers.get('Access-Control-Allow-Origin'), origin);
      assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
      assert(res.headers.get('Access-Control-Allow-Headers')?.includes('authorization'));
      assert(res.headers.get('Access-Control-Allow-Headers')?.includes('content-type'));
      assertEquals(res.headers.get('Vary'), 'Origin');
    }
  });

  Deno.test(`${name}: refuses a preflight from any other origin`, async () => {
    const handler = handlers().all[name];
    for (const origin of ['https://evil.example', 'http://localhost:3001', null]) {
      const res = await handler(preflightRequest(origin));
      assertEquals(res.status, 403);
      assertEquals(res.headers.get('Access-Control-Allow-Origin'), null);
    }
  });

  Deno.test(`${name}: echoes an allowed origin on the response and never another one`, async () => {
    const handler = handlers().all[name];
    const allowed = await handler(post({}, { jwt: null, origin: SITE }));
    assertEquals(allowed.headers.get('Access-Control-Allow-Origin'), SITE);
    await allowed.body?.cancel();
    const other = await handler(post({}, { jwt: null, origin: 'https://evil.example' }));
    assertEquals(other.headers.get('Access-Control-Allow-Origin'), null);
    await other.body?.cancel();
  });

  Deno.test(`${name}: unauthorized without a JWT or with a bad one`, async () => {
    const handler = handlers().all[name];
    for (const jwt of [null, 'not-a-real-jwt']) {
      const res = await handler(post({}, { jwt }));
      assertEquals(res.status, 401);
      assertEquals(await body(res), { ok: false, code: 'unauthorized' });
    }
  });

  Deno.test(`${name}: internal when Supabase Auth cannot be reached`, async () => {
    const { db, all } = handlers();
    db.authDown = true;
    const errors = captureErrors();
    try {
      const res = await all[name](post({}));
      assertEquals(res.status, 500);
      assertEquals(await body(res), { ok: false, code: 'internal' });
      assertEquals(errors.lines.length, 1);
    } finally {
      errors.restore();
    }
  });

  Deno.test(`${name}: invalid_input for a body that is not JSON and for methods other than POST`, async () => {
    const handler = handlers().all[name];
    const bad = await handler(post(null, { raw: '{not json' }));
    assertEquals(bad.status, 400);
    assertEquals(await body(bad), { ok: false, code: 'invalid_input' });
    const get = await handler(new Request('http://localhost/functions/v1/x', { method: 'GET' }));
    assertEquals(get.status, 400);
    assertEquals(await body(get), { ok: false, code: 'invalid_input' });
  });
}
