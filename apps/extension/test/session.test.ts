import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRow, PlaybackStateRow, RoomRow } from '@watchparty/sync-core';
import type { RoomRecord } from '../src/background/core';
import { roomKey, tokensKey } from '../src/shared/keys';
import type { PanelToContent, PanelToWorker, ToPanel } from '../src/shared/messages';
import { PanelSession } from '../src/panel/session';
import { ENGINE_SESSION, ROOM_ID, stateRow, USER_ID } from './helpers';

const HOST_ID = USER_ID;
const GUEST_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date().toISOString();

function roomRow(partial: Partial<RoomRow> = {}): RoomRow {
  return {
    id: ROOM_ID,
    slug: 'abcDEF1234',
    host_id: HOST_ID,
    title: 'Friday film',
    visibility: 'public',
    source: 'netflix',
    content_ref: 'https://www.netflix.com/watch/81234567',
    control_mode: 'host',
    wait_for_everyone: true,
    room_cap: 3,
    voice_mode: 'mesh',
    locked: false,
    status: 'open',
    channel_epoch: 1,
    created_at: NOW,
    last_active_at: NOW,
    ...partial,
  };
}

function member(userId: string, role: 'host' | 'guest'): MemberRow {
  return {
    room_id: ROOM_ID,
    user_id: userId,
    role,
    state: 'joined',
    voice_muted: false,
    sync_mode: 'auto',
    buffering_since: null,
    first_joined_at: NOW,
    last_seen_at: NOW,
    left_at: null,
  };
}

/** Just enough of a Supabase client for RoomController and the panel session. */
function fakeSupabase(db: { room: RoomRow; playback: PlaybackStateRow; members: MemberRow[] }, userId: string) {
  const authListeners = new Set<(event: string, session: unknown) => void>();
  let session: Record<string, unknown> | null = null;
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  let stopAutoRefresh = 0;
  const rows = (table: string): unknown[] => {
    switch (table) {
      case 'room_view':
        return [db.room];
      case 'playback_state':
        return [db.playback];
      case 'room_members':
        return db.members;
      case 'profile_public':
        return db.members.map((m) => ({ id: m.user_id, display_name: m.role === 'host' ? 'Hana' : 'Gus', avatar_url: null }));
      case 'profiles':
        return [{ display_name: userId === HOST_ID ? 'Hana' : 'Gus', avatar_url: null, duck_level: 0.35 }];
      default:
        return [];
    }
  };
  const query = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'order', 'limit', 'lt', 'gt']) builder[name] = () => builder;
    builder.maybeSingle = async () => ({ data: rows(table)[0] ?? null, error: null });
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows(table), error: null });
    return builder;
  };
  const channel = () => {
    const ch: Record<string, unknown> = {
      state: 'joined',
      on: () => ch,
      subscribe: (cb: (status: string) => void) => {
        queueMicrotask(() => cb('SUBSCRIBED'));
        return ch;
      },
      track: async () => 'ok',
      untrack: async () => 'ok',
      send: async () => 'ok',
      presenceState: () => ({}),
    };
    return ch;
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      setSession: async (tokens: { access_token: string; refresh_token: string }) => {
        session = { ...tokens, user: { id: userId, user_metadata: {} } };
        return { data: { session }, error: null };
      },
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      stopAutoRefresh: () => {
        stopAutoRefresh += 1;
      },
    },
    realtime: { setAuth: async () => undefined, disconnect: async () => undefined },
    channel,
    removeChannel: async () => 'ok',
    from: query,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      if (name === 'server_time') return { data: { ok: true, data: Date.now() }, error: null };
      return { data: { ok: true, data: null }, error: null };
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
  };
  return {
    client: client as unknown as SupabaseClient,
    rpcCalls,
    stopAutoRefreshCalls: () => stopAutoRefresh,
    refresh(tokens: { access_token: string; refresh_token: string }) {
      session = { ...tokens, user: { id: userId, user_metadata: {} } };
      for (const cb of authListeners) cb('TOKEN_REFRESHED', session);
    },
  };
}

function record(): RoomRecord {
  return {
    room_id: ROOM_ID,
    slug: 'abcDEF1234',
    source: 'netflix',
    content_ref: 'https://www.netflix.com/watch/81234567',
    engine_session: ENGINE_SESSION,
    session: { access_token: 'access-1', refresh_token: 'refresh-1' },
    tab_id: 42,
    released: false,
  };
}

let session: PanelSession | null = null;

function setup(userId = HOST_ID, roomPartial: Partial<RoomRow> = {}) {
  const storage = new Map<string, unknown>([[roomKey(ROOM_ID), record()]]);
  const sent: Array<PanelToContent | PanelToWorker> = [];
  let deliver: (m: ToPanel) => void = () => undefined;
  const db = { room: roomRow(roomPartial), playback: stateRow({ seq: 3, status: 'paused', position_sec: 61 }), members: [member(HOST_ID, 'host'), member(GUEST_ID, 'guest')] };
  const supabase = fakeSupabase(db, userId);
  session = new PanelSession({
    port: {
      send: (m) => sent.push(m),
      onMessage: (cb) => {
        deliver = cb;
        return () => undefined;
      },
      onDisconnect: () => () => undefined,
    },
    storage: {
      get: async (key) => storage.get(key),
      set: async (items) => {
        for (const [k, v] of Object.entries(items)) storage.set(k, v);
      },
    },
    createClient: () => supabase.client,
  });
  const s = session;
  return {
    session: s,
    storage,
    sent,
    supabase,
    db,
    deliver: (m: ToPanel) => deliver(m),
    async live() {
      deliver({ type: 'bind', room_id: ROOM_ID });
      await vi.waitFor(() => expect(s.store.get().phase).toBe('room'));
    },
    capabilities() {
      deliver({ type: 'capabilities', source: 'netflix', capabilities: { seek: false, fineRate: false, volume: true, seekLatencySec: 0.5 }, video: true });
    },
  };
}

afterEach(async () => {
  await session?.destroy();
  session = null;
});

describe('PanelSession', () => {
  it('shows that the tab holds no room', async () => {
    const t = setup();
    t.deliver({ type: 'bind', room_id: null });
    await vi.waitFor(() => expect(t.session.store.get().phase).toBe('no_room'));
  });

  it('restores the handed over session and takes over the engine session on auto sync', async () => {
    const t = setup();
    await t.live();
    expect(t.storage.get(tokensKey(ROOM_ID))).toEqual({ access_token: 'access-1', refresh_token: 'refresh-1' });
    const touch = t.supabase.rpcCalls.find(([name]) => name === 'touch_member');
    expect(touch?.[1]).toMatchObject({ room_id: ROOM_ID, engine_session: ENGINE_SESSION, sync_mode: 'auto' });
    expect(t.session.store.get().me?.name).toBe('Hana');
  });

  it('writes every refreshed token pair for the worker to return', async () => {
    const t = setup();
    await t.live();
    t.supabase.refresh({ access_token: 'access-2', refresh_token: 'refresh-2' });
    await vi.waitFor(() => expect(t.storage.get(tokensKey(ROOM_ID))).toEqual({ access_token: 'access-2', refresh_token: 'refresh-2' }));
  });

  it('drives the content script engine once the player is known', async () => {
    const t = setup();
    await t.live();
    t.capabilities();
    await vi.waitFor(() => expect(t.sent.some((m) => m.type === 'state')).toBe(true));
    const state = t.sent.find((m) => m.type === 'state') as Extract<PanelToContent, { type: 'state' }>;
    expect(state.row.position_sec).toBe(61);
    expect(t.sent.some((m) => m.type === 'server_offset')).toBe(true);
  });

  it('stops for a reclaim: no refresh, voice left, engine suspended, then answers stopped', async () => {
    const t = setup();
    await t.live();
    t.capabilities();
    const leaveVoice = vi.fn(async () => undefined);
    t.session.setVoiceLeave(leaveVoice);
    t.deliver({ type: 'stop', reason: 'reclaimed' });
    await vi.waitFor(() => expect(t.sent.at(-1)).toEqual({ type: 'stopped', room_id: ROOM_ID }));
    expect(leaveVoice).toHaveBeenCalled();
    expect(t.supabase.stopAutoRefreshCalls()).toBeGreaterThan(0);
    expect(t.sent.some((m) => m.type === 'suspend')).toBe(true);
    expect(t.sent.some((m) => m.type === 'release')).toBe(false);
    const controller = t.session.store.get().controller!;
    expect(controller.store.get().fatal).toBe('handed_over');
    expect(t.session.store.get().stopReason).toBe('reclaimed');
  });

  it('gives the session up when the member leaves the room', async () => {
    const t = setup();
    await t.live();
    await t.session.store.get().controller!.leave();
    await vi.waitFor(() => expect(t.sent.at(-1)).toEqual({ type: 'release', room_id: ROOM_ID }));
    expect(t.supabase.rpcCalls.some(([name]) => name === 'leave_room')).toBe(true);
  });

  it('shows a guest on another episode a way back and stops syncing meanwhile', async () => {
    const t = setup(GUEST_ID);
    await t.live();
    t.capabilities();
    t.deliver({ type: 'content_ref', url: 'https://www.netflix.com/watch/81234567?trackId=1', title_key: 'netflix:81234567' });
    expect(t.session.store.get().episode).toBe('match');
    t.deliver({ type: 'content_ref', url: 'https://www.netflix.com/watch/99999999', title_key: 'netflix:99999999' });
    expect(t.session.store.get().episode).toBe('guest_elsewhere');
    expect(t.sent.at(-1)).toEqual({ type: 'suspend' });
    // A guest never changes the room's title.
    expect(t.supabase.rpcCalls.some(([name]) => name === 'set_source')).toBe(false);
    t.session.openRoomTitle();
    expect(t.sent.at(-1)).toEqual({ type: 'navigate', url: 'https://www.netflix.com/watch/81234567' });
  });

  it('moves the room to the next episode when the host’s tab moves to it', async () => {
    const t = setup(HOST_ID);
    await t.live();
    t.deliver({ type: 'content_ref', url: 'https://www.netflix.com/watch/81234567', title_key: 'netflix:81234567' });
    t.deliver({ type: 'content_ref', url: 'https://www.netflix.com/watch/81234568?trackId=2', title_key: 'netflix:81234568' });
    await vi.waitFor(() => expect(t.supabase.rpcCalls.some(([name]) => name === 'set_source')).toBe(true));
    const call = t.supabase.rpcCalls.find(([name]) => name === 'set_source')!;
    expect(call[1]).toEqual({ room_id: ROOM_ID, source: 'netflix', content_ref: 'https://www.netflix.com/watch/81234568?trackId=2' });
  });

  it('does not change the room when the host’s tab simply opens on another title', async () => {
    const t = setup(HOST_ID);
    await t.live();
    t.deliver({ type: 'content_ref', url: 'https://www.netflix.com/watch/70000000', title_key: 'netflix:70000000' });
    expect(t.session.store.get().episode).toBe('host_elsewhere');
    expect(t.supabase.rpcCalls.some(([name]) => name === 'set_source')).toBe(false);
  });

  it('counts chat messages from others while the player is full screen', async () => {
    const t = setup();
    await t.live();
    t.session.setVoiceIndicator('live');
    t.deliver({ type: 'fullscreen', on: true });
    expect(t.sent.at(-1)).toEqual({ type: 'fs_state', voice: 'live', unread: 0 });
    const controller = t.session.store.get().controller!;
    controller.store.set({
      messages: [
        { id: '66666666-6666-4666-8666-666666666666', room_id: ROOM_ID, user_id: GUEST_ID, kind: 'chat', body: 'hi', system_code: null, position_sec: null, created_at: NOW, deleted_at: null },
      ],
    });
    expect(t.sent.at(-1)).toEqual({ type: 'fs_state', voice: 'live', unread: 1 });
  });
});

describe('PanelSession start failures', () => {
  it('shows an error instead of hanging when the client cannot be made', async () => {
    const storage = new Map<string, unknown>([[roomKey(ROOM_ID), record()]]);
    let deliver: (m: ToPanel) => void = () => undefined;
    session = new PanelSession({
      port: {
        send: () => undefined,
        onMessage: (cb) => {
          deliver = cb;
          return () => undefined;
        },
        onDisconnect: () => () => undefined,
      },
      storage: { get: async (key) => storage.get(key), set: async () => undefined },
      createClient: () => {
        throw new Error('supabaseKey is required.');
      },
    });
    deliver({ type: 'bind', room_id: ROOM_ID });
    await vi.waitFor(() => expect(session!.store.get().phase).toBe('error'));
    expect(session.store.get().error).toBe('Something went wrong on our side. Try again in a moment.');
  });
});
