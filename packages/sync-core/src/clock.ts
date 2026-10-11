// Clock offset between this device and the database server.
//
// Five calls in a row, keeping the one with the shortest round trip: one sample on mobile data can
// be off by hundreds of milliseconds, and the shortest round trip has the least room for error.

export interface ClockSample {
  /** Local time just before the call, in milliseconds. */
  t0: number;
  /** Local time just after the call, in milliseconds. */
  t1: number;
  /** Server epoch milliseconds returned by `server_time()`. */
  s: number;
}

export interface OffsetEstimate {
  offset: number;
  rtt: number;
}

export function offsetFromSamples(samples: readonly ClockSample[]): OffsetEstimate {
  if (samples.length === 0) throw new Error('no clock samples');
  let best = samples[0]!;
  for (const sample of samples) {
    if (sample.t1 - sample.t0 < best.t1 - best.t0) best = sample;
  }
  const rtt = best.t1 - best.t0;
  return { offset: best.s + rtt / 2 - best.t1, rtt };
}

export async function measureOffset(
  fetchServerMs: () => Promise<number>,
  now: () => number = Date.now,
  count = 5,
): Promise<OffsetEstimate> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < count; i++) {
    const t0 = now();
    const s = await fetchServerMs();
    const t1 = now();
    samples.push({ t0, t1, s });
  }
  return offsetFromSamples(samples);
}

/** Server time as seen from this device. Re-measured every 60 seconds and on reconnection. */
export class ServerClock {
  offset = 0;
  rtt = Number.POSITIVE_INFINITY;
  synced = false;

  constructor(
    private readonly fetchServerMs: () => Promise<number>,
    private readonly localNow: () => number = Date.now,
  ) {}

  now(): number {
    return this.localNow() + this.offset;
  }

  async sync(): Promise<OffsetEstimate> {
    const estimate = await measureOffset(this.fetchServerMs, this.localNow);
    this.offset = estimate.offset;
    this.rtt = estimate.rtt;
    this.synced = true;
    return estimate;
  }
}
