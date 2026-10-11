import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineView } from '@watchparty/sync-core';
import { PortEngineHost, TAP_TIMEOUT_MS } from '../src/panel/port-engine-host';
import type { PanelToContent, PlayerSnapshot } from '../src/shared/messages';
import { stateRow } from './helpers';

const caps = { seek: false, fineRate: false, volume: true, seekLatencySec: 0.5 };
const view: EngineView = {
  mode: 'playing',
  seq: 1,
  expected: 10,
  local: 10,
  drift: 0,
  countdownMs: null,
  nudging: false,
  buffering: false,
  seekLatencySec: 0.5,
  manualSeek: true,
};

let sent: PanelToContent[];
let offset: number;
let wall: number;
let timeouts: Array<{ cb: () => void; ms: number }>;
let intervals: Array<() => void>;
let host: PortEngineHost;

function snapshot(partial: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return { position: 10, duration: 1200, buffering: false, paused: false, volume: 1, volume_seq: 0, rate: 1, at: wall, ...partial };
}

beforeEach(() => {
  sent = [];
  offset = 120;
  wall = 50_000;
  timeouts = [];
  intervals = [];
  host = new PortEngineHost({
    send: (m) => sent.push(m),
    capabilities: caps,
    serverOffset: () => offset,
    wallNow: () => wall,
    setInterval: (cb) => {
      intervals.push(cb);
      return intervals.length;
    },
    clearInterval: () => undefined,
    setTimeout: (cb, ms) => {
      timeouts.push({ cb, ms });
    },
  });
});

describe('PortEngineHost', () => {
  it('sends the clock offset at once and again only when it changes', () => {
    expect(sent).toEqual([{ type: 'server_offset', offset_ms: 120 }]);
    intervals[0]!();
    expect(sent).toHaveLength(1);
    offset = 140;
    intervals[0]!();
    expect(sent.at(-1)).toEqual({ type: 'server_offset', offset_ms: 140 });
  });

  it('sends state, hold, resync and suspend to the content script', () => {
    const row = stateRow({ seq: 4 });
    host.applyState(row);
    host.holdForLocalAction();
    host.resync();
    host.stop();
    expect(sent.slice(1)).toEqual([{ type: 'state', row }, { type: 'hold' }, { type: 'resync' }, { type: 'suspend' }]);
  });

  it('resends the offset and the last state to a reconnected content script', () => {
    const row = stateRow({ seq: 9 });
    host.applyState(row);
    sent = [];
    host.resend();
    expect(sent).toEqual([{ type: 'server_offset', offset_ms: 120 }, { type: 'state', row }]);
  });

  it('passes views, user actions, buffering and the end to the controller', () => {
    const views: EngineView[] = [];
    const actions: unknown[] = [];
    const buffering: boolean[] = [];
    let ended = 0;
    host.onView((v) => views.push(v));
    host.onUserAction((a) => actions.push(a));
    host.onBuffering((b) => buffering.push(b));
    host.onEnded(() => ended++);
    host.receive({ type: 'view', view, player: snapshot() });
    host.receive({ type: 'user_action', action: { kind: 'play', position: 3 } });
    host.receive({ type: 'buffering', buffering: true });
    host.receive({ type: 'ended' });
    expect(views).toEqual([view]);
    expect(actions).toEqual([{ kind: 'play', position: 3 }]);
    expect(buffering).toEqual([true]);
    expect(host.isBuffering()).toBe(true);
    expect(ended).toBe(1);
  });

  it('projects the position forward while playing and holds it while paused', () => {
    host.receive({ type: 'view', view, player: snapshot({ position: 10, at: wall }) });
    wall += 500;
    expect(host.getPosition()).toBeCloseTo(10.5);
    host.receive({ type: 'view', view, player: snapshot({ position: 10, paused: true, at: wall }) });
    wall += 500;
    expect(host.getPosition()).toBe(10);
    expect(host.getDuration()).toBe(1200);
  });

  it('resolves a tap with the content script’s answer, or blocked after a timeout', async () => {
    const first = host.tapToPlay();
    const tap = sent.at(-1) as Extract<PanelToContent, { type: 'tap' }>;
    expect(tap.type).toBe('tap');
    host.receive({ type: 'tap_result', id: tap.id, result: 'ok' });
    expect(await first).toBe('ok');

    const second = host.tapToPlay();
    expect(timeouts.at(-1)?.ms).toBe(TAP_TIMEOUT_MS);
    timeouts.at(-1)!.cb();
    expect(await second).toBe('blocked');
  });

  it('keeps the volume it sent until a reading confirms it, so ducking is not confused', () => {
    host.receive({ type: 'view', view, player: snapshot({ volume: 0.8, volume_seq: 0 }) });
    expect(host.getVolume()).toBe(0.8);
    host.setVolume(0.28);
    expect(sent.at(-1)).toEqual({ type: 'volume', level: 0.28, seq: 1 });
    // A reading taken before the change arrived.
    host.receive({ type: 'view', view, player: snapshot({ volume: 0.8, volume_seq: 0 }) });
    expect(host.getVolume()).toBe(0.28);
    // The member then moves the service's own volume slider.
    host.receive({ type: 'view', view, player: snapshot({ volume: 0.5, volume_seq: 1 }) });
    expect(host.getVolume()).toBe(0.5);
  });

  it('does not set volume when the player cannot', () => {
    host.setCapabilities({ ...caps, volume: false });
    host.setVolume(0.2);
    expect(sent.some((m) => m.type === 'volume')).toBe(false);
    expect(host.capabilities.volume).toBe(false);
  });

  it('settles open taps and drops listeners when disposed', async () => {
    const pending = host.tapToPlay();
    const views: EngineView[] = [];
    host.onView((v) => views.push(v));
    host.dispose();
    expect(await pending).toBe('blocked');
    host.receive({ type: 'view', view, player: snapshot() });
    expect(views).toEqual([]);
    expect(sent.at(-1)).toEqual({ type: 'suspend' });
  });
});
