import { describe, expect, it } from 'vitest';
import { EngineChangeTracker } from '../src/engine-changes';

describe('engine change tracker', () => {
  it('matches play and pause records once, within 1.5 seconds', () => {
    const t = new EngineChangeTracker();
    t.record('play', 0, 1000);
    expect(t.match('pause', 0, 1100)).toBe(false);
    expect(t.match('play', 0, 2400)).toBe(true);
    expect(t.match('play', 0, 2400)).toBe(false);
  });

  it('discards play, pause and rate records after 1.5 seconds', () => {
    const t = new EngineChangeTracker();
    t.record('pause', 0, 1000);
    t.record('rate', 1.05, 1000);
    expect(t.match('pause', 0, 2501)).toBe(false);
    expect(t.match('rate', 1.05, 2501)).toBe(false);
    expect(t.size()).toBe(0);
  });

  it('matches a seek within 1 second of the target, for up to 5 seconds', () => {
    const t = new EngineChangeTracker();
    t.record('seek', 120, 0);
    expect(t.match('seek', 121.5, 100)).toBe(false);
    expect(t.match('seek', 120.9, 4900)).toBe(true);
    t.record('seek', 30, 0);
    expect(t.match('seek', 30, 5001)).toBe(false);
  });

  it('matches rate records by value', () => {
    const t = new EngineChangeTracker();
    t.record('rate', 0.95, 0);
    expect(t.match('rate', 1.05, 10)).toBe(false);
    expect(t.match('rate', 0.95, 10)).toBe(true);
  });

  it('reports pending records and clears', () => {
    const t = new EngineChangeTracker();
    t.record('seek', 50, 0);
    expect(t.pending('seek', 50.5, 100)).toBe(true);
    expect(t.pending('seek', 60, 100)).toBe(false);
    t.record('play', 0, 0);
    expect(t.pending('play', 0, 100)).toBe(true);
    t.clear();
    expect(t.size()).toBe(0);
  });
});
