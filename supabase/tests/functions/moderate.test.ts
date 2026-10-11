import { assert, assertEquals } from '@std/assert';
import { publishPermission } from '../../functions/_shared/livekit.ts';
import { LIVEKIT_RETRIES, createModerateHandler } from '../../functions/moderate/handler.ts';
import {
  FakeRoomService,
  FakeSupabase,
  GUEST,
  ROOM,
  body,
  captureErrors,
  post,
  seed,
  testEnv,
} from './fakes.ts';

function setup(opts: { voiceMode?: 'mesh' | 'server'; noLiveKit?: boolean } = {}) {
  const db = new FakeSupabase();
  seed(db, { voiceMode: opts.voiceMode ?? 'server' });
  const livekit = new FakeRoomService();
  const sleeps: number[] = [];
  const handler = createModerateHandler({
    env: testEnv(),
    admin: db.client(),
    createUserClient: (jwt) => db.client(jwt),
    roomService: () => (opts.noLiveKit ? null : livekit),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { db, livekit, sleeps, handler };
}

const request = (action: string) => post({ room_id: ROOM, target_id: GUEST, action }, { jwt: 'host-jwt' });

Deno.test('moderate: calls the moderate RPC with the caller JWT and passes its data back', async () => {
  const { db, handler } = setup({ voiceMode: 'mesh' });
  db.rpcResult = { ok: true, data: { channel_epoch: 2 } };
  const res = await handler(request('remove'));
  assertEquals(res.status, 200);
  assertEquals(await body(res), { ok: true, data: { channel_epoch: 2 } });
  assertEquals(db.rpcCalls, [
    { jwt: 'host-jwt', name: 'moderate', args: { room_id: ROOM, target_id: GUEST, action: 'remove' } },
  ]);
});

Deno.test('moderate: not_host and not_member come from the RPC with status 403', async () => {
  for (const code of ['not_host', 'not_member']) {
    const { db, livekit, handler } = setup();
    db.rpcResult = { ok: false, code };
    const res = await handler(request('mute_voice'));
    assertEquals(res.status, 403);
    assertEquals(await body(res), { ok: false, code });
    assertEquals(livekit.calls, []);
  }
});

Deno.test('moderate: invalid_input for an unknown action or a malformed id', async () => {
  const { db, handler } = setup();
  for (const bad of [
    { room_id: ROOM, target_id: GUEST, action: 'kick' },
    { room_id: ROOM, target_id: 'guest', action: 'ban' },
    { room_id: ROOM, action: 'ban' },
  ]) {
    const res = await handler(post(bad, { jwt: 'host-jwt' }));
    assertEquals(res.status, 400);
    assertEquals(await body(res), { ok: false, code: 'invalid_input' });
  }
  assertEquals(db.rpcCalls, []);
});

Deno.test('moderate: unauthorized without a valid JWT', async () => {
  const { db, handler } = setup();
  const res = await handler(post({ room_id: ROOM, target_id: GUEST, action: 'ban' }, { jwt: null }));
  assertEquals(res.status, 401);
  assertEquals(await body(res), { ok: false, code: 'unauthorized' });
  assertEquals(db.rpcCalls, []);
});

Deno.test('moderate: mesh rooms make no LiveKit call', async () => {
  const { livekit, handler } = setup({ voiceMode: 'mesh' });
  for (const action of ['remove', 'ban', 'mute_voice', 'unmute_voice']) {
    assertEquals((await handler(request(action))).status, 200);
  }
  assertEquals(livekit.calls, []);
});

Deno.test('moderate: in a server room, mute and unmute set publish permission off and on', async () => {
  const { livekit, handler } = setup();
  assertEquals((await handler(request('mute_voice'))).status, 200);
  assertEquals((await handler(request('unmute_voice'))).status, 200);
  assertEquals(livekit.calls, [
    { method: 'updateParticipant', room: ROOM, identity: GUEST, options: { permission: publishPermission(false) } },
    { method: 'updateParticipant', room: ROOM, identity: GUEST, options: { permission: publishPermission(true) } },
  ]);
  assertEquals(publishPermission(false).canPublish, false);
  assertEquals(publishPermission(true).canPublish, true);
});

Deno.test('moderate: in a server room, remove and ban remove the participant', async () => {
  const { livekit, handler } = setup();
  assertEquals((await handler(request('remove'))).status, 200);
  assertEquals((await handler(request('ban'))).status, 200);
  assertEquals(livekit.calls, [
    { method: 'removeParticipant', room: ROOM, identity: GUEST },
    { method: 'removeParticipant', room: ROOM, identity: GUEST },
  ]);
});

Deno.test('moderate: allow_back changes nothing in LiveKit', async () => {
  const { livekit, handler } = setup();
  assertEquals((await handler(request('allow_back'))).status, 200);
  assertEquals(livekit.calls, []);
});

Deno.test('moderate: a participant LiveKit does not know counts as done', async () => {
  const { livekit, handler } = setup();
  livekit.failures = 1;
  livekit.error = Object.assign(new Error('participant not found'), { status: 404, code: 'not_found' });
  const res = await handler(request('ban'));
  assertEquals(res.status, 200);
  assertEquals(livekit.calls.length, 1);
});

Deno.test('moderate: retries LiveKit 3 times and succeeds on the last retry', async () => {
  const { livekit, sleeps, handler } = setup();
  livekit.failures = LIVEKIT_RETRIES;
  const res = await handler(request('mute_voice'));
  assertEquals(res.status, 200);
  assertEquals(livekit.calls.length, LIVEKIT_RETRIES + 1);
  assertEquals(sleeps, [250, 500, 1000]);
});

Deno.test('moderate: voice_sync_failed after the retries, while the database change stands', async () => {
  const { db, livekit, handler } = setup();
  livekit.failures = 100;
  const errors = captureErrors();
  try {
    const res = await handler(request('remove'));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { ok: false, code: 'voice_sync_failed' });
    assertEquals(livekit.calls.length, LIVEKIT_RETRIES + 1);
    assertEquals(db.rpcCalls.length, 1);
    assertEquals(errors.lines.length, 1);
    assert(String(errors.lines[0]?.[0]).includes('database change stands'));
  } finally {
    errors.restore();
  }
});

Deno.test('moderate: voice_sync_failed when LiveKit is not configured for a server room', async () => {
  const { handler } = setup({ noLiveKit: true });
  const errors = captureErrors();
  try {
    const res = await handler(request('mute_voice'));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { ok: false, code: 'voice_sync_failed' });
  } finally {
    errors.restore();
  }
});

Deno.test('moderate: internal when the RPC call fails or answers in an unexpected way', async () => {
  const errors = captureErrors();
  try {
    const failed = setup();
    failed.db.rpcError = { message: 'function public.moderate does not exist' };
    const res = await failed.handler(request('ban'));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { ok: false, code: 'internal' });

    const odd = setup();
    odd.db.rpcResult = { ok: false, code: 'something_new' };
    assertEquals(await body(await odd.handler(request('ban'))), { ok: false, code: 'internal' });

    const shapeless = setup();
    shapeless.db.rpcResult = 'yes';
    assertEquals(await body(await shapeless.handler(request('ban'))), { ok: false, code: 'internal' });
  } finally {
    errors.restore();
  }
});
