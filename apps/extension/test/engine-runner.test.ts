import { beforeEach, describe, expect, it } from 'vitest';
import { EngineRunner } from '../src/content/engine-runner';
import type { ContentToPanel } from '../src/shared/messages';
import { flush, StubAdapter, stateRow } from './helpers';

let adapter: StubAdapter;
let posted: ContentToPanel[];
let ticks: Array<() => void>;
let cleared: unknown[];
let now: number;
let wall: number;
let runner: EngineRunner;

beforeEach(() => {
  adapter = new StubAdapter();
  posted = [];
  ticks = [];
  cleared = [];
  now = 0;
  wall = 1_000_000;
  runner = new EngineRunner({
    adapter,
    post: (m) => posted.push(m),
    now: () => now,
    wallNow: () => wall,
    setInterval: (cb) => {
      ticks.push(cb);
      return ticks.length;
    },
    clearInterval: (id) => cleared.push(id),
  });
});

const of = <T extends ContentToPanel['type']>(type: T) =>
  posted.filter((m): m is Extract<ContentToPanel, { type: T }> => m.type === type);

describe('EngineRunner', () => {
  it('starts the engine on the first state and plays when the room plays', async () => {
    expect(runner.running).toBe(false);
    await runner.handle({ type: 'state', row: stateRow({ status: 'playing', server_ts: new Date(wall - 1000).toISOString() }) });
    expect(runner.running).toBe(true);
    expect(ticks).toHaveLength(1);
    await flush();
    expect(adapter.calls).toContain('play');
    const views = of('view');
    expect(views.length).toBeGreaterThan(0);
    expect(views.at(-1)?.view.manualSeek).toBe(true);
    expect(views.at(-1)?.player).toMatchObject({ duration: 1200, volume: 1, volume_seq: 0, rate: 1, at: wall });
  });

  it('pauses when the room pauses and never seeks without the capability', async () => {
    adapter.paused = false;
    adapter.position = 50;
    await runner.handle({ type: 'state', row: stateRow({ status: 'paused', position_sec: 10, seq: 2 }) });
    await flush();
    expect(adapter.calls).toContain('pause');
    ticks[0]!();
    expect(adapter.calls.some((c) => c.startsWith('seek'))).toBe(false);
  });

  it('uses the clock offset from the panel for server time', async () => {
    await runner.handle({ type: 'server_offset', offset_ms: 2500 });
    expect(runner.serverNow()).toBe(wall + 2500);
  });

  it('forwards the member’s own actions, buffering and the end of the film', async () => {
    await runner.handle({ type: 'state', row: stateRow() });
    adapter.emitAction({ kind: 'seek', position: 300 });
    adapter.emitBuffering(true);
    adapter.emitEnded();
    expect(of('user_action')).toEqual([{ type: 'user_action', action: { kind: 'seek', position: 300 } }]);
    expect(of('buffering')).toEqual([{ type: 'buffering', buffering: true }]);
    expect(of('ended')).toHaveLength(1);
  });

  it('answers a tap with the play result', async () => {
    await runner.handle({ type: 'state', row: stateRow() });
    await runner.handle({ type: 'tap', id: 7 });
    expect(of('tap_result')).toEqual([{ type: 'tap_result', id: 7, result: 'ok' }]);
    adapter.playResult = 'blocked';
    await runner.handle({ type: 'tap', id: 8 });
    expect(of('tap_result').at(-1)).toEqual({ type: 'tap_result', id: 8, result: 'blocked' });
  });

  it('plays on a tap even before any state arrives', async () => {
    await runner.handle({ type: 'tap', id: 1 });
    expect(adapter.calls).toEqual(['play']);
    expect(of('tap_result')).toEqual([{ type: 'tap_result', id: 1, result: 'ok' }]);
  });

  it('applies volume and echoes the sequence number in the next reading', async () => {
    await runner.handle({ type: 'state', row: stateRow() });
    await runner.handle({ type: 'volume', level: 0.35, seq: 4 });
    expect(adapter.volume).toBe(0.35);
    expect(of('view').at(-1)?.player).toMatchObject({ volume: 0.35, volume_seq: 4 });
  });

  it('holds off corrections after a local action', async () => {
    await runner.handle({ type: 'state', row: stateRow({ status: 'playing', server_ts: new Date(wall - 1000).toISOString() }) });
    await flush();
    adapter.paused = true;
    adapter.calls = [];
    await runner.handle({ type: 'hold' });
    ticks[0]!();
    await flush();
    expect(adapter.calls).toEqual([]);
  });

  it('suspends until the next state, which starts a fresh engine', async () => {
    await runner.handle({ type: 'state', row: stateRow({ seq: 5 }) });
    await runner.handle({ type: 'suspend' });
    expect(runner.running).toBe(false);
    expect(cleared).toEqual([1]);
    const before = posted.length;
    adapter.emitAction({ kind: 'pause', position: 1 });
    expect(of('user_action').length).toBe(0);
    // The fresh engine accepts the same seq again.
    await runner.handle({ type: 'state', row: stateRow({ seq: 5 }) });
    expect(runner.running).toBe(true);
    expect(posted.length).toBeGreaterThan(before);
  });

  it('stops forwarding after destroy', async () => {
    runner.destroy();
    adapter.emitBuffering(true);
    expect(of('buffering')).toEqual([]);
  });
});
