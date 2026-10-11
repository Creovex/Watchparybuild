import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEAKING_THRESHOLD_DBFS,
  LEVEL_SAMPLE_MS,
  SPEAKING_HOLD_MS,
  SPEAKING_RELEASE_MS,
  SpeakingDetector,
  SpeakingMonitor,
  levelDbfs,
  rms,
  toDbfs,
} from '../src/speaking';
import { FakeAudioContext, FakeClock, FakeTrack, fakeMeters } from './fakes';

const LOUD = -30;
const QUIET = -70;

/** Feeds `level` every 50 ms from `from` to `to` inclusive; returns the times speaking changed. */
function feed(d: SpeakingDetector, level: number, from: number, to: number): number[] {
  const changes: number[] = [];
  for (let t = from; t <= to; t += LEVEL_SAMPLE_MS) if (d.update(level, t)) changes.push(t);
  return changes;
}

describe('level math', () => {
  it('computes root mean square', () => {
    expect(rms([])).toBe(0);
    expect(rms([1, -1, 1, -1])).toBe(1);
    expect(rms([0.5, -0.5])).toBeCloseTo(0.5);
  });

  it('converts amplitude to dBFS', () => {
    expect(toDbfs(1)).toBe(0);
    expect(toDbfs(0.1)).toBeCloseTo(-20);
    expect(toDbfs(0.01)).toBeCloseTo(-40);
    expect(toDbfs(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('a full scale square wave is 0 dBFS and silence is minus infinity', () => {
    expect(levelDbfs([1, -1, 1, -1])).toBe(0);
    expect(levelDbfs(new Float32Array(128))).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('speaking detector', () => {
  it('uses minus 50 dBFS and a 150 ms hold by default', () => {
    expect(DEFAULT_SPEAKING_THRESHOLD_DBFS).toBe(-50);
    expect(SPEAKING_HOLD_MS).toBe(150);
  });

  it('starts speaking once the level stays above the threshold for 150 ms', () => {
    const d = new SpeakingDetector();
    expect(feed(d, LOUD, 0, 100)).toEqual([]);
    expect(d.speaking).toBe(false);
    expect(feed(d, LOUD, 150, 150)).toEqual([150]);
    expect(d.speaking).toBe(true);
  });

  it('ignores a burst shorter than 150 ms, such as a breath or a click', () => {
    const d = new SpeakingDetector();
    feed(d, LOUD, 0, 100);
    feed(d, QUIET, 150, 150);
    expect(feed(d, LOUD, 200, 300)).toEqual([]);
    expect(d.speaking).toBe(false);
  });

  it('a level exactly at the threshold is not above it', () => {
    const d = new SpeakingDetector();
    expect(feed(d, DEFAULT_SPEAKING_THRESHOLD_DBFS, 0, 1000)).toEqual([]);
    expect(feed(d, DEFAULT_SPEAKING_THRESHOLD_DBFS + 0.1, 1050, 1200)).toEqual([1200]);
  });

  it('releases once the level stays at or below the threshold for the release time', () => {
    const d = new SpeakingDetector();
    feed(d, LOUD, 0, 150);
    expect(d.speaking).toBe(true);
    expect(feed(d, QUIET, 200, 300)).toEqual([]);
    expect(feed(d, QUIET, 350, 350)).toEqual([200 + SPEAKING_RELEASE_MS]);
    expect(d.speaking).toBe(false);
  });

  it('a short pause between words does not release', () => {
    const d = new SpeakingDetector();
    feed(d, LOUD, 0, 150);
    feed(d, QUIET, 200, 300);
    feed(d, LOUD, 350, 350);
    expect(feed(d, QUIET, 400, 500)).toEqual([]);
    expect(d.speaking).toBe(true);
  });

  it('honours custom options', () => {
    const d = new SpeakingDetector({ thresholdDbfs: -20, holdMs: 100, releaseMs: 0 });
    expect(feed(d, -30, 0, 500)).toEqual([]);
    expect(feed(d, -10, 550, 650)).toEqual([650]);
    expect(feed(d, -30, 700, 700)).toEqual([700]);
  });

  it('reset clears the state', () => {
    const d = new SpeakingDetector();
    feed(d, LOUD, 0, 150);
    d.reset();
    expect(d.speaking).toBe(false);
  });
});

describe('speaking monitor', () => {
  function setup() {
    const clock = new FakeClock();
    const meters = fakeMeters();
    const context = new FakeAudioContext() as unknown as AudioContext;
    const monitor = new SpeakingMonitor({ clock, getContext: () => context, createMeter: meters.factory });
    const events: Array<[string, boolean]> = [];
    monitor.onChange((id, speaking) => events.push([id, speaking]));
    return { clock, meters, monitor, events };
  }

  it('samples every 50 ms and reports start and stop with the hold and release times', () => {
    const { clock, meters, monitor, events } = setup();
    const track = new FakeTrack('audio');
    monitor.watch('u1', track as unknown as MediaStreamTrack);
    meters.levels.set(track.id, LOUD);
    clock.advance(150);
    expect(events).toEqual([]);
    clock.advance(50);
    expect(events).toEqual([['u1', true]]);
    meters.levels.set(track.id, QUIET);
    clock.advance(200);
    expect(events).toEqual([
      ['u1', true],
      ['u1', false],
    ]);
  });

  it('unwatching a speaking member reports them silent and stops the timer when nobody is left', () => {
    const { clock, meters, monitor, events } = setup();
    const track = new FakeTrack('audio');
    monitor.watch('u1', track as unknown as MediaStreamTrack);
    meters.levels.set(track.id, LOUD);
    clock.advance(250);
    monitor.unwatch('u1');
    expect(events.at(-1)).toEqual(['u1', false]);
    expect(clock.pending).toBe(0);
  });

  it('does nothing without an audio context', () => {
    const clock = new FakeClock();
    const monitor = new SpeakingMonitor({ clock, getContext: () => null });
    monitor.watch('u1', new FakeTrack('audio') as unknown as MediaStreamTrack);
    expect(clock.pending).toBe(0);
  });
});
