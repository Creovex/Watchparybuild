import { assert, assertEquals } from '@std/assert';
import { TOKEN_TTL_SECONDS } from '../../functions/_shared/livekit.ts';
import { createLiveKitTokenHandler } from '../../functions/livekit-token/handler.ts';
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

function setup(opts: { voiceMode?: 'mesh' | 'server'; env?: Record<string, string> } = {}) {
  const db = new FakeSupabase();
  seed(db, { voiceMode: opts.voiceMode ?? 'server' });
  const handler = createLiveKitTokenHandler({ env: testEnv(opts.env), admin: db.client() });
  return { db, handler };
}

function claims(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
  return JSON.parse(json);
}

Deno.test('livekit-token: a joined member of a server room gets a 10 minute token for that room', async () => {
  const { handler } = setup();
  const res = await handler(post(input));
  assertEquals(res.status, 200);
  const result = (await body(res)) as { ok: true; data: { url: string; token: string } };
  assertEquals(result.ok, true);
  assertEquals(result.data.url, 'wss://livekit.example');
  const c = claims(result.data.token);
  assertEquals(c.sub, GUEST);
  assertEquals(c.name, 'Gus');
  assertEquals(c.iss, 'test-key');
  assertEquals((c.exp as number) - (c.nbf as number), TOKEN_TTL_SECONDS);
  assertEquals(TOKEN_TTL_SECONDS, 600);
  const video = c.video as Record<string, unknown>;
  assertEquals(video.room, ROOM);
  assertEquals(video.roomJoin, true);
  assertEquals(video.canPublish, true);
  assertEquals(video.canSubscribe, true);
  assertEquals(video.canPublishData, false);
  assertEquals(video.canPublishSources, ['microphone', 'camera']);
  assert(!video.roomAdmin);
});

Deno.test('livekit-token: not_member for a stranger, a member who left and a replaced engine session', async () => {
  const stranger = setup();
  assertEquals(await body(await stranger.handler(post(input, { jwt: 'stranger-jwt' }))), {
    ok: false,
    code: 'not_member',
  });

  const left = setup();
  member(left.db, GUEST).state = 'left';
  const leftRes = await left.handler(post(input));
  assertEquals(leftRes.status, 403);
  assertEquals(await body(leftRes), { ok: false, code: 'not_member' });

  const replaced = setup();
  const res = await replaced.handler(post({ room_id: ROOM, engine_session: OTHER_SESSION }));
  assertEquals(res.status, 403);
  assertEquals(await body(res), { ok: false, code: 'not_member' });
});

Deno.test('livekit-token: wrong_voice_mode for a mesh room', async () => {
  const { handler } = setup({ voiceMode: 'mesh' });
  const res = await handler(post(input));
  assertEquals(res.status, 403);
  assertEquals(await body(res), { ok: false, code: 'wrong_voice_mode' });
});

Deno.test('livekit-token: voice_muted for a member the host muted', async () => {
  const { db, handler } = setup();
  member(db, GUEST).voice_muted = true;
  const res = await handler(post(input));
  assertEquals(res.status, 403);
  assertEquals(await body(res), { ok: false, code: 'voice_muted' });
});

Deno.test('livekit-token: invalid_input and unauthorized', async () => {
  const { handler } = setup();
  const bad = await handler(post({ room_id: ROOM }));
  assertEquals(bad.status, 400);
  assertEquals(await body(bad), { ok: false, code: 'invalid_input' });
  const anon = await handler(post(input, { jwt: null }));
  assertEquals(anon.status, 401);
  assertEquals(await body(anon), { ok: false, code: 'unauthorized' });
});

Deno.test('livekit-token: internal when LiveKit is not configured', async () => {
  const { handler } = setup({ env: { LIVEKIT_API_SECRET: '' } });
  const errors = captureErrors();
  try {
    const res = await handler(post(input));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { ok: false, code: 'internal' });
    assertEquals(errors.lines.length, 1);
  } finally {
    errors.restore();
  }
});

Deno.test('livekit-token: the token has no name when the profile cannot be read', async () => {
  const { db, handler } = setup();
  db.failSelect.add('profiles');
  const result = (await body(await handler(post(input)))) as { ok: true; data: { token: string } };
  assertEquals(claims(result.data.token).name, undefined);
});
