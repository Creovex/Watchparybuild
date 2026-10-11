import { assert, assertEquals } from '@std/assert';
import {
  CLOUDFLARE_STUN,
  TURN_TTL_SECONDS,
  createTurnCredentialsHandler,
  withoutPort53,
} from '../../functions/turn-credentials/handler.ts';
import {
  FakeSupabase,
  GUEST,
  OTHER_SESSION,
  ROOM,
  SESSION,
  body,
  captureErrors,
  member,
  post,
  seed,
  testEnv,
} from './fakes.ts';

const input = { room_id: ROOM, engine_session: SESSION };

function setup(opts: { voiceMode?: 'mesh' | 'server'; env?: Record<string, string>; fetch?: typeof fetch } = {}) {
  const db = new FakeSupabase();
  seed(db, { voiceMode: opts.voiceMode ?? 'mesh' });
  const handler = createTurnCredentialsHandler({
    env: testEnv(opts.env),
    admin: db.client(),
    fetch: opts.fetch ?? (() => Promise.reject(new Error('no network in this test'))),
  });
  return { db, handler };
}

Deno.test('turn-credentials: in TURN_TEST_MODE a joined member gets STUN only', async () => {
  const { handler } = setup();
  const res = await handler(post(input));
  assertEquals(res.status, 200);
  assertEquals(await body(res), { ok: true, data: { iceServers: [{ urls: [CLOUDFLARE_STUN] }] } });
});

Deno.test('turn-credentials: not_member without a joined row', async () => {
  const { handler } = setup();
  const res = await handler(post(input, { jwt: 'stranger-jwt' }));
  assertEquals(res.status, 403);
  assertEquals(await body(res), { ok: false, code: 'not_member' });
});

Deno.test('turn-credentials: not_member for a member who left, was removed or was banned', async () => {
  for (const state of ['left', 'removed', 'banned']) {
    const { db, handler } = setup();
    member(db, GUEST).state = state;
    const res = await handler(post(input));
    assertEquals(res.status, 403);
    assertEquals(await body(res), { ok: false, code: 'not_member' });
  }
});

Deno.test('turn-credentials: not_member for a replaced engine session', async () => {
  const { handler } = setup();
  const res = await handler(post({ room_id: ROOM, engine_session: OTHER_SESSION }));
  assertEquals(res.status, 403);
  assertEquals(await body(res), { ok: false, code: 'not_member' });
});

Deno.test('turn-credentials: not_member for a closed room or a room that does not exist', async () => {
  const { db, handler } = setup();
  db.tables.rooms[0]!.status = 'closed';
  const closed = await handler(post(input));
  assertEquals(await body(closed), { ok: false, code: 'not_member' });
  const missing = await handler(post({ room_id: '77777777-7777-4777-8777-777777777777', engine_session: SESSION }));
  assertEquals(missing.status, 403);
  assertEquals(await body(missing), { ok: false, code: 'not_member' });
});

Deno.test('turn-credentials: wrong_voice_mode for a server voice room', async () => {
  const { handler } = setup({ voiceMode: 'server' });
  const res = await handler(post(input));
  assertEquals(res.status, 403);
  assertEquals(await body(res), { ok: false, code: 'wrong_voice_mode' });
});

Deno.test('turn-credentials: voice_muted for a member the host muted', async () => {
  const { db, handler } = setup();
  member(db, GUEST).voice_muted = true;
  const res = await handler(post(input));
  assertEquals(res.status, 403);
  assertEquals(await body(res), { ok: false, code: 'voice_muted' });
});

Deno.test('turn-credentials: invalid_input for a missing, malformed or extra field', async () => {
  const { handler } = setup();
  for (const bad of [
    { room_id: ROOM },
    { room_id: 'room', engine_session: SESSION },
    { ...input, extra: true },
    [],
    'text',
  ]) {
    const res = await handler(post(bad));
    assertEquals(res.status, 400, JSON.stringify(bad));
    assertEquals(await body(res), { ok: false, code: 'invalid_input' });
  }
});

Deno.test('turn-credentials: unauthorized without a valid JWT', async () => {
  const { handler } = setup();
  const res = await handler(post(input, { jwt: 'expired' }));
  assertEquals(res.status, 401);
  assertEquals(await body(res), { ok: false, code: 'unauthorized' });
});

Deno.test('turn-credentials: internal when the membership read fails', async () => {
  const { db, handler } = setup();
  db.failSelect.add('room_members');
  const errors = captureErrors();
  try {
    const res = await handler(post(input));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { ok: false, code: 'internal' });
  } finally {
    errors.restore();
  }
});

const cloudflareEnv = {
  TURN_TEST_MODE: '',
  CLOUDFLARE_TURN_KEY_ID: 'key-id',
  CLOUDFLARE_TURN_API_TOKEN: 'api-token',
};

Deno.test('turn-credentials: asks Cloudflare for credentials valid 6 hours and drops port 53', async () => {
  const requests: Request[] = [];
  const fakeFetch = ((url: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(url, init));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:53?transport=udp',
                'turns:turn.cloudflare.com:443?transport=tcp',
              ],
              username: 'user',
              credential: 'secret',
            },
          ],
        }),
        { status: 201 },
      ),
    );
  }) as typeof fetch;
  const { handler } = setup({ env: cloudflareEnv, fetch: fakeFetch });
  const res = await handler(post(input));
  assertEquals(res.status, 200);
  assertEquals(await body(res), {
    ok: true,
    data: {
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
          urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
          username: 'user',
          credential: 'secret',
        },
      ],
    },
  });
  assertEquals(requests.length, 1);
  const req = requests[0]!;
  assertEquals(req.method, 'POST');
  assertEquals(req.url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers');
  assertEquals(req.headers.get('Authorization'), 'Bearer api-token');
  assertEquals(await req.json(), { ttl: TURN_TTL_SECONDS });
  assertEquals(TURN_TTL_SECONDS, 21_600);
});

Deno.test('turn-credentials: checks membership before calling Cloudflare', async () => {
  let calls = 0;
  const fakeFetch = (() => {
    calls++;
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  const { db, handler } = setup({ env: cloudflareEnv, fetch: fakeFetch });
  member(db, GUEST).voice_muted = true;
  const res = await handler(post(input));
  assertEquals(await body(res), { ok: false, code: 'voice_muted' });
  assertEquals(calls, 0);
});

Deno.test('turn-credentials: internal when Cloudflare fails or is not configured', async () => {
  const errors = captureErrors();
  try {
    const failing = setup({ env: cloudflareEnv, fetch: (() => Promise.resolve(new Response('no', { status: 503 }))) as typeof fetch });
    const res = await failing.handler(post(input));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { ok: false, code: 'internal' });

    const garbage = setup({ env: cloudflareEnv, fetch: (() => Promise.resolve(new Response('{"nope":1}', { status: 201 }))) as typeof fetch });
    assertEquals(await body(await garbage.handler(post(input))), { ok: false, code: 'internal' });

    const unset = setup({ env: { TURN_TEST_MODE: '0' } });
    assertEquals(await body(await unset.handler(post(input))), { ok: false, code: 'internal' });
    assert(errors.lines.length >= 3);
  } finally {
    errors.restore();
  }
});

Deno.test('turn-credentials: port 53 filtering keeps string urls and drops servers left empty', () => {
  assertEquals(withoutPort53([{ urls: 'turn:x:53' }, { urls: 'turn:x:3478' }]), [{ urls: ['turn:x:3478'] }]);
});
