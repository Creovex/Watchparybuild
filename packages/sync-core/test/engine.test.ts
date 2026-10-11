import { beforeEach, describe, expect, it } from 'vitest';
import {
  SyncEngine,
  TICK_MS,
  type EngineLogEntry,
  type EngineState,
  type EngineView,
} from '../src/engine';
import type { UserAction } from '../src/adapter';
import { FakeAdapter, FakeTime } from './fake-adapter';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let time: FakeTime;
let adapter: FakeAdapter;
let engine: SyncEngine;
let logs: EngineLogEntry[];
let views: EngineView[];
let actions: UserAction[];

function setup(caps: ConstructorParameters<typeof FakeAdapter>[0] = {}) {
  time = new FakeTime();
  adapter = new FakeAdapter(caps);
  logs = [];
  views = [];
  actions = [];
  engine = new SyncEngine({
    adapter,
    now: time.now,
    serverNow: time.serverNow,
    log: (e) => logs.push(e),
  });
  engine.onView((v) => views.push(v));
  engine.onUserAction((a) => actions.push(a));
}

let nextSeq = 1;
function state(partial: Partial<EngineState> = {}): EngineState {
  return {
    seq: nextSeq++,
    status: 'playing',
    position_sec: 0,
    rate: 1,
    server_ts: time.serverNow(),
    ...partial,
  };
}

/** Advance time in engine ticks, moving the simulated player and running the engine each tick. */
async function run(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    time.local += TICK_MS;
    adapter.advance(TICK_MS);
    engine.tick();
    await flush();
  }
}

const lastView = () => views[views.length - 1]!;

beforeEach(() => {
  nextSeq = 1;
  setup();
});

describe('state application', () => {
  it('applies rows only by increasing seq', () => {
    expect(engine.applyState(state({ seq: 5 }))).toBe(true);
    expect(engine.applyState(state({ seq: 5 }))).toBe(false);
    expect(engine.applyState(state({ seq: 4 }))).toBe(false);
    expect(engine.seq).toBe(5);
    expect(engine.currentState?.seq).toBe(5);
  });

  it('does nothing before any state arrives', async () => {
    await run(1000);
    expect(adapter.calls).toEqual([]);
    expect(engine.currentView.mode).toBe('idle');
  });
});

describe('step 1: ended', () => {
  it('pauses and shows finished, then stops correcting', async () => {
    adapter.paused = false;
    engine.applyState(state({ status: 'ended', position_sec: 300 }));
    await run(TICK_MS);
    expect(adapter.count('pause')).toBe(1);
    expect(lastView().mode).toBe('ended');
    adapter.position = 10;
    await run(3000);
    expect(adapter.count('seek')).toBe(0);
    expect(adapter.count('play')).toBe(0);
  });
});

describe('step 2: countdown', () => {
  it('holds paused at the position, then plays when the start time arrives', async () => {
    adapter.paused = false;
    adapter.position = 42;
    engine.applyState(state({ position_sec: 10, server_ts: time.serverNow() + 4000 }));
    await run(TICK_MS);
    expect(adapter.count('pause')).toBe(1);
    expect(adapter.last('seek')?.value).toBe(10);
    expect(lastView().mode).toBe('countdown');
    expect(lastView().countdownMs).toBe(3750);
    expect(lastView().expected).toBe(10);
    await run(3500);
    expect(adapter.count('play')).toBe(0);
    await run(500);
    expect(adapter.count('play')).toBe(1);
    expect(adapter.paused).toBe(false);
  });

  it('does not seek during the countdown when already within 0.3 seconds', async () => {
    adapter.position = 10.2;
    engine.applyState(state({ position_sec: 10, server_ts: time.serverNow() + 2000 }));
    await run(TICK_MS);
    expect(adapter.count('seek')).toBe(0);
  });
});

describe('step 3: status', () => {
  it('plays when expected is playing and the player is paused', async () => {
    engine.applyState(state());
    await run(TICK_MS);
    expect(adapter.count('play')).toBe(1);
    expect(adapter.paused).toBe(false);
  });

  it('does not play while the player is paused because it is buffering', async () => {
    adapter.buffering = true;
    engine.applyState(state());
    await run(1000);
    expect(adapter.count('play')).toBe(0);
  });

  it('enters the blocked state and makes no further play calls until the tap', async () => {
    adapter.playResult = 'blocked';
    engine.applyState(state());
    await run(2000);
    expect(adapter.count('play')).toBe(1);
    expect(lastView().mode).toBe('blocked');
    expect(logs.some((l) => l.event === 'blocked')).toBe(true);
    adapter.playResult = 'ok';
    const result = await engine.tapToPlay();
    expect(result).toBe('ok');
    expect(adapter.count('play')).toBe(2);
    await run(TICK_MS);
    expect(lastView().mode).toBe('playing');
  });

  it('stays blocked when the tap is also refused', async () => {
    adapter.playResult = 'blocked';
    engine.applyState(state());
    await run(TICK_MS);
    expect(await engine.tapToPlay()).toBe('blocked');
    await run(1000);
    expect(lastView().mode).toBe('blocked');
  });

  it('pauses when expected is paused and the player is playing', async () => {
    adapter.paused = false;
    adapter.position = 30;
    engine.applyState(state({ status: 'paused', position_sec: 30 }));
    await run(TICK_MS);
    expect(adapter.count('pause')).toBe(1);
    expect(lastView().mode).toBe('paused');
  });

  it('seeks while paused when more than 0.3 seconds away, without repeating the seek', async () => {
    adapter.position = 25;
    engine.applyState(state({ status: 'paused', position_sec: 30 }));
    adapter.seekError = 5; // the player has not landed yet
    await run(1000);
    expect(adapter.count('seek')).toBe(1);
    expect(adapter.last('seek')?.value).toBe(30);
  });

  it('treats a seek while paused as not hard', async () => {
    adapter.position = 25;
    engine.applyState(state({ status: 'paused', position_sec: 30 }));
    await run(TICK_MS);
    expect(logs.some((l) => l.event === 'hard_seek')).toBe(false);
  });

  it('applies the state rate when it changes', async () => {
    engine.applyState(state({ rate: 1 }));
    await run(500);
    engine.applyState(state({ rate: 1.5, position_sec: adapter.position }));
    await run(TICK_MS);
    expect(adapter.rate).toBe(1.5);
  });
});

describe('step 4: drift with fine rate', () => {
  let startTs = 0;
  beforeEach(async () => {
    adapter.paused = false;
    startTs = time.serverNow();
    engine.applyState(state({ server_ts: startTs }));
    await run(1500);
  });

  it('hard seeks to expected plus seek latency above 2 seconds', async () => {
    adapter.position += 3;
    await run(1000);
    const seek = adapter.last('seek');
    expect(seek).toBeDefined();
    const expectedNow = (time.serverNow() - startTs) / 1000;
    expect(seek!.value!).toBeGreaterThan(expectedNow - 1 + 0.3);
    expect(seek!.value!).toBeLessThanOrEqual(expectedNow + 0.3 + 1e-9);
    expect(logs.filter((l) => l.event === 'hard_seek')).toHaveLength(1);
  });

  it('nudges at 0.95 when ahead and stops at 0.05', async () => {
    adapter.position += 0.4;
    await run(1000);
    expect(adapter.rate).toBeCloseTo(0.95);
    expect(lastView().nudging).toBe(true);
    // run until it closes the gap
    await run(10000);
    expect(adapter.rate).toBe(1);
    expect(lastView().nudging).toBe(false);
    expect(Math.abs(lastView().drift!)).toBeLessThanOrEqual(0.15);
  });

  it('nudges at 1.05 when behind', async () => {
    adapter.position -= 0.5;
    await run(1000);
    expect(adapter.rate).toBeCloseTo(1.05);
  });

  it('does not nudge at or below 0.15 seconds', async () => {
    adapter.position += 0.1;
    await run(2000);
    expect(adapter.rate).toBe(1);
  });

  it('stops nudging when drift changes sign', async () => {
    adapter.position += 0.4;
    await run(1000);
    expect(adapter.rate).toBeCloseTo(0.95);
    adapter.position -= 1.0; // now behind
    await run(1000);
    expect(adapter.rate).toBe(1);
  });

  it('skips drift checks while buffering', async () => {
    adapter.position += 5;
    adapter.buffering = true;
    await run(3000);
    expect(adapter.count('seek')).toBe(0);
  });

  it('allows at most one hard seek every 5 seconds', async () => {
    adapter.seekError = 4; // every seek lands 4 seconds ahead
    adapter.position += 4;
    await run(1000);
    expect(adapter.count('seek')).toBe(1);
    await run(3000);
    expect(adapter.count('seek')).toBe(1);
    await run(2000);
    expect(adapter.count('seek')).toBe(2);
  });

  it("stops after 3 hard seeks that each leave drift above 2 seconds, and a tap resets", async () => {
    adapter.seekError = 4;
    adapter.position += 4;
    await run(20000);
    expect(adapter.count('seek')).toBe(3);
    expect(lastView().mode).toBe('cant_keep_up');
    expect(engine.hardSeekFailures).toBe(3);
    const entry = logs.find((l) => l.event === 'cant_keep_up');
    expect(entry?.detail.drifts).toHaveLength(3);
    await run(10000);
    expect(adapter.count('seek')).toBe(3);

    adapter.seekError = 0;
    engine.resync();
    expect(engine.hardSeekFailures).toBe(0);
    await run(2000);
    expect(adapter.count('seek')).toBe(4);
    expect(lastView().mode).toBe('playing');
  });

  it('resets the failure count after a hard seek that lands', async () => {
    adapter.seekError = 4;
    adapter.position += 4;
    await run(3000);
    expect(engine.hardSeekFailures).toBe(1);
    adapter.seekError = 0;
    await run(7000);
    expect(engine.hardSeekFailures).toBe(0);
  });
});

describe('step 4: drift without fine rate', () => {
  beforeEach(async () => {
    setup({ fineRate: false });
    adapter.paused = false;
    engine.applyState(state());
    await run(1500);
  });

  it('hard seeks above 0.5 seconds', async () => {
    adapter.position += 0.8;
    await run(1000);
    expect(adapter.count('seek')).toBe(1);
    expect(adapter.count('rate')).toBe(1); // only the initial rate, no nudge
  });

  it('leaves drift at or below 0.5 seconds alone', async () => {
    adapter.position += 0.45;
    await run(3000);
    expect(adapter.count('seek')).toBe(0);
  });
});

describe('alignment after a new state', () => {
  it('follows a remote seek immediately, even right after a hard seek', async () => {
    engine.applyState(state());
    await run(1500);
    adapter.position += 3;
    await run(1000);
    expect(adapter.count('seek')).toBe(1);
    // the host seeks to 120 seconds one second later
    engine.applyState(state({ position_sec: 120 }));
    await run(TICK_MS);
    expect(adapter.count('seek')).toBe(2);
    expect(adapter.last('seek')?.value).toBeGreaterThan(120.2);
    expect(adapter.last('seek')?.value).toBeLessThan(121);
    expect(logs.filter((l) => l.event === 'hard_seek')).toHaveLength(1);
  });
});

describe('adapters that cannot seek', () => {
  it('never seeks and asks the member to seek by hand', async () => {
    setup({ seek: false });
    engine.applyState(state());
    await run(1000);
    adapter.position += 10;
    await run(6000);
    expect(adapter.count('seek')).toBe(0);
    expect(lastView().manualSeek).toBe(true);
  });
});

describe('seek latency', () => {
  it('becomes the average of the last 5 measured seeks', async () => {
    setup({ fineRate: false });
    adapter.paused = false;
    engine.applyState(state());
    await run(1500);
    expect(lastView().seekLatencySec).toBe(0.3);
    const buffers = [500, 1000, 500, 1000, 500, 1000];
    for (const ms of buffers) {
      adapter.bufferOnSeekMs = ms;
      adapter.position += 3;
      await run(6000);
    }
    // the first 500 ms sample has rolled out; the last five average 0.8
    expect(lastView().seekLatencySec).toBeCloseTo(0.8, 2);
  });
});

describe('engine changes versus user changes', () => {
  it("filters the engine's own play and reports the member's pause", async () => {
    engine.applyState(state());
    await run(TICK_MS);
    adapter.emitAction({ kind: 'play', position: 0 });
    expect(actions).toEqual([]);
    adapter.emitAction({ kind: 'pause', position: 1 });
    expect(actions).toEqual([{ kind: 'pause', position: 1 }]);
  });

  it('reports an engine-looking change once its record expires after 1.5 seconds', async () => {
    engine.applyState(state());
    await run(TICK_MS);
    time.local += 1600;
    adapter.emitAction({ kind: 'play', position: 0 });
    expect(actions).toHaveLength(1);
  });

  it('matches a seek within 1 second of the target and reports one further away', async () => {
    adapter.position = 0;
    engine.applyState(state({ status: 'paused', position_sec: 50 }));
    await run(TICK_MS);
    adapter.emitAction({ kind: 'seek', position: 50.8 });
    expect(actions).toEqual([]);
    adapter.emitAction({ kind: 'seek', position: 80 });
    expect(actions).toEqual([{ kind: 'seek', position: 80 }]);
  });

  it('holds corrections after a local controller action until the new state arrives', async () => {
    engine.applyState(state());
    await run(500);
    adapter.paused = true; // the host pressed pause
    engine.holdForLocalAction();
    await run(1000);
    expect(adapter.count('play')).toBe(1);
    engine.applyState(state({ status: 'paused', position_sec: adapter.position }));
    await run(TICK_MS);
    expect(lastView().mode).toBe('paused');
  });

  it('restores a guest pause on the next tick when the guest is not a controller', async () => {
    engine.applyState(state());
    await run(500);
    adapter.paused = true;
    adapter.emitAction({ kind: 'pause', position: adapter.position });
    await run(TICK_MS);
    expect(adapter.paused).toBe(false);
  });
});

describe('lifecycle', () => {
  it('stops ticking and unsubscribes after stop', async () => {
    engine.applyState(state());
    engine.stop();
    await run(1000);
    expect(adapter.count('play')).toBe(0);
    adapter.emitAction({ kind: 'pause', position: 0 });
    expect(actions).toEqual([]);
  });

  it('delivers the current view to a new listener immediately', () => {
    const seen: EngineView[] = [];
    engine.onView((v) => seen.push(v))();
    expect(seen).toHaveLength(1);
  });
});
