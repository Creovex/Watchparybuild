import type { PlayerAdapter, UserAction } from './adapter';
import { EngineChangeTracker } from './engine-changes';
import { expectedPosition, serverTsMs, type TimedState } from './position';

// The sync engine keeps one member's player aligned with the room's playback state. It runs every
// 250 ms on the member's engine owner: a quarter second keeps reaction to a play or pause quick
// without loading a phone.

export const TICK_MS = 250;
/** Drift is checked once per second, not on every tick. */
export const DRIFT_CHECK_MS = 1000;
/** Above this, seek instead of nudging. */
export const HARD_SEEK_DRIFT = 2.0;
/** Below 0.15 seconds people do not notice voice and picture disagreeing. */
export const NUDGE_START_DRIFT = 0.15;
/** Stop nudging here so the nudge does not overshoot. */
export const NUDGE_STOP_DRIFT = 0.05;
/** Without fine rates, seek only above this: a seek's rebuffer costs more than smaller drift. */
export const COARSE_SEEK_DRIFT = 0.5;
/** A 5 percent rate change is not heard as a pitch change and closes 2 seconds in 40 seconds. */
export const NUDGE_FACTOR = 0.05;
export const HARD_SEEK_INTERVAL_MS = 5000;
export const MAX_FAILED_HARD_SEEKS = 3;
/** While paused, seek back when further than this from the shared position. */
export const PAUSED_TOLERANCE = 0.3;
export const SEEK_LATENCY_SAMPLES = 5;
/** How long a controller's own action holds off corrections while the new state comes back. */
export const LOCAL_ACTION_HOLD_MS = 2000;

export type EngineMode =
  | 'idle'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'blocked'
  | 'cant_keep_up';

export interface EngineView {
  mode: EngineMode;
  seq: number;
  expected: number | null;
  local: number | null;
  /** Local position minus expected position, in seconds. Positive means ahead. */
  drift: number | null;
  countdownMs: number | null;
  nudging: boolean;
  buffering: boolean;
  seekLatencySec: number;
  /** True when this adapter cannot seek, so the member must seek by hand. */
  manualSeek: boolean;
}

export interface EngineLogEntry {
  event: 'cant_keep_up' | 'hard_seek' | 'nudge_start' | 'nudge_stop' | 'blocked';
  detail: Record<string, unknown>;
}

export interface EngineDeps {
  adapter: PlayerAdapter;
  /** Local monotonic or wall clock in milliseconds. */
  now: () => number;
  /** Server time in epoch milliseconds (local time plus the measured offset). */
  serverNow: () => number;
  log?: (entry: EngineLogEntry) => void;
}

export interface EngineState extends TimedState {
  seq: number;
}

type Listener<T> = (value: T) => void;

export class SyncEngine {
  private readonly adapter: PlayerAdapter;
  private readonly deps: EngineDeps;
  private readonly changes = new EngineChangeTracker();
  private state: EngineState | null = null;
  private lastSeq = -1;

  private nudgeSign: 0 | 1 | -1 = 0;
  private appliedRate: number | null = null;
  private lastDriftCheckAt = Number.NEGATIVE_INFINITY;
  private lastHardSeekAt = Number.NEGATIVE_INFINITY;
  private awaitingSeekResult = false;
  private failedHardSeeks = 0;
  private failedDrifts: number[] = [];
  private stopped = false;
  private correctionStopped = false;
  private blocked = false;
  private playInFlight = false;
  private alignOnNextCheck = false;
  private holdUntil = Number.NEGATIVE_INFINITY;
  private pendingLatencyAt: number | null = null;
  private latencies: number[] = [];
  private seekLatencySec: number;

  private view: EngineView;
  private readonly viewListeners = new Set<Listener<EngineView>>();
  private readonly actionListeners = new Set<Listener<UserAction>>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.adapter = deps.adapter;
    this.seekLatencySec = deps.adapter.capabilities.seekLatencySec;
    this.view = this.makeView('idle', null, null);
    this.unsubscribers.push(
      this.adapter.onUserAction((action) => this.handleAdapterAction(action)),
    );
  }

  get seq(): number {
    return this.lastSeq;
  }

  get currentState(): EngineState | null {
    return this.state;
  }

  get currentView(): EngineView {
    return this.view;
  }

  get hardSeekFailures(): number {
    return this.failedHardSeeks;
  }

  /** Applies a playback state only when its seq is higher than the last one applied. */
  applyState(next: EngineState): boolean {
    if (next.seq <= this.lastSeq) return false;
    const previous = this.state;
    this.state = next;
    this.lastSeq = next.seq;
    this.holdUntil = Number.NEGATIVE_INFINITY;
    // A new state is a discontinuity (someone played, paused or seeked): align straight away rather
    // than waiting for the next drift check or the hard seek interval.
    this.alignOnNextCheck = true;
    this.lastDriftCheckAt = Number.NEGATIVE_INFINITY;
    this.awaitingSeekResult = false;
    if (next.status !== 'playing' || (previous && previous.rate !== next.rate)) this.stopNudge(false);
    return true;
  }

  /** Called when this member, as a controller, changed playback locally and sent it to the room. */
  holdForLocalAction(): void {
    this.holdUntil = this.deps.now() + LOCAL_ACTION_HOLD_MS;
  }

  /** The member tapped "Tap to watch together": play inside the gesture. */
  async tapToPlay(): Promise<'ok' | 'blocked'> {
    this.changes.record('play', 0, this.deps.now());
    const result = await this.adapter.play();
    if (result === 'ok') {
      this.blocked = false;
      this.alignOnNextCheck = true;
    }
    this.tick();
    return result;
  }

  /** The member tapped "Can't keep up, tap to resync": reset the failure counter and realign. */
  resync(): void {
    this.failedHardSeeks = 0;
    this.failedDrifts = [];
    this.correctionStopped = false;
    this.awaitingSeekResult = false;
    this.lastHardSeekAt = Number.NEGATIVE_INFINITY;
    this.lastDriftCheckAt = Number.NEGATIVE_INFINITY;
    this.tick();
  }

  onView(cb: Listener<EngineView>): () => void {
    this.viewListeners.add(cb);
    cb(this.view);
    return () => this.viewListeners.delete(cb);
  }

  /** Player changes the member made themselves; the engine's own changes are filtered out. */
  onUserAction(cb: Listener<UserAction>): () => void {
    this.actionListeners.add(cb);
    return () => this.actionListeners.delete(cb);
  }

  stop(): void {
    this.stopped = true;
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.viewListeners.clear();
    this.actionListeners.clear();
  }

  tick(): void {
    if (this.stopped) return;
    const state = this.state;
    if (!state) return;
    const now = this.deps.now();
    const serverNow = this.deps.serverNow();
    const expected = expectedPosition(state, serverNow);
    const local = this.adapter.getPosition();
    const paused = this.adapter.isPaused();
    const buffering = this.adapter.isBuffering();

    if (this.pendingLatencyAt !== null && !buffering && !paused) {
      this.recordLatency((now - this.pendingLatencyAt) / 1000);
      this.pendingLatencyAt = null;
    }

    if (now < this.holdUntil) {
      this.emit(this.view.mode, expected, local);
      return;
    }

    // Step 1: ended.
    if (state.status === 'ended') {
      if (!paused) this.pause(now);
      this.stopNudge(true);
      this.emit('ended', expected, local);
      return;
    }

    // Step 2: countdown to a start time in the future.
    const startAt = serverTsMs(state);
    if (state.status === 'playing' && serverNow < startAt) {
      if (!paused) this.pause(now);
      if (Math.abs(local - state.position_sec) > PAUSED_TOLERANCE) this.seekTo(state.position_sec, now);
      this.emit('countdown', expected, local, startAt - serverNow);
      return;
    }

    // Step 3: status.
    if (state.status === 'paused') {
      this.stopNudge(true);
      if (!paused) {
        this.pause(now);
      } else if (Math.abs(local - state.position_sec) > PAUSED_TOLERANCE) {
        this.seekTo(state.position_sec, now);
      }
      this.emit('paused', expected, local);
      return;
    }

    if (this.blocked) {
      this.emit('blocked', expected, local);
      return;
    }
    if (paused && !buffering) {
      this.startPlay(now);
      this.emit('playing', expected, local);
      return;
    }
    if (this.nudgeSign === 0 && this.appliedRate !== state.rate) {
      this.setRate(state.rate, now);
    }

    // Step 4: drift, only while playing and not buffering, once per second.
    if (this.correctionStopped) {
      this.emit('cant_keep_up', expected, local);
      return;
    }
    if (buffering || now - this.lastDriftCheckAt < DRIFT_CHECK_MS) {
      this.emit('playing', expected, local);
      return;
    }
    this.lastDriftCheckAt = now;
    const drift = local - expected;
    const abs = Math.abs(drift);

    if (this.alignOnNextCheck) {
      this.alignOnNextCheck = false;
      const threshold = this.adapter.capabilities.fineRate ? HARD_SEEK_DRIFT : COARSE_SEEK_DRIFT;
      if (abs > threshold && this.adapter.capabilities.seek) {
        // Following a new state is not a hard seek: no interval limit and no failure count.
        this.stopNudge(true);
        this.seekTo(expected + this.seekLatencySec, now);
        this.pendingLatencyAt = now;
        this.emit('playing', expected, local);
        return;
      }
    }

    if (this.awaitingSeekResult) {
      this.awaitingSeekResult = false;
      if (abs > HARD_SEEK_DRIFT) {
        this.failedHardSeeks += 1;
        this.failedDrifts.push(drift);
        if (this.failedHardSeeks >= MAX_FAILED_HARD_SEEKS) {
          this.correctionStopped = true;
          this.stopNudge(true);
          this.deps.log?.({ event: 'cant_keep_up', detail: { drifts: [...this.failedDrifts] } });
          this.emit('cant_keep_up', expected, local);
          return;
        }
      } else {
        this.failedHardSeeks = 0;
        this.failedDrifts = [];
      }
    }

    if (abs > HARD_SEEK_DRIFT) {
      this.hardSeek(expected, drift, now);
    } else if (this.adapter.capabilities.fineRate) {
      const sign = drift > 0 ? 1 : -1;
      if (this.nudgeSign === 0 && abs > NUDGE_START_DRIFT) {
        this.startNudge(sign, state.rate, now, drift);
      } else if (this.nudgeSign !== 0 && (abs <= NUDGE_STOP_DRIFT || sign !== this.nudgeSign)) {
        this.stopNudge(true);
      }
    } else if (abs > COARSE_SEEK_DRIFT) {
      this.hardSeek(expected, drift, now);
    }
    this.emit('playing', expected, local);
  }

  // Internals -----------------------------------------------------------------------------------

  private handleAdapterAction(action: UserAction): void {
    const now = this.deps.now();
    if (this.changes.match(action.kind, action.position, now)) return;
    for (const cb of this.actionListeners) cb(action);
  }

  private startPlay(now: number): void {
    if (this.playInFlight) return;
    this.playInFlight = true;
    this.changes.record('play', 0, now);
    void this.adapter.play().then(
      (result) => {
        this.playInFlight = false;
        if (result === 'blocked') {
          this.blocked = true;
          this.deps.log?.({ event: 'blocked', detail: {} });
          this.emit('blocked', this.view.expected, this.view.local);
        }
      },
      () => {
        this.playInFlight = false;
      },
    );
  }

  private pause(now: number): void {
    this.changes.record('pause', 0, now);
    void this.adapter.pause();
  }

  private seekTo(sec: number, now: number): void {
    if (!this.adapter.capabilities.seek) return;
    const target = Math.max(0, sec);
    if (this.changes.pending('seek', target, now)) return;
    this.changes.record('seek', target, now);
    void this.adapter.seek(target);
  }

  private hardSeek(expected: number, drift: number, now: number): void {
    if (!this.adapter.capabilities.seek) return;
    if (now - this.lastHardSeekAt < HARD_SEEK_INTERVAL_MS) return;
    this.stopNudge(true);
    this.lastHardSeekAt = now;
    this.awaitingSeekResult = true;
    this.pendingLatencyAt = now;
    this.deps.log?.({ event: 'hard_seek', detail: { drift } });
    this.seekTo(expected + this.seekLatencySec, now);
  }

  private setRate(rate: number, now: number): void {
    this.changes.record('rate', rate, now);
    this.adapter.setRate(rate);
    this.appliedRate = rate;
  }

  private startNudge(sign: 1 | -1, rate: number, now: number, drift: number): void {
    this.nudgeSign = sign;
    // Ahead: slow down. Behind: speed up.
    const nudged = rate * (sign > 0 ? 1 - NUDGE_FACTOR : 1 + NUDGE_FACTOR);
    this.setRate(nudged, now);
    this.deps.log?.({ event: 'nudge_start', detail: { drift, rate: nudged } });
  }

  private stopNudge(restore: boolean): void {
    if (this.nudgeSign === 0) return;
    this.nudgeSign = 0;
    if (restore && this.state) {
      this.setRate(this.state.rate, this.deps.now());
      this.deps.log?.({ event: 'nudge_stop', detail: {} });
    } else {
      this.appliedRate = null;
    }
  }

  private recordLatency(sec: number): void {
    if (sec <= 0 || sec > 10) return;
    this.latencies.push(sec);
    if (this.latencies.length > SEEK_LATENCY_SAMPLES) this.latencies.shift();
    this.seekLatencySec = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  private makeView(
    mode: EngineMode,
    expected: number | null,
    local: number | null,
    countdownMs: number | null = null,
  ): EngineView {
    return {
      mode,
      seq: this.lastSeq,
      expected,
      local,
      drift: expected === null || local === null ? null : local - expected,
      countdownMs,
      nudging: this.nudgeSign !== 0,
      buffering: this.adapter.isBuffering(),
      seekLatencySec: this.seekLatencySec,
      manualSeek: !this.adapter.capabilities.seek,
    };
  }

  private emit(
    mode: EngineMode,
    expected: number | null,
    local: number | null,
    countdownMs: number | null = null,
  ): void {
    this.view = this.makeView(mode, expected, local, countdownMs);
    for (const cb of this.viewListeners) cb(this.view);
  }
}
