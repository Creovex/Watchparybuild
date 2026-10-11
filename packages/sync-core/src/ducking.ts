// Ducking: lowering movie volume while another member is speaking.
//
// Fade down over 200 ms, fast enough not to mask the first word. Fade back over 400 ms once nobody
// else has spoken for 600 ms, the length of a normal pause between sentences. Together these stop
// the volume pumping between words.

export const DUCK_FADE_DOWN_MS = 200;
export const DUCK_FADE_UP_MS = 400;
export const DUCK_RELEASE_MS = 600;
export const DEFAULT_DUCK_LEVEL = 0.35;
const EPSILON = 0.01;

export interface DuckerDeps {
  getVolume: () => number;
  setVolume: (level: number) => void;
  now: () => number;
}

interface Fade {
  from: number;
  to: number;
  start: number;
  duration: number;
}

export class Ducker {
  private duckLevel: number | null;
  private readonly speaking = new Set<string>();
  private lastSpeechEndedAt = Number.NEGATIVE_INFINITY;
  private restoreLevel: number;
  private ducked = false;
  private fade: Fade | null = null;
  private lastSet: number | null = null;

  constructor(
    private readonly deps: DuckerDeps,
    /** Fraction of the member's movie volume while ducked; null turns ducking off. */
    duckLevel: number | null = DEFAULT_DUCK_LEVEL,
  ) {
    this.duckLevel = duckLevel;
    this.restoreLevel = deps.getVolume();
  }

  get isDucked(): boolean {
    return this.ducked;
  }

  get level(): number | null {
    return this.duckLevel;
  }

  setDuckLevel(level: number | null): void {
    this.duckLevel = level === null ? null : Math.min(1, Math.max(0, level));
    if (this.duckLevel === null && this.ducked) this.release(this.deps.now());
  }

  /** Report speaking for any member. The member's own voice never ducks their movie. */
  setSpeaking(userId: string, speaking: boolean, isSelf: boolean): void {
    if (isSelf) return;
    const now = this.deps.now();
    if (speaking) {
      this.speaking.add(userId);
    } else if (this.speaking.delete(userId) && this.speaking.size === 0) {
      this.lastSpeechEndedAt = now;
    }
    this.tick();
  }

  /** Call every 50 ms or so while voice is active. */
  tick(): void {
    const now = this.deps.now();
    this.detectManualChange();
    const othersSpeaking = this.speaking.size > 0;
    if (this.duckLevel !== null && othersSpeaking && !this.ducked) {
      this.ducked = true;
      const current = this.deps.getVolume();
      this.restoreLevel = current;
      this.fade = { from: current, to: current * this.duckLevel, start: now, duration: DUCK_FADE_DOWN_MS };
    } else if (this.ducked && !othersSpeaking && now - this.lastSpeechEndedAt >= DUCK_RELEASE_MS) {
      this.release(now);
    }
    this.stepFade(now);
  }

  private release(now: number): void {
    this.ducked = false;
    this.fade = { from: this.deps.getVolume(), to: this.restoreLevel, start: now, duration: DUCK_FADE_UP_MS };
  }

  // A manual volume change while ducked becomes the restore level.
  private detectManualChange(): void {
    if (this.lastSet === null) return;
    const current = this.deps.getVolume();
    if (Math.abs(current - this.lastSet) <= EPSILON) return;
    this.lastSet = null;
    this.fade = null;
    this.restoreLevel = current;
  }

  private stepFade(now: number): void {
    if (!this.fade) return;
    const { from, to, start, duration } = this.fade;
    const t = Math.min(1, (now - start) / duration);
    const level = from + (to - from) * t;
    this.deps.setVolume(level);
    this.lastSet = level;
    if (t >= 1) this.fade = null;
  }
}
