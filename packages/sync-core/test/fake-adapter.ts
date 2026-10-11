import type { AdapterCapabilities, PlayerAdapter, UserAction } from '../src/adapter';

/** A simulated player whose position advances with a fake clock. */
export class FakeAdapter implements PlayerAdapter {
  capabilities: AdapterCapabilities;
  position = 0;
  paused = true;
  buffering = false;
  ended = false;
  rate = 1;
  volume = 1;
  playResult: 'ok' | 'blocked' = 'ok';
  /** Extra seconds added to every seek, to simulate a player that lands late. */
  seekError = 0;
  /** When set, every seek buffers for this long before playback resumes. */
  bufferOnSeekMs = 0;
  private bufferLeftMs = 0;
  calls: Array<{ kind: string; value?: number }> = [];
  private actionCbs = new Set<(a: UserAction) => void>();
  private bufferingCbs = new Set<(b: boolean) => void>();
  private endedCbs = new Set<() => void>();

  constructor(caps: Partial<AdapterCapabilities> = {}) {
    this.capabilities = { fineRate: true, volume: true, seek: true, seekLatencySec: 0.3, ...caps };
  }

  /** Advance the simulated player by `ms` of wall time. */
  advance(ms: number): void {
    if (this.bufferLeftMs > 0) {
      this.bufferLeftMs -= ms;
      if (this.bufferLeftMs <= 0) this.buffering = false;
      return;
    }
    if (!this.paused && !this.buffering) this.position += (ms / 1000) * this.rate;
  }

  async load(): Promise<void> {}

  async play(): Promise<'ok' | 'blocked'> {
    this.calls.push({ kind: 'play' });
    if (this.playResult === 'blocked') return 'blocked';
    this.paused = false;
    return 'ok';
  }

  async pause(): Promise<void> {
    this.calls.push({ kind: 'pause' });
    this.paused = true;
  }

  async seek(sec: number): Promise<void> {
    this.calls.push({ kind: 'seek', value: sec });
    this.position = sec + this.seekError;
    if (this.bufferOnSeekMs > 0) {
      this.buffering = true;
      this.bufferLeftMs = this.bufferOnSeekMs;
    }
  }

  setRate(rate: number): void {
    this.calls.push({ kind: 'rate', value: rate });
    this.rate = rate;
  }

  setVolume(level: number): void {
    this.volume = level;
  }

  getVolume(): number {
    return this.volume;
  }

  getPosition(): number {
    return this.position;
  }

  getDuration(): number | null {
    return 600;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isBuffering(): boolean {
    return this.buffering;
  }

  isEnded(): boolean {
    return this.ended;
  }

  onUserAction(cb: (a: UserAction) => void): () => void {
    this.actionCbs.add(cb);
    return () => this.actionCbs.delete(cb);
  }

  onBuffering(cb: (b: boolean) => void): () => void {
    this.bufferingCbs.add(cb);
    return () => this.bufferingCbs.delete(cb);
  }

  onEnded(cb: () => void): () => void {
    this.endedCbs.add(cb);
    return () => this.endedCbs.delete(cb);
  }

  /** Simulates the player reporting a change (made by the engine or by the member). */
  emitAction(action: UserAction): void {
    for (const cb of this.actionCbs) cb(action);
  }

  destroy(): void {}

  count(kind: string): number {
    return this.calls.filter((c) => c.kind === kind).length;
  }

  last(kind: string): { kind: string; value?: number } | undefined {
    return [...this.calls].reverse().find((c) => c.kind === kind);
  }
}

/** A fake clock shared by the engine, the server clock and the simulated player. */
export class FakeTime {
  local = 1_000_000;
  offset = 50_000;

  now = (): number => this.local;
  serverNow = (): number => this.local + this.offset;
}
