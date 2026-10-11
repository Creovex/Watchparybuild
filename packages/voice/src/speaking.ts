import { Listeners } from './runtime';
import type { Clock, Logger } from './types';

/**
 * Speaking detection for mesh voice: a Web Audio analyser on each remote track and on the local
 * microphone. A member is speaking once the level stays above the threshold for 150 ms; shorter
 * bursts are breaths and clicks.
 */

/** DEFAULT: minus 50 dBFS (decibels relative to full scale). Spike S3 has not run to measure one. */
export const DEFAULT_SPEAKING_THRESHOLD_DBFS = -50;
/** The level must stay above the threshold this long before speaking starts. */
export const SPEAKING_HOLD_MS = 150;
/** DEFAULT (gap G31): the level must stay at or below the threshold this long before speaking stops. */
export const SPEAKING_RELEASE_MS = 150;
/** How often levels are sampled. A third of the hold time, so the hold is measured to within 50 ms. */
export const LEVEL_SAMPLE_MS = 50;

/** Root mean square of time domain samples in the range minus 1 to 1. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/** Converts an amplitude (1 is full scale) to dBFS. Silence is minus infinity. */
export function toDbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;
}

export function levelDbfs(samples: ArrayLike<number>): number {
  return toDbfs(rms(samples));
}

export interface SpeakingOptions {
  thresholdDbfs: number;
  holdMs: number;
  releaseMs: number;
}

export const DEFAULT_SPEAKING_OPTIONS: SpeakingOptions = {
  thresholdDbfs: DEFAULT_SPEAKING_THRESHOLD_DBFS,
  holdMs: SPEAKING_HOLD_MS,
  releaseMs: SPEAKING_RELEASE_MS,
};

/** Hold and release logic for one member. Pure: the caller supplies levels and times. */
export class SpeakingDetector {
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private current = false;

  constructor(private readonly options: SpeakingOptions = DEFAULT_SPEAKING_OPTIONS) {}

  get speaking(): boolean {
    return this.current;
  }

  /** Feeds one level sample; returns true when the speaking state changed. */
  update(level: number, now: number): boolean {
    if (level > this.options.thresholdDbfs) {
      this.belowSince = null;
      this.aboveSince ??= now;
      if (!this.current && now - this.aboveSince >= this.options.holdMs) {
        this.current = true;
        return true;
      }
      return false;
    }
    this.aboveSince = null;
    if (!this.current) return false;
    this.belowSince ??= now;
    if (now - this.belowSince >= this.options.releaseMs) {
      this.current = false;
      this.belowSince = null;
      return true;
    }
    return false;
  }

  reset(): void {
    this.aboveSince = null;
    this.belowSince = null;
    this.current = false;
  }
}

/** Reads the current level of one track. */
export interface LevelMeter {
  level(): number;
  dispose(): void;
}

export type LevelMeterFactory = (context: AudioContext, track: MediaStreamTrack) => LevelMeter;

/**
 * The browser meter: track, then analyser. Chrome only feeds a remote WebRTC track into Web Audio
 * while the track also plays in a media element, which the room does through `attachMedia`.
 */
export const analyserMeter: LevelMeterFactory = (context, track) => {
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(buffer);
      return levelDbfs(buffer);
    },
    dispose() {
      source.disconnect();
      analyser.disconnect();
    },
  };
};

interface Watched {
  track: MediaStreamTrack;
  meter: LevelMeter;
  detector: SpeakingDetector;
}

export interface SpeakingMonitorDeps {
  clock: Clock;
  getContext(): AudioContext | null;
  createMeter?: LevelMeterFactory;
  options?: SpeakingOptions;
  log?: Logger;
}

/** Samples every watched track every 50 ms and reports speaking changes. */
export class SpeakingMonitor {
  private readonly watched = new Map<string, Watched>();
  private readonly changes: Listeners<[string, boolean]>;
  private timer: unknown = null;

  constructor(private readonly deps: SpeakingMonitorDeps) {
    this.changes = new Listeners(deps.log);
  }

  onChange(cb: (userId: string, speaking: boolean) => void): () => void {
    return this.changes.add(cb);
  }

  isSpeaking(userId: string): boolean {
    return this.watched.get(userId)?.detector.speaking ?? false;
  }

  /** Starts watching a member's track, replacing any track watched for them before. */
  watch(userId: string, track: MediaStreamTrack): void {
    const existing = this.watched.get(userId);
    if (existing?.track === track) return;
    const context = this.deps.getContext();
    if (!context) return;
    this.unwatch(userId);
    let meter: LevelMeter;
    try {
      meter = (this.deps.createMeter ?? analyserMeter)(context, track);
    } catch (err) {
      this.deps.log?.('could not measure audio level', err);
      return;
    }
    this.watched.set(userId, {
      track,
      meter,
      detector: new SpeakingDetector(this.deps.options ?? DEFAULT_SPEAKING_OPTIONS),
    });
    this.timer ??= this.deps.clock.setInterval(() => this.sample(), LEVEL_SAMPLE_MS);
  }

  /** Stops watching a member; reports them as not speaking if they were. */
  unwatch(userId: string): void {
    const w = this.watched.get(userId);
    if (!w) return;
    this.watched.delete(userId);
    w.meter.dispose();
    if (w.detector.speaking) this.changes.emit(userId, false);
    if (this.watched.size === 0) this.stopTimer();
  }

  stop(): void {
    for (const userId of [...this.watched.keys()]) this.unwatch(userId);
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer !== null) this.deps.clock.clearInterval(this.timer);
    this.timer = null;
  }

  /** Public for tests; called by the timer. */
  sample(): void {
    const now = this.deps.clock.now();
    for (const [userId, w] of this.watched) {
      let level: number;
      try {
        level = w.meter.level();
      } catch {
        level = Number.NEGATIVE_INFINITY;
      }
      if (w.detector.update(level, now)) this.changes.emit(userId, w.detector.speaking);
    }
  }
}
