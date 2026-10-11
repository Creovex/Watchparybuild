import type { AdapterCapabilities, PlayerAdapter, UserAction } from '@watchparty/sync-core';

// Drives the `video` element inside a Netflix, Prime Video or Disney+ tab. The services replace
// their video element (episode changes, adverts), so the adapter watches the page and follows the
// active one. Capabilities come from spike S1 per service (src/shared/services.ts).
//
// Player events the member did not cause (the service's own autoplay on load, its resume seek, its
// buffering adjustments) must not become room actions. A play, pause or seek counts as the member's
// only when it follows their own input on the page (a click, tap or key press) within
// INPUT_WINDOW_MS. The engine's own changes are filtered later by SyncEngine. This rule is a DEFAULT
// until spike S1 shows how each service behaves.

export const INPUT_WINDOW_MS = 1500;
/** A seek shorter than this from where playback was is the service adjusting, not the member. */
export const SEEK_MIN_JUMP_SEC = 1;
/** play() that has not settled after this long is treated as started; only a refusal means blocked. */
export const PLAY_SETTLE_MS = 4000;
const RECHECK_MS = 2000;
const HAVE_FUTURE_DATA = 3;

export interface VideoAdapterOptions {
  doc: Document;
  capabilities: AdapterCapabilities;
  /** Visible area of a video in square pixels; tests replace it. */
  measure?: (video: HTMLVideoElement) => number;
  now?: () => number;
  /** Report play, pause and seek only after the member's own input. Default true. */
  requireInput?: boolean;
  /** Whether an input event came from the member; tests replace it, since they cannot make trusted events. */
  isMemberInput?: (event: Event) => boolean;
}

type Listener<T> = (value: T) => void;

function defaultMeasure(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const style = video.ownerDocument.defaultView?.getComputedStyle(video);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return 0;
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

/**
 * The video to drive: visible ones first, then the largest, then one that is playing, then the
 * longest. Returns null when the page has no video.
 */
export function pickActiveVideo(
  videos: readonly HTMLVideoElement[],
  measure: (video: HTMLVideoElement) => number = defaultMeasure,
): HTMLVideoElement | null {
  let best: { video: HTMLVideoElement; score: [number, number, number, number] } | null = null;
  for (const video of videos) {
    const area = measure(video);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const score: [number, number, number, number] = [area > 0 ? 1 : 0, Math.round(area), video.paused ? 0 : 1, duration];
    if (!best || compareScores(score, best.score) > 0) best = { video, score };
  }
  return best?.video ?? null;
}

function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class VideoElementAdapter implements PlayerAdapter {
  readonly capabilities: AdapterCapabilities;
  private readonly doc: Document;
  private readonly measure: (video: HTMLVideoElement) => number;
  private readonly now: () => number;
  private readonly requireInput: boolean;
  private video: HTMLVideoElement | null = null;
  private detachVideo: (() => void) | null = null;
  private readonly observer: MutationObserver;
  private readonly recheck: ReturnType<typeof setInterval>;
  private readonly removeInputListeners: () => void;
  private buffering = false;
  private lastInputAt = Number.NEGATIVE_INFINITY;
  private lastPosition = 0;
  private seekFrom: number | null = null;
  private destroyed = false;
  private readonly actionListeners = new Set<Listener<UserAction>>();
  private readonly bufferingListeners = new Set<Listener<boolean>>();
  private readonly endedListeners = new Set<() => void>();
  private readonly videoListeners = new Set<Listener<HTMLVideoElement | null>>();

  constructor(opts: VideoAdapterOptions) {
    this.doc = opts.doc;
    this.capabilities = { ...opts.capabilities };
    this.measure = opts.measure ?? defaultMeasure;
    this.now = opts.now ?? (() => performance.now());
    this.requireInput = opts.requireInput ?? true;

    const isMemberInput = opts.isMemberInput ?? ((event: Event) => event.isTrusted);
    const markInput = (event: Event) => {
      if (isMemberInput(event)) this.lastInputAt = this.now();
    };
    const inputEvents = ['pointerdown', 'pointerup', 'keydown', 'keyup', 'touchstart'] as const;
    for (const name of inputEvents) this.doc.addEventListener(name, markInput, { capture: true, passive: true });
    this.removeInputListeners = () => {
      for (const name of inputEvents) this.doc.removeEventListener(name, markInput, { capture: true });
    };

    this.observer = new MutationObserver(() => this.refresh());
    this.observer.observe(this.doc.documentElement, { childList: true, subtree: true });
    // Sizes change without DOM mutations (layout, full screen), so check now and then as well.
    this.recheck = setInterval(() => this.refresh(), RECHECK_MS);
    this.refresh();
  }

  /** The element currently driven, or null. */
  get element(): HTMLVideoElement | null {
    return this.video;
  }

  /** Re-picks the active video; called on DOM changes and every two seconds. */
  refresh(): void {
    if (this.destroyed) return;
    const next = pickActiveVideo(Array.from(this.doc.querySelectorAll('video')), this.measure);
    if (next === this.video) return;
    this.detachVideo?.();
    this.detachVideo = null;
    this.video = next;
    this.seekFrom = null;
    this.setBuffering(false);
    if (next) this.detachVideo = this.attach(next);
    for (const cb of this.videoListeners) cb(next);
  }

  private attach(video: HTMLVideoElement): () => void {
    this.lastPosition = video.currentTime;
    const handlers: Array<[string, () => void]> = [
      ['waiting', () => this.setBuffering(true)],
      ['stalled', () => {
        if (video.readyState < HAVE_FUTURE_DATA) this.setBuffering(true);
      }],
      ['playing', () => this.setBuffering(false)],
      ['canplay', () => this.setBuffering(false)],
      ['canplaythrough', () => this.setBuffering(false)],
      ['emptied', () => this.setBuffering(false)],
      ['play', () => this.report('play', video.currentTime)],
      ['pause', () => {
        this.setBuffering(false);
        // The element fires pause just before ended; finishing the film is not a member's pause.
        if (!video.ended) this.report('pause', video.currentTime);
      }],
      ['timeupdate', () => {
        if (!video.seeking) this.lastPosition = video.currentTime;
      }],
      ['seeking', () => {
        if (this.seekFrom === null) this.seekFrom = this.lastPosition;
      }],
      ['seeked', () => {
        const from = this.seekFrom ?? this.lastPosition;
        this.seekFrom = null;
        this.lastPosition = video.currentTime;
        if (Math.abs(video.currentTime - from) > SEEK_MIN_JUMP_SEC) this.report('seek', video.currentTime);
      }],
      ['ended', () => {
        for (const cb of this.endedListeners) cb();
      }],
    ];
    for (const [name, handler] of handlers) video.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of handlers) video.removeEventListener(name, handler);
    };
  }

  private report(kind: UserAction['kind'], position: number): void {
    if (this.requireInput && this.now() - this.lastInputAt > INPUT_WINDOW_MS) return;
    for (const cb of this.actionListeners) cb({ kind, position });
  }

  private setBuffering(buffering: boolean): void {
    if (this.buffering === buffering) return;
    this.buffering = buffering;
    for (const cb of this.bufferingListeners) cb(buffering);
  }

  // PlayerAdapter ---------------------------------------------------------------------------------

  async load(): Promise<void> {
    // The service loads titles itself; the room's title is opened in this tab by the worker.
  }

  async play(): Promise<'ok' | 'blocked'> {
    const video = this.video;
    if (!video) return 'ok';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const settle = new Promise<'ok'>((resolve) => {
        timer = setTimeout(() => resolve('ok'), PLAY_SETTLE_MS);
      });
      return await Promise.race([video.play().then(() => 'ok' as const), settle]);
    } catch (error) {
      // NotAllowedError is the browser's autoplay refusal; anything else (an interrupted play) is not.
      return (error as { name?: string } | null)?.name === 'NotAllowedError' ? 'blocked' : 'ok';
    } finally {
      clearTimeout(timer);
    }
  }

  async pause(): Promise<void> {
    this.video?.pause();
  }

  async seek(sec: number): Promise<void> {
    // Behind the S1 flag: with seek false the engine never calls this, and this refuses as well.
    if (!this.capabilities.seek || !this.video) return;
    this.video.currentTime = Math.max(0, sec);
  }

  setRate(rate: number): void {
    const video = this.video;
    if (!video || video.playbackRate === rate) return;
    // Without fine rates only the normal rate is ever set, so a service that dislikes other rates
    // is not disturbed.
    if (!this.capabilities.fineRate && rate !== 1) return;
    video.playbackRate = rate;
  }

  setVolume(level: number): void {
    if (!this.capabilities.volume || !this.video) return;
    this.video.volume = Math.min(1, Math.max(0, level));
  }

  getVolume(): number {
    return this.video?.volume ?? 1;
  }

  getPosition(): number {
    return this.video?.currentTime ?? 0;
  }

  getDuration(): number | null {
    const duration = this.video?.duration;
    return duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  getRate(): number {
    return this.video?.playbackRate || 1;
  }

  isPaused(): boolean {
    return this.video ? this.video.paused : true;
  }

  isBuffering(): boolean {
    return this.buffering;
  }

  isEnded(): boolean {
    return this.video?.ended ?? false;
  }

  onUserAction(cb: (a: UserAction) => void): () => void {
    this.actionListeners.add(cb);
    return () => this.actionListeners.delete(cb);
  }

  onBuffering(cb: (buffering: boolean) => void): () => void {
    this.bufferingListeners.add(cb);
    return () => this.bufferingListeners.delete(cb);
  }

  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  /** Called when the driven element changes, including to none. */
  onVideoChange(cb: (video: HTMLVideoElement | null) => void): () => void {
    this.videoListeners.add(cb);
    return () => this.videoListeners.delete(cb);
  }

  destroy(): void {
    this.destroyed = true;
    this.observer.disconnect();
    clearInterval(this.recheck);
    this.removeInputListeners();
    this.detachVideo?.();
    this.detachVideo = null;
    this.video = null;
    this.actionListeners.clear();
    this.bufferingListeners.clear();
    this.endedListeners.clear();
    this.videoListeners.clear();
  }
}
