import { describe, expect, it } from 'vitest';
import { Ducker, DUCK_FADE_DOWN_MS, DUCK_FADE_UP_MS, DUCK_RELEASE_MS } from '../src/ducking';

function setup(level: number | null = 0.35, start = 0.8) {
  let now = 0;
  let volume = start;
  const ducker = new Ducker(
    { getVolume: () => volume, setVolume: (v) => (volume = v), now: () => now },
    level,
  );
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      ducker.tick();
    }
  };
  return {
    ducker,
    advance,
    volume: () => volume,
    setVolume: (v: number) => (volume = v),
  };
}

describe('ducking', () => {
  it('fades to the duck level over 200 ms while another member speaks', () => {
    const d = setup();
    d.ducker.setSpeaking('b', true, false);
    expect(d.ducker.isDucked).toBe(true);
    d.advance(DUCK_FADE_DOWN_MS / 2);
    expect(d.volume()).toBeLessThan(0.8);
    expect(d.volume()).toBeGreaterThan(0.28);
    d.advance(DUCK_FADE_DOWN_MS);
    expect(d.volume()).toBeCloseTo(0.28);
  });

  it("never ducks for the member's own voice", () => {
    const d = setup();
    d.ducker.setSpeaking('me', true, true);
    d.advance(500);
    expect(d.volume()).toBe(0.8);
  });

  it('restores over 400 ms once nobody has spoken for 600 ms', () => {
    const d = setup();
    d.ducker.setSpeaking('b', true, false);
    d.advance(300);
    d.ducker.setSpeaking('b', false, false);
    d.advance(DUCK_RELEASE_MS - 100);
    expect(d.volume()).toBeCloseTo(0.28);
    d.advance(100);
    d.advance(DUCK_FADE_UP_MS);
    expect(d.volume()).toBeCloseTo(0.8);
    expect(d.ducker.isDucked).toBe(false);
  });

  it('stays ducked across a short pause between words', () => {
    const d = setup();
    d.ducker.setSpeaking('b', true, false);
    d.advance(300);
    d.ducker.setSpeaking('b', false, false);
    d.advance(300);
    d.ducker.setSpeaking('b', true, false);
    d.advance(1000);
    expect(d.volume()).toBeCloseTo(0.28);
  });

  it('stays ducked while any other member speaks', () => {
    const d = setup();
    d.ducker.setSpeaking('b', true, false);
    d.ducker.setSpeaking('c', true, false);
    d.advance(300);
    d.ducker.setSpeaking('b', false, false);
    d.advance(1000);
    expect(d.ducker.isDucked).toBe(true);
  });

  it('makes a manual change while ducked the restore level', () => {
    const d = setup();
    d.ducker.setSpeaking('b', true, false);
    d.advance(300);
    d.setVolume(0.5);
    d.advance(100);
    expect(d.volume()).toBe(0.5);
    d.ducker.setSpeaking('b', false, false);
    d.advance(DUCK_RELEASE_MS + DUCK_FADE_UP_MS + 100);
    expect(d.volume()).toBeCloseTo(0.5);
  });

  it('does nothing when the duck level is off', () => {
    const d = setup(null);
    d.ducker.setSpeaking('b', true, false);
    d.advance(500);
    expect(d.volume()).toBe(0.8);
    expect(d.ducker.level).toBeNull();
  });

  it('restores when ducking is turned off while ducked, and clamps levels', () => {
    const d = setup();
    d.ducker.setSpeaking('b', true, false);
    d.advance(300);
    d.ducker.setDuckLevel(null);
    d.advance(DUCK_FADE_UP_MS + 50);
    expect(d.volume()).toBeCloseTo(0.8);
    d.ducker.setDuckLevel(4);
    expect(d.ducker.level).toBe(1);
    d.ducker.setDuckLevel(-1);
    expect(d.ducker.level).toBe(0);
  });
});
