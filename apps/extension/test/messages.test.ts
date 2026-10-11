import { describe, expect, it } from 'vitest';
import {
  ContentToPanel,
  PanelToContent,
  PanelToWorker,
  parseMessage,
  roomIdFromPortName,
  ToContent,
  ToPanel,
  WorkerToPanel,
} from '../src/shared/messages';
import { ROOM_ID, stateRow } from './helpers';

const view = {
  mode: 'playing',
  seq: 3,
  expected: 10,
  local: 10.2,
  drift: 0.2,
  countdownMs: null,
  nudging: false,
  buffering: false,
  seekLatencySec: 0.5,
  manualSeek: true,
};
const player = { position: 10.2, duration: 1200, buffering: false, paused: false, volume: 0.8, volume_seq: 2, rate: 1, at: 1000 };

describe('content to panel messages', () => {
  it.each([
    { type: 'capabilities', source: 'netflix', capabilities: { seek: false, fineRate: false, volume: true, seekLatencySec: 0.5 }, video: true },
    { type: 'view', view, player },
    { type: 'user_action', action: { kind: 'pause', position: 12 } },
    { type: 'buffering', buffering: true },
    { type: 'ended' },
    { type: 'content_ref', url: 'https://www.netflix.com/watch/81234567?trackId=1', title_key: 'netflix:81234567' },
    { type: 'fullscreen', on: true },
    { type: 'tap_result', id: 2, result: 'blocked' },
    { type: 'fs_action', action: 'mic' },
    { type: 'fs_action', action: 'react', emoji: '🍿' },
  ])('accepts $type', (message) => {
    expect(ContentToPanel.safeParse(message).success).toBe(true);
    expect(ToPanel.safeParse(message).success).toBe(true);
  });

  it.each([
    ['an unknown type', { type: 'state_please' }],
    ['a source that is not paid', { type: 'capabilities', source: 'youtube', capabilities: { seek: true, fineRate: true, volume: true, seekLatencySec: 0.3 }, video: true }],
    ['a view with an unknown mode', { type: 'view', view: { ...view, mode: 'dancing' }, player }],
    ['a volume above 1', { type: 'view', view, player: { ...player, volume: 2 } }],
    ['a user action of another kind', { type: 'user_action', action: { kind: 'rate', position: 1 } }],
    ['an address that is not a URL', { type: 'content_ref', url: 'not a url', title_key: null }],
    ['an emoji outside the eight', { type: 'fs_action', action: 'react', emoji: '💩' }],
    ['a full screen action without a kind', { type: 'fs_action' }],
    ['a non object', 'hello'],
  ])('drops %s', (_label, message) => {
    expect(ContentToPanel.safeParse(message).success).toBe(false);
  });
});

describe('panel to content messages', () => {
  it.each([
    { type: 'state', row: stateRow() },
    { type: 'server_offset', offset_ms: -250.5 },
    { type: 'hold' },
    { type: 'tap', id: 1 },
    { type: 'resync' },
    { type: 'volume', level: 0.35, seq: 1 },
    { type: 'suspend' },
    { type: 'navigate', url: 'https://www.netflix.com/watch/1' },
    { type: 'panel_ui', collapsed: true },
    { type: 'fs_state', voice: 'live', unread: 3 },
  ])('accepts $type', (message) => {
    expect(PanelToContent.safeParse(message).success).toBe(true);
    expect(ToContent.safeParse(message).success).toBe(true);
  });

  it.each([
    ['a state row without a seq', { type: 'state', row: { ...stateRow(), seq: undefined } }],
    ['a state row with a bad status', { type: 'state', row: stateRow({ status: 'rewinding' as never }) }],
    ['a volume above 1', { type: 'volume', level: 1.5, seq: 1 }],
    ['a volume without a sequence number', { type: 'volume', level: 0.5 }],
    ['a negative unread count', { type: 'fs_state', voice: 'live', unread: -1 }],
  ])('drops %s', (_label, message) => {
    expect(PanelToContent.safeParse(message).success).toBe(false);
  });
});

describe('worker messages', () => {
  it('accepts bind with a room or none, peer and stop', () => {
    expect(WorkerToPanel.safeParse({ type: 'bind', room_id: ROOM_ID }).success).toBe(true);
    expect(WorkerToPanel.safeParse({ type: 'bind', room_id: null }).success).toBe(true);
    expect(WorkerToPanel.safeParse({ type: 'peer', connected: true }).success).toBe(true);
    expect(WorkerToPanel.safeParse({ type: 'stop', reason: 'reclaimed' }).success).toBe(true);
    expect(WorkerToPanel.safeParse({ type: 'bind', room_id: 'room-1' }).success).toBe(false);
    expect(ToContent.safeParse({ type: 'bound', bound: true }).success).toBe(true);
  });

  it('keeps panel to worker messages apart from relayed ones', () => {
    expect(PanelToWorker.safeParse({ type: 'stopped', room_id: ROOM_ID }).success).toBe(true);
    expect(PanelToWorker.safeParse({ type: 'release', room_id: ROOM_ID }).success).toBe(true);
    expect(PanelToContent.safeParse({ type: 'release', room_id: ROOM_ID }).success).toBe(false);
    expect(PanelToWorker.safeParse({ type: 'hold' }).success).toBe(false);
  });

  it('parseMessage returns null and reports invalid input', () => {
    const issues: unknown[] = [];
    expect(parseMessage(PanelToContent, { type: 'nope' }, (i) => issues.push(i))).toBeNull();
    expect(issues).toHaveLength(1);
    expect(parseMessage(PanelToContent, { type: 'hold' })).toEqual({ type: 'hold' });
  });
});

describe('room page port names', () => {
  it('reads the room id from room-page:<roomId>', () => {
    expect(roomIdFromPortName(`room-page:${ROOM_ID}`)).toBe(ROOM_ID);
    expect(roomIdFromPortName('room-page:not-a-uuid')).toBeNull();
    expect(roomIdFromPortName(`panel:${ROOM_ID}`)).toBeNull();
  });
});
