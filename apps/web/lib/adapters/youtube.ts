'use client';

import type { AdapterCapabilities, PlayerAdapter, UserAction } from '@watchparty/sync-core';

// The YouTube adapter drives the YouTube IFrame Player API with YouTube's own controls visible.
// Nothing of ours ever covers the player rectangle, and playback never starts without a tap where
// the browser blocks it (YouTube developer policies).

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  cueVideoById(id: string): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      events: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
        onAutoplayBlocked?: () => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;
const POLL_MS = 250;
/** A jump larger than this from the predicted position, not made by the engine, is a member's seek. */
const SEEK_JUMP_SEC = 1;
/** Playback that has not started within this long after play() counts as blocked. */
const PLAY_START_TIMEOUT_MS = 1000;

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the IFrame Player API once per page. */
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('YouTube player API did not load'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export type YouTubeErrorKind = 'embed_blocked' | 'unavailable';

export class YouTubeAdapter implements PlayerAdapter {
  capabilities: AdapterCapabilities = { fineRate: false, volume: !isIOS(), seek: true, seekLatencySec: 0.3 };
  private player: YTPlayer | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;
  private isReady = false;
  private state: number = STATE.UNSTARTED;
  private logicalPlaying = false;
  private rate = 1;
  private lastPolled = 0;
  private lastPolledAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private playWaiter: ((result: 'ok' | 'blocked') => void) | null = null;
  private readonly actionCbs = new Set<(a: UserAction) => void>();
  private readonly bufferingCbs = new Set<(b: boolean) => void>();
  private readonly endedCbs = new Set<() => void>();
  private readonly errorCbs = new Set<(kind: YouTubeErrorKind) => void>();
  private readonly readyCbs = new Set<() => void>();

  constructor(private readonly container: HTMLElement) {}

  async load(videoId: string): Promise<void> {
    if (this.player && this.ready) {
      await this.ready;
      this.player.cueVideoById(videoId);
      this.resetTracking();
      return;
    }
    const YT = await loadApi();
    const iframe = document.createElement('iframe');
    const params = new URLSearchParams({
      enablejsapi: '1',
      playsinline: '1',
      rel: '0',
      controls: '1',
      origin: window.location.origin,
    });
    iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
    iframe.title = 'YouTube video player';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    // The app sends no referrer anywhere, but YouTube refuses embeds without one. The origin alone
    // carries no room address (decision recorded in docs/decisions.md).
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.className = 'absolute inset-0 size-full border-0';
    this.container.replaceChildren(iframe);
    this.iframe = iframe;

    this.ready = new Promise<void>((resolve) => {
      this.player = new YT.Player(iframe, {
        events: {
          onReady: () => {
            this.isReady = true;
            this.detectRates();
            this.startPolling();
            resolve();
            for (const cb of this.readyCbs) cb();
          },
          onStateChange: (e) => this.handleState(e.data),
          onError: (e) => {
            // 101 and 150: the owner does not allow embedding; 100: not found or private; 2, 5: invalid.
            const kind: YouTubeErrorKind = e.data === 101 || e.data === 150 ? 'embed_blocked' : 'unavailable';
            for (const cb of this.errorCbs) cb(kind);
          },
          onAutoplayBlocked: () => this.settlePlay('blocked'),
        },
      });
    });
    await this.ready;
  }

  async play(): Promise<'ok' | 'blocked'> {
    if (!this.player) return 'blocked';
    // Skip the await once ready so playVideo runs inside the member's tap on strict browsers.
    if (!this.isReady) await this.ready;
    if (this.state === STATE.PLAYING) return 'ok';
    return new Promise((resolve) => {
      this.playWaiter = resolve;
      this.player!.playVideo();
      setTimeout(() => this.settlePlay(this.state === STATE.PLAYING || this.state === STATE.BUFFERING ? 'ok' : 'blocked'), PLAY_START_TIMEOUT_MS);
    });
  }

  async pause(): Promise<void> {
    await this.ready;
    this.player?.pauseVideo();
  }

  async seek(sec: number): Promise<void> {
    await this.ready;
    this.player?.seekTo(sec, true);
    this.lastPolled = sec;
    this.lastPolledAt = performance.now();
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.player?.setPlaybackRate(rate);
  }

  setVolume(level: number): void {
    if (!this.capabilities.volume) return;
    this.player?.setVolume(Math.round(Math.min(1, Math.max(0, level)) * 100));
  }

  getVolume(): number {
    return this.player ? this.player.getVolume() / 100 : 1;
  }

  getPosition(): number {
    return this.player?.getCurrentTime() ?? 0;
  }

  getDuration(): number | null {
    const d = this.player?.getDuration() ?? 0;
    return d > 0 ? d : null;
  }

  isPaused(): boolean {
    return !this.logicalPlaying;
  }

  isBuffering(): boolean {
    return this.state === STATE.BUFFERING;
  }

  isEnded(): boolean {
    return this.state === STATE.ENDED;
  }

  onUserAction(cb: (a: UserAction) => void) {
    this.actionCbs.add(cb);
    return () => this.actionCbs.delete(cb);
  }

  onBuffering(cb: (b: boolean) => void) {
    this.bufferingCbs.add(cb);
    return () => this.bufferingCbs.delete(cb);
  }

  onEnded(cb: () => void) {
    this.endedCbs.add(cb);
    return () => this.endedCbs.delete(cb);
  }

  onError(cb: (kind: YouTubeErrorKind) => void) {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  onReady(cb: () => void) {
    this.readyCbs.add(cb);
    return () => this.readyCbs.delete(cb);
  }

  /** Called from the "Tap to watch together" gesture: playVideo inside the tap. */
  playFromGesture(): void {
    this.player?.playVideo();
  }

  destroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.player?.destroy();
    this.player = null;
    this.iframe?.remove();
    this.actionCbs.clear();
    this.bufferingCbs.clear();
    this.endedCbs.clear();
    this.errorCbs.clear();
  }

  // Internals -----------------------------------------------------------------------------------

  /** fineRate is true only when the player offers both rate x 0.95 and rate x 1.05; expect false. */
  private detectRates(): void {
    const rates = this.player?.getAvailablePlaybackRates() ?? [];
    const has = (r: number) => rates.some((x) => Math.abs(x - r) < 1e-6);
    this.capabilities = { ...this.capabilities, fineRate: has(this.rate * 0.95) && has(this.rate * 1.05) };
  }

  private settlePlay(result: 'ok' | 'blocked'): void {
    const waiter = this.playWaiter;
    if (!waiter) return;
    this.playWaiter = null;
    waiter(result);
  }

  private handleState(next: number): void {
    const previous = this.state;
    this.state = next;
    const position = this.getPosition();
    if (next === STATE.BUFFERING && previous !== STATE.BUFFERING) this.emitBuffering(true);
    if (previous === STATE.BUFFERING && next !== STATE.BUFFERING) this.emitBuffering(false);

    if (next === STATE.PLAYING) {
      this.settlePlay('ok');
      if (!this.logicalPlaying) {
        this.logicalPlaying = true;
        this.emitAction({ kind: 'play', position });
      }
    } else if (next === STATE.PAUSED || next === STATE.CUED || next === STATE.ENDED) {
      if (this.logicalPlaying) {
        this.logicalPlaying = false;
        if (next === STATE.PAUSED) this.emitAction({ kind: 'pause', position });
      }
      if (next === STATE.ENDED) for (const cb of this.endedCbs) cb();
    }
    this.lastPolled = position;
    this.lastPolledAt = performance.now();
  }

  /** YouTube has no seek event, so seeks are found by polling the position. */
  private startPolling(): void {
    this.resetTracking();
    this.pollTimer = setInterval(() => {
      if (!this.player) return;
      const now = performance.now();
      const position = this.getPosition();
      const advancing = this.logicalPlaying && this.state === STATE.PLAYING;
      const predicted = advancing ? this.lastPolled + ((now - this.lastPolledAt) / 1000) * this.rate : this.lastPolled;
      if (Math.abs(position - predicted) > SEEK_JUMP_SEC) this.emitAction({ kind: 'seek', position });
      this.lastPolled = position;
      this.lastPolledAt = now;
    }, POLL_MS);
  }

  private resetTracking(): void {
    this.lastPolled = this.getPosition();
    this.lastPolledAt = performance.now();
    this.logicalPlaying = false;
  }

  private emitAction(action: UserAction): void {
    for (const cb of this.actionCbs) cb(action);
  }

  private emitBuffering(buffering: boolean): void {
    for (const cb of this.bufferingCbs) cb(buffering);
  }
}
