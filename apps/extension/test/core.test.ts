import { beforeEach, describe, expect, it } from 'vitest';
import type { HandoverMessage } from '@watchparty/sync-core';
import { authKey, roomKey, tabKey, tokensKey, WorkerCore, type KeyValueStore, type RoomRecord } from '../src/background/core';
import { ENGINE_SESSION, FakePort, flush, OTHER_ROOM_ID, ROOM_ID } from './helpers';

const ORIGIN = 'http://localhost:3000';

class MemoryStore implements KeyValueStore {
  data = new Map<string, unknown>();
  async get(keys: string[]) {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (this.data.has(k)) out[k] = structuredClone(this.data.get(k));
    return out;
  }
  async set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v));
  }
  async remove(keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }
}

function handover(partial: Partial<HandoverMessage> = {}): HandoverMessage {
  return {
    type: 'handover',
    room_id: ROOM_ID,
    slug: 'abcDEF1234',
    source: 'netflix',
    content_ref: 'https://www.netflix.com/watch/81234567?trackId=99',
    engine_session: ENGINE_SESSION,
    session: { access_token: 'access-1', refresh_token: 'refresh-1' },
    ...partial,
  };
}

let store: MemoryStore;
let opened: string[];
let bindings: Array<[number, string | null]>;
let stops: Array<[number, string]>;
let panelConnected: boolean;
let onStop: ((tabId: number) => void) | null;
let nextTabId: number | null;
let timers: Array<() => void>;
let core: WorkerCore;

beforeEach(() => {
  store = new MemoryStore();
  opened = [];
  bindings = [];
  stops = [];
  panelConnected = true;
  onStop = null;
  nextTabId = 42;
  timers = [];
  core = new WorkerCore({
    store,
    version: '0.1.0',
    allowedOrigins: [ORIGIN, 'https://watch.example'],
    openTab: async (url) => {
      opened.push(url);
      return nextTabId;
    },
    notifyBinding: (tabId, roomId) => bindings.push([tabId, roomId]),
    sendStop: (tabId, reason) => {
      if (!panelConnected) return false;
      stops.push([tabId, reason]);
      if (onStop) queueMicrotask(() => onStop?.(tabId));
      return true;
    },
    setTimeout: (cb) => {
      timers.push(cb);
    },
  });
});

/** The panel answers a stop by writing its newest tokens and replying `stopped`. */
function panelAnswersWith(tokens: { access_token: string; refresh_token: string }, roomId = ROOM_ID) {
  onStop = (tabId) => {
    void store.set({ [tokensKey(roomId)]: tokens }).then(() => core.handlePanelMessage({ type: 'stopped', room_id: roomId }, tabId));
  };
}

describe('detection', () => {
  it('answers ping with pong and the version', async () => {
    expect(await core.handleExternal({ type: 'ping' }, ORIGIN)).toEqual({ type: 'pong', version: '0.1.0' });
  });

  it('refuses pages that are not the app', async () => {
    expect(await core.handleExternal({ type: 'ping' }, 'https://evil.example')).toEqual({
      type: 'handover_refused',
      reason: 'origin_not_allowed',
    });
    expect(await core.handleExternal({ type: 'ping' }, undefined)).toMatchObject({ type: 'handover_refused' });
  });

  it('refuses messages that do not match the schema', async () => {
    expect(await core.handleExternal({ type: 'handover', room_id: ROOM_ID }, ORIGIN)).toEqual({
      type: 'handover_refused',
      reason: 'invalid_message',
    });
  });
});

describe('handover', () => {
  it('stores the session, opens the title and binds the tab', async () => {
    const reply = await core.handleExternal(handover(), ORIGIN);
    expect(reply).toEqual({ type: 'handover_ok' });
    expect(opened).toEqual(['https://www.netflix.com/watch/81234567?trackId=99']);
    const record = store.data.get(roomKey(ROOM_ID)) as RoomRecord;
    expect(record).toMatchObject({
      room_id: ROOM_ID,
      slug: 'abcDEF1234',
      source: 'netflix',
      engine_session: ENGINE_SESSION,
      session: { access_token: 'access-1', refresh_token: 'refresh-1' },
      tab_id: 42,
      released: false,
    });
    expect(store.data.get(tokensKey(ROOM_ID))).toEqual({ access_token: 'access-1', refresh_token: 'refresh-1' });
    expect(store.data.get(tabKey(42))).toBe(ROOM_ID);
    expect(bindings).toEqual([[42, ROOM_ID]]);
    expect(await core.bindingFor(42)).toBe(ROOM_ID);
    expect(await core.bindingFor(43)).toBeNull();
  });

  it('clears Supabase storage left from an earlier handover of the same room', async () => {
    store.data.set(authKey(ROOM_ID), '{"access_token":"old"}');
    await core.handleExternal(handover(), ORIGIN);
    expect(store.data.has(authKey(ROOM_ID))).toBe(false);
  });

  it.each([
    ['a YouTube room', handover({ source: 'youtube' }), 'unsupported_source'],
    ['a title on another site', handover({ content_ref: 'https://evil.example/watch/1' }), 'invalid_content_ref'],
    ['a Prime title under the Netflix source', handover({ content_ref: 'https://www.primevideo.com/detail/X' }), 'invalid_content_ref'],
    ['a page that is not a watch page', handover({ content_ref: 'https://www.netflix.com/title/80100172' }), 'not_a_watch_page'],
    ['a plain http address', handover({ content_ref: 'http://www.netflix.com/watch/1' }), 'invalid_content_ref'],
  ])('refuses %s', async (_label, message, reason) => {
    expect(await core.handleExternal(message, ORIGIN)).toEqual({ type: 'handover_refused', reason });
    expect(opened).toEqual([]);
    expect(store.data.size).toBe(0);
  });

  it('forgets the session when the tab cannot open', async () => {
    nextTabId = null;
    expect(await core.handleExternal(handover(), ORIGIN)).toEqual({ type: 'handover_refused', reason: 'tab_failed' });
    expect(store.data.size).toBe(0);
  });

  it('stops the earlier tab when the same room is handed over again', async () => {
    await core.handleExternal(handover(), ORIGIN);
    nextTabId = 50;
    timers.length = 0;
    const second = core.handleExternal(handover({ session: { access_token: 'a2', refresh_token: 'r2' } }), ORIGIN);
    await flush();
    timers.forEach((t) => t());
    expect(await second).toEqual({ type: 'handover_ok' });
    expect(stops).toEqual([[42, 'replaced']]);
    expect(store.data.has(tabKey(42))).toBe(false);
    expect(store.data.get(tabKey(50))).toBe(ROOM_ID);
    expect(store.data.get(tokensKey(ROOM_ID))).toEqual({ access_token: 'a2', refresh_token: 'r2' });
  });
});

describe('reclaim from the room page', () => {
  it('stops the panel, returns the newest tokens and forgets the session', async () => {
    await core.handleExternal(handover(), ORIGIN);
    store.data.set(authKey(ROOM_ID), 'supabase session');
    const page = new FakePort();
    await core.addRoomPagePort(ROOM_ID, page);
    panelAnswersWith({ access_token: 'access-2', refresh_token: 'refresh-2' });
    await core.handleRoomPageMessage(ROOM_ID, page, { type: 'reclaim', room_id: ROOM_ID });
    expect(stops).toEqual([[42, 'reclaimed']]);
    expect(page.sent).toEqual([
      { type: 'return', room_id: ROOM_ID, session: { access_token: 'access-2', refresh_token: 'refresh-2' } },
    ]);
    expect(store.data.size).toBe(0);
  });

  it('returns the stored tokens when the panel does not answer in time', async () => {
    await core.handleExternal(handover(), ORIGIN);
    const page = new FakePort();
    await core.addRoomPagePort(ROOM_ID, page);
    const done = core.handleRoomPageMessage(ROOM_ID, page, { type: 'reclaim', room_id: ROOM_ID });
    await flush();
    expect(timers).toHaveLength(1);
    timers[0]!();
    await done;
    expect(page.sent).toEqual([
      { type: 'return', room_id: ROOM_ID, session: { access_token: 'access-1', refresh_token: 'refresh-1' } },
    ]);
  });

  it('returns straight away when no panel is connected', async () => {
    await core.handleExternal(handover(), ORIGIN);
    panelConnected = false;
    const page = new FakePort();
    await core.addRoomPagePort(ROOM_ID, page);
    await core.handleRoomPageMessage(ROOM_ID, page, { type: 'reclaim', room_id: ROOM_ID });
    expect(page.sent).toHaveLength(1);
    expect(timers).toHaveLength(0);
  });

  it('ignores a reclaim for another room on the port', async () => {
    await core.handleExternal(handover(), ORIGIN);
    const page = new FakePort();
    await core.addRoomPagePort(ROOM_ID, page);
    await core.handleRoomPageMessage(ROOM_ID, page, { type: 'reclaim', room_id: OTHER_ROOM_ID });
    await core.handleRoomPageMessage(ROOM_ID, page, { type: 'handover' });
    expect(page.sent).toEqual([]);
    expect(store.data.has(roomKey(ROOM_ID))).toBe(true);
  });

  it('answers a reclaim sent as a one off message with the return message', async () => {
    await core.handleExternal(handover(), ORIGIN);
    panelConnected = false;
    expect(await core.handleExternal({ type: 'reclaim', room_id: ROOM_ID }, ORIGIN)).toEqual({
      type: 'return',
      room_id: ROOM_ID,
      session: { access_token: 'access-1', refresh_token: 'refresh-1' },
    });
    expect(await core.handleExternal({ type: 'reclaim', room_id: ROOM_ID }, ORIGIN)).toEqual({
      type: 'handover_refused',
      reason: 'no_session',
    });
  });
});

describe('streaming tab closes', () => {
  it('returns the session to an open room page', async () => {
    await core.handleExternal(handover(), ORIGIN);
    await store.set({ [tokensKey(ROOM_ID)]: { access_token: 'access-3', refresh_token: 'refresh-3' } });
    const page = new FakePort();
    await core.addRoomPagePort(ROOM_ID, page);
    await core.onTabRemoved(42);
    expect(page.sent).toEqual([
      { type: 'return', room_id: ROOM_ID, session: { access_token: 'access-3', refresh_token: 'refresh-3' } },
    ]);
    expect(store.data.size).toBe(0);
  });

  it('drops the session when no room page is open', async () => {
    await core.handleExternal(handover(), ORIGIN);
    const page = new FakePort();
    await core.addRoomPagePort(ROOM_ID, page);
    core.removeRoomPagePort(ROOM_ID, page);
    await core.onTabRemoved(42);
    expect(page.sent).toEqual([]);
    expect(store.data.size).toBe(0);
  });

  it('leaves other rooms alone', async () => {
    await core.handleExternal(handover(), ORIGIN);
    await core.onTabRemoved(99);
    expect(store.data.has(roomKey(ROOM_ID))).toBe(true);
  });
});

describe('the panel gives the session up', () => {
  it('returns it at once when the room page is open', async () => {
    await core.handleExternal(handover(), ORIGIN);
    const page = new FakePort();
    await core.addRoomPagePort(ROOM_ID, page);
    await core.handlePanelMessage({ type: 'release', room_id: ROOM_ID }, 42);
    expect(page.sent).toHaveLength(1);
    expect(store.data.size).toBe(0);
  });

  it('keeps it until a room page connects', async () => {
    await core.handleExternal(handover(), ORIGIN);
    await core.handlePanelMessage({ type: 'release', room_id: ROOM_ID }, 42);
    expect((store.data.get(roomKey(ROOM_ID)) as RoomRecord).released).toBe(true);
    const page = new FakePort();
    await core.addRoomPagePort(ROOM_ID, page);
    expect(page.sent).toEqual([
      { type: 'return', room_id: ROOM_ID, session: { access_token: 'access-1', refresh_token: 'refresh-1' } },
    ]);
    expect(store.data.size).toBe(0);
  });

  it('ignores a release from a tab that does not hold the room', async () => {
    await core.handleExternal(handover(), ORIGIN);
    await core.handlePanelMessage({ type: 'release', room_id: ROOM_ID }, 7);
    expect((store.data.get(roomKey(ROOM_ID)) as RoomRecord).released).toBe(false);
  });
});
