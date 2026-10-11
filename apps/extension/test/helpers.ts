import type { AdapterCapabilities, PlaybackStateRow, PlayerAdapter, UserAction } from '@watchparty/sync-core';

export const ROOM_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ROOM_ID = '22222222-2222-4222-8222-222222222222';
export const ENGINE_SESSION = '33333333-3333-4333-8333-333333333333';
export const USER_ID = '44444444-4444-4444-8444-444444444444';

export function stateRow(partial: Partial<PlaybackStateRow> = {}): PlaybackStateRow {
  return {
    room_id: ROOM_ID,
    seq: 1,
    status: 'paused',
    position_sec: 0,
    rate: 1,
    server_ts: new Date(0).toISOString(),
    paused_reason: 'user',
    updated_by: null,
    ...partial,
  };
}

/** A recording port for the pairing and worker tests. */
export class FakePort {
  sent: unknown[] = [];
  disconnected = false;
  throwOnPost = false;
  postMessage(message: unknown): void {
    if (this.throwOnPost) throw new Error('disconnected');
    this.sent.push(message);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  last(): unknown {
    return this.sent[this.sent.length - 1];
  }
}

/** A minimal player whose state the test sets directly. */
export class StubAdapter implements PlayerAdapter {
  capabilities: AdapterCapabilities;
  position = 0;
  paused = true;
  buffering = false;
  volume = 1;
  rate = 1;
  playResult: 'ok' | 'blocked' = 'ok';
  calls: string[] = [];
  private actions = new Set<(a: UserAction) => void>();
  private bufferingCbs = new Set<(b: boolean) => void>();
  private endedCbs = new Set<() => void>();

  constructor(caps: Partial<AdapterCapabilities> = {}) {
    this.capabilities = { seek: false, fineRate: false, volume: true, seekLatencySec: 0.5, ...caps };
  }
  async load(): Promise<void> {}
  async play(): Promise<'ok' | 'blocked'> {
    this.calls.push('play');
    if (this.playResult === 'ok') this.paused = false;
    return this.playResult;
  }
  async pause(): Promise<void> {
    this.calls.push('pause');
    this.paused = true;
  }
  async seek(sec: number): Promise<void> {
    this.calls.push(`seek:${sec}`);
    this.position = sec;
  }
  setRate(rate: number): void {
    this.rate = rate;
  }
  setVolume(level: number): void {
    this.calls.push(`volume:${level}`);
    this.volume = level;
  }
  getVolume(): number {
    return this.volume;
  }
  getPosition(): number {
    return this.position;
  }
  getDuration(): number | null {
    return 1200;
  }
  getRate(): number {
    return this.rate;
  }
  isPaused(): boolean {
    return this.paused;
  }
  isBuffering(): boolean {
    return this.buffering;
  }
  isEnded(): boolean {
    return false;
  }
  onUserAction(cb: (a: UserAction) => void): () => void {
    this.actions.add(cb);
    return () => this.actions.delete(cb);
  }
  onBuffering(cb: (b: boolean) => void): () => void {
    this.bufferingCbs.add(cb);
    return () => this.bufferingCbs.delete(cb);
  }
  onEnded(cb: () => void): () => void {
    this.endedCbs.add(cb);
    return () => this.endedCbs.delete(cb);
  }
  emitAction(a: UserAction): void {
    for (const cb of this.actions) cb(a);
  }
  emitBuffering(b: boolean): void {
    this.buffering = b;
    for (const cb of this.bufferingCbs) cb(b);
  }
  emitEnded(): void {
    for (const cb of this.endedCbs) cb();
  }
  destroy(): void {}
}

export const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
