// Remembers what the engine itself just asked the player to do, so the player's resulting events
// are not mistaken for a member's own play, pause or seek.

export type EngineChangeKind = 'play' | 'pause' | 'seek' | 'rate';

export interface EngineChange {
  kind: EngineChangeKind;
  target: number;
  at: number;
}

/** Records expire after 1.5 seconds, or 5 seconds for seeks, which covers a slow mobile seek. */
export const CHANGE_TTL_MS: Record<EngineChangeKind, number> = {
  play: 1500,
  pause: 1500,
  rate: 1500,
  seek: 5000,
};

/** A seek event matches an engine seek when it lands within 1 second of the target. */
export const SEEK_MATCH_SEC = 1;

export class EngineChangeTracker {
  private records: EngineChange[] = [];

  record(kind: EngineChangeKind, target: number, at: number): void {
    this.records.push({ kind, target, at });
  }

  /** Whether an unexpired record of this kind exists with the given target. */
  pending(kind: EngineChangeKind, target: number, at: number): boolean {
    this.purge(at);
    return this.records.some(
      (r) => r.kind === kind && (kind !== 'seek' || Math.abs(r.target - target) <= SEEK_MATCH_SEC),
    );
  }

  /** Returns true and drops the record when the player change was the engine's own. */
  match(kind: EngineChangeKind, value: number, at: number): boolean {
    this.purge(at);
    const index = this.records.findIndex((r) => {
      if (r.kind !== kind) return false;
      if (kind === 'seek') return Math.abs(value - r.target) <= SEEK_MATCH_SEC;
      if (kind === 'rate') return Math.abs(value - r.target) < 1e-6;
      return true;
    });
    if (index < 0) return false;
    this.records.splice(index, 1);
    return true;
  }

  size(): number {
    return this.records.length;
  }

  clear(): void {
    this.records = [];
  }

  private purge(at: number): void {
    this.records = this.records.filter((r) => at - r.at <= CHANGE_TTL_MS[r.kind]);
  }
}
