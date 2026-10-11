import { describe, expect, it } from 'vitest';
import { expectedPosition, isCountdown, serverTsMs } from '../src/position';

const base = { position_sec: 100, rate: 1, server_ts: 50_000 };

describe('expected position', () => {
  it('advances while playing', () => {
    expect(expectedPosition({ ...base, status: 'playing' }, 53_000)).toBe(103);
  });

  it('holds while paused', () => {
    expect(expectedPosition({ ...base, status: 'paused' }, 90_000)).toBe(100);
  });

  it('holds when ended', () => {
    expect(expectedPosition({ ...base, status: 'ended' }, 90_000)).toBe(100);
  });

  it('scales with a rate other than 1', () => {
    expect(expectedPosition({ ...base, status: 'playing', rate: 1.5 }, 54_000)).toBe(106);
    expect(expectedPosition({ ...base, status: 'playing', rate: 0.5 }, 54_000)).toBe(102);
  });

  it('holds at the position during a countdown to a future start', () => {
    const state = { ...base, status: 'playing' as const, server_ts: 60_000 };
    expect(isCountdown(state, 57_000)).toBe(true);
    expect(expectedPosition(state, 57_000)).toBe(100);
    expect(isCountdown(state, 60_000)).toBe(false);
    expect(expectedPosition(state, 61_000)).toBe(101);
  });

  it('is never a countdown while paused', () => {
    expect(isCountdown({ ...base, status: 'paused', server_ts: 60_000 }, 57_000)).toBe(false);
  });

  it('reads Postgres timestamps with microseconds and an offset', () => {
    const iso = '2026-10-11T01:33:44.523723+00:00';
    expect(serverTsMs({ server_ts: iso })).toBe(Date.UTC(2026, 9, 11, 1, 33, 44, 523));
    expect(expectedPosition({ ...base, status: 'playing', server_ts: iso }, Date.parse(iso) + 2000)).toBe(102);
  });
});
