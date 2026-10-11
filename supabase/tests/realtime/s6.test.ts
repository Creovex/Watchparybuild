// Spike S6: Realtime authorization for room topics, run against the local Supabase stack.
//
// Proves, with real WebSocket clients:
//   1. a non member is refused both private topics of a room;
//   2. a member receives both topics and can send (broadcast and presence) only on the client topic;
//   3. after the host removes a member, the removed user cannot join the new epoch's topics, and
//      nothing more arrives on the old server topic.
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from the local stack; see
// supabase/tests/README.md. The service role key is used only to create and delete test users and
// rows; every check runs as a signed in user.

import { createClient, type RealtimeChannel, type SupabaseClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from `supabase status -o env` (see supabase/tests/README.md).',
  );
}

// How long to wait for something that should arrive, and how long to listen for something that
// must not arrive. Locally a broadcast arrives in well under a second.
const ARRIVE_MS = 5_000;
const SILENCE_MS = 3_000;

type Received = { event: string; payload: Record<string, unknown> };

interface User {
  label: string;
  id: string;
  client: SupabaseClient;
}

interface Joined {
  topic: string;
  status: string;
  error: string | null;
  channel: RealtimeChannel;
  received: Received[];
}

function fail(message: string): never {
  throw new Error(message);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const createdUsers: string[] = [];
const createdRooms: string[] = [];
const openClients: SupabaseClient[] = [];

async function makeUser(label: string): Promise<User> {
  const email = `s6-${label}-${crypto.randomUUID()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `S6 ${label}` },
  });
  if (error || !data.user) fail(`could not create ${label}: ${error?.message}`);
  createdUsers.push(data.user.id);

  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  openClients.push(client);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) fail(`could not sign in ${label}: ${signIn.error?.message}`);
  await client.realtime.setAuth(signIn.data.session.access_token);
  return { label, id: data.user.id, client };
}

async function rpc<T = Record<string, unknown>>(user: User, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await user.client.rpc(fn, args);
  if (error) fail(`${user.label} ${fn} raised: ${error.message}`);
  if (!data?.ok) fail(`${user.label} ${fn} returned ${JSON.stringify(data)}`);
  return data.data as T;
}

// Joins a topic and resolves with the final subscribe status. `presenceKey` turns presence on.
function join(user: User, topic: string, opts: { isPrivate?: boolean; presenceKey?: string } = {}): Promise<Joined> {
  const isPrivate = opts.isPrivate ?? true;
  const received: Received[] = [];
  const channel = user.client.channel(topic, {
    config: {
      private: isPrivate,
      broadcast: { ack: true, self: false },
      ...(opts.presenceKey ? { presence: { key: opts.presenceKey } } : {}),
    },
  });
  channel.on('broadcast', { event: '*' }, (msg: { event: string; payload: Record<string, unknown> }) => {
    received.push({ event: msg.event, payload: msg.payload });
  });
  if (opts.presenceKey) channel.on('presence', { event: 'sync' }, () => {});

  return new Promise((resolve) => {
    let settled = false;
    const done = (status: string, error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ topic, status, error, channel, received });
    };
    const timer = setTimeout(() => done('NO_ANSWER', null), 10_000);
    channel.subscribe((status: string, err?: Error) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        done(status, err?.message ?? null);
      }
    });
  });
}

async function leave(user: User, joined: Joined) {
  await user.client.removeChannel(joined.channel);
}

function topicOf(roomId: string, epoch: number, kind: 'server' | 'client') {
  return `room:${roomId}:${epoch}:${kind}`;
}

const observations: string[] = [];
function note(line: string) {
  observations.push(line);
  console.log(`  observed: ${line}`);
}

Deno.test({
  name: 'S6: realtime authorization for room topics',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    try {
      const host = await makeUser('host');
      const member = await makeUser('member');
      const target = await makeUser('target');
      const stranger = await makeUser('stranger');

      const created = await rpc<{ room: { id: string; slug: string; channel_epoch: number } }>(host, 'create_room', {
        title: 'S6 room',
        source: 'youtube',
        content_ref: 'dQw4w9WgXcQ',
        visibility: 'public',
        control_mode: 'host',
      });
      const roomId = created.room.id;
      const slug = created.room.slug;
      createdRooms.push(roomId);
      check(created.room.channel_epoch === 1, 'a new room starts at epoch 1');

      await rpc(member, 'join_room', { slug, join_key: null, sync_mode: 'auto' });
      await rpc(target, 'join_room', { slug, join_key: null, sync_mode: 'auto' });

      const server1 = topicOf(roomId, 1, 'server');
      const client1 = topicOf(roomId, 1, 'client');

      await t.step('a non member is refused both topics', async () => {
        for (const topic of [server1, client1]) {
          const joined = await join(stranger, topic);
          note(`non member joining ${topic.endsWith('server') ? 'server' : 'client'} topic: ${joined.status} (${joined.error})`);
          check(joined.status === 'CHANNEL_ERROR', `non member got ${joined.status} on ${topic}`);
          await leave(stranger, joined);
        }
      });

      const hostServer = await join(host, server1, { presenceKey: host.id });
      const hostClient = await join(host, client1, { presenceKey: host.id });
      const memberServer = await join(member, server1, { presenceKey: member.id });
      const memberClient = await join(member, client1, { presenceKey: member.id });
      const targetServer = await join(target, server1);
      const targetClient = await join(target, client1);
      // A public channel with the same name as the server topic. Realtime treats public and private
      // channels as separate, so database broadcasts must never reach it.
      const strangerPublic = await join(stranger, server1, { isPrivate: false });
      note(`non member joining the server topic name as a public channel: ${strangerPublic.status}`);

      await t.step('members can join both topics', () => {
        for (const joined of [hostServer, hostClient, memberServer, memberClient, targetServer, targetClient]) {
          check(joined.status === 'SUBSCRIBED', `member join of ${joined.topic} gave ${joined.status} (${joined.error})`);
        }
      });

      await t.step('a member sends on the client topic and other members receive it', async () => {
        const ack = await memberClient.channel.send({
          type: 'broadcast',
          event: 'reaction',
          payload: { emoji: '🔥', position_sec: 1 },
        });
        note(`member broadcast on client topic acknowledged: ${ack}`);
        check(ack === 'ok', `client topic send was acknowledged with ${ack}`);
        const arrived = await waitFor(() => hostClient.received.some((m) => m.event === 'reaction'), ARRIVE_MS);
        check(arrived, 'host did not receive the reaction on the client topic');
      });

      await t.step('a member cannot send on the server topic', async () => {
        const before = hostServer.received.length;
        const ack = await memberServer.channel.send({
          type: 'broadcast',
          event: 'state',
          payload: { forged: true },
        });
        note(`member broadcast on server topic acknowledged: ${ack}`);
        const leaked = await waitFor(
          () => hostServer.received.slice(before).some((m) => m.event === 'state' && m.payload?.forged === true),
          SILENCE_MS,
        );
        check(!leaked, 'a broadcast a member sent on the server topic reached the host');
      });

      await t.step('presence tracks on the client topic only', async () => {
        const clientTrack = await memberClient.channel.track({ user_id: member.id, display_name: 'S6 member' });
        note(`presence track on client topic: ${clientTrack}`);
        check(clientTrack === 'ok', `presence track on the client topic returned ${clientTrack}`);
        const seen = await waitFor(() => Object.keys(hostClient.channel.presenceState()).includes(member.id), ARRIVE_MS);
        check(seen, 'host did not see the member in client topic presence');

        const serverTrack = await memberServer.channel.track({ user_id: member.id, display_name: 'S6 member' });
        note(`presence track on server topic: ${serverTrack}`);
        const leaked = await waitFor(
          () => Object.keys(hostServer.channel.presenceState()).includes(member.id),
          SILENCE_MS,
        );
        check(!leaked, 'presence tracked on the server topic reached the host');
      });

      await t.step('members receive database events on the server topic; a public channel of the same name does not', async () => {
        await rpc(host, 'send_chat', { room_id: roomId, body: 'hello from S6', position_sec: null });
        const arrived = await waitFor(
          () => memberServer.received.some((m) => m.event === 'chat' && m.payload?.body === 'hello from S6'),
          ARRIVE_MS,
        );
        check(arrived, 'member did not receive the chat event on the server topic');
        await sleep(1_000);
        check(strangerPublic.received.length === 0, 'a public channel with the server topic name received a database event');
      });

      await t.step('remove: the moderation event reaches everyone on the old server topic', async () => {
        const result = await rpc<{ channel_epoch: number }>(host, 'moderate', {
          room_id: roomId,
          target_id: target.id,
          action: 'remove',
        });
        check(result.channel_epoch === 2, `epoch after remove is ${result.channel_epoch}`);
        for (const [label, joined] of [
          ['host', hostServer],
          ['member', memberServer],
          ['removed user', targetServer],
        ] as const) {
          const arrived = await waitFor(
            () =>
              joined.received.some(
                (m) =>
                  m.event === 'moderation' &&
                  m.payload?.target === target.id &&
                  m.payload?.action === 'remove' &&
                  m.payload?.new_epoch === 2,
              ),
            ARRIVE_MS,
          );
          check(arrived, `${label} did not receive the moderation event`);
        }
      });

      const server2 = topicOf(roomId, 2, 'server');
      const client2 = topicOf(roomId, 2, 'client');

      await t.step('the removed user cannot join the new topics, or join the old ones again', async () => {
        for (const topic of [server2, client2]) {
          const joined = await join(target, topic);
          note(`removed user joining epoch 2 ${topic.endsWith('server') ? 'server' : 'client'} topic: ${joined.status}`);
          check(joined.status === 'CHANNEL_ERROR', `removed user got ${joined.status} on ${topic}`);
          await leave(target, joined);
        }
        const fresh = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        openClients.push(fresh);
        const session = (await target.client.auth.getSession()).data.session;
        check(session, 'removed user has no session');
        await fresh.realtime.setAuth(session.access_token);
        const again = await join({ ...target, client: fresh }, server1);
        note(`removed user joining the old server topic again: ${again.status}`);
        check(again.status === 'CHANNEL_ERROR', `removed user rejoined the old server topic: ${again.status}`);
        await fresh.removeChannel(again.channel);
      });

      const hostServer2 = await join(host, server2);
      const memberServer2 = await join(member, server2);
      const hostClient2 = await join(host, client2);
      const memberClient2 = await join(member, client2);

      await t.step('remaining members move to the new topics', () => {
        for (const joined of [hostServer2, memberServer2, hostClient2, memberClient2]) {
          check(joined.status === 'SUBSCRIBED', `member join of ${joined.topic} gave ${joined.status} (${joined.error})`);
        }
      });

      await t.step('an epoch ahead of the room is refused to a member', async () => {
        const ahead = await join(member, topicOf(roomId, 3, 'server'));
        check(ahead.status === 'CHANNEL_ERROR', `member joined an epoch ahead of the room: ${ahead.status}`);
        await leave(member, ahead);
      });

      for (const [user, joined] of [
        [host, hostServer],
        [host, hostClient],
        [member, memberServer],
        [member, memberClient],
      ] as const) {
        await leave(user, joined);
      }

      await t.step('after the epoch change nothing more arrives on the old server topic', async () => {
        const before = targetServer.received.length;
        await rpc(host, 'send_chat', { room_id: roomId, body: 'after the move', position_sec: null });
        await rpc(host, 'update_room_settings', { room_id: roomId, settings: { title: 'S6 room renamed' } });
        const arrived = await waitFor(
          () => memberServer2.received.some((m) => m.event === 'chat' && m.payload?.body === 'after the move'),
          ARRIVE_MS,
        );
        check(arrived, 'member did not receive the chat event on the new server topic');
        const roomEvent = await waitFor(() => memberServer2.received.some((m) => m.event === 'room'), ARRIVE_MS);
        check(roomEvent, 'member did not receive the room event on the new server topic');
        await sleep(SILENCE_MS);
        const late = targetServer.received.slice(before);
        note(`events on the removed user's old server subscription after the move: ${late.length}`);
        check(late.length === 0, `the old server topic still delivered: ${JSON.stringify(late.map((m) => m.event))}`);
      });

      await t.step('the old client topic is silent once members have moved', async () => {
        const ack = await targetClient.channel.send({
          type: 'broadcast',
          event: 'reaction',
          payload: { emoji: '😡', position_sec: 2 },
        });
        note(`removed user broadcast on the old client topic acknowledged: ${ack}`);
        await sleep(SILENCE_MS);
        const reached = [hostClient2, memberClient2].some((j) => j.received.some((m) => m.payload?.emoji === '😡'));
        check(!reached, 'a broadcast on the old client topic reached a member on the new topic');

        const sent = await memberClient2.channel.send({
          type: 'broadcast',
          event: 'reaction',
          payload: { emoji: '🍿', position_sec: 3 },
        });
        check(sent === 'ok', `member send on the new client topic returned ${sent}`);
        const arrived = await waitFor(() => hostClient2.received.some((m) => m.payload?.emoji === '🍿'), ARRIVE_MS);
        check(arrived, 'host did not receive a reaction on the new client topic');
      });

      console.log(`S6 observations:\n${observations.map((o) => `  - ${o}`).join('\n')}`);
    } finally {
      for (const client of openClients) {
        await client.removeAllChannels();
        client.realtime.disconnect();
      }
      for (const roomId of createdRooms) {
        await admin.from('rooms').delete().eq('id', roomId);
      }
      for (const userId of createdUsers) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
  },
});
