import { describe, expect, it } from 'vitest';
import { measureOffset, offsetFromSamples, ServerClock } from '../src/clock';

describe('clock offset', () => {
  it('keeps the sample with the smallest round trip', () => {
    const estimate = offsetFromSamples([
      { t0: 0, t1: 400, s: 10_300 },
      { t0: 1000, t1: 1040, s: 11_020 },
      { t0: 2000, t1: 2200, s: 12_000 },
    ]);
    expect(estimate.rtt).toBe(40);
    // s + rtt / 2 - t1 = 11020 + 20 - 1040
    expect(estimate.offset).toBe(10_000);
  });

  it('refuses an empty sample list', () => {
    expect(() => offsetFromSamples([])).toThrow();
  });

  it('measures five samples in a row', async () => {
    let local = 0;
    const now = () => local;
    let calls = 0;
    const rtts = [300, 80, 20, 150, 60];
    const fetchServer = async () => {
      const rtt = rtts[calls++]!;
      local += rtt / 2;
      const server = local + 5000;
      local += rtt / 2;
      return server;
    };
    const estimate = await measureOffset(fetchServer, now);
    expect(calls).toBe(5);
    expect(estimate.rtt).toBe(20);
    expect(estimate.offset).toBe(5000);
  });

  it('reports server now as local now plus the offset', async () => {
    let local = 1000;
    const clock = new ServerClock(async () => local + 250, () => local);
    expect(clock.synced).toBe(false);
    expect(clock.now()).toBe(1000);
    await clock.sync();
    expect(clock.synced).toBe(true);
    expect(clock.offset).toBe(250);
    local = 2000;
    expect(clock.now()).toBe(2250);
  });
});
