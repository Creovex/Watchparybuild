'use client';

import type { AdapterCapabilities, PlayerAdapter, UserAction } from '@watchparty/sync-core';

// Test builds only (NEXT_PUBLIC_E2E=1): a PlayerAdapter over an HTML5 video of a local test file,
// so end to end sync tests run headless without YouTube. `window.__stub.setBuffering(true)`
// simulates a member whose stream stalls.

declare global {
  interface Window {
    __stub?: { adapter: StubAdapter; setBuffering(on: boolean): void; position(): number };
  }
}

export class StubAdapter implements PlayerAdapter {
  capabilities: AdapterCapabilities = { fineRate: true, volume: true, seek: true, seekLatencySec: 0.1 };
  private readonly video: HTMLVideoElement;
  private forcedBuffering = false;
  private readonly actionCbs = new Set<(a: UserAction) => void>();
  private readonly bufferingCbs = new Set<(b: boolean) => void>();
  private readonly endedCbs = new Set<() => void>();

  constructor(container: HTMLElement) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.controls = true;
    this.video.className = 'absolute inset-0 size-full bg-black';
    this.video.dataset.testid = 'stub-video';
    container.replaceChildren(this.video);
    this.video.addEventListener('play', () => this.report('play'));
    this.video.addEventListener('pause', () => this.report('pause'));
    this.video.addEventListener('seeked', () => this.report('seek'));
    this.video.addEventListener('ended', () => this.endedCbs.forEach((cb) => cb()));
    window.__stub = {
      adapter: this,
      setBuffering: (on) => this.setBuffering(on),
      position: () => this.video.currentTime,
    };
  }

  /** Test hook: pretend the stream is stalled (or recovered). */
  setBuffering(on: boolean): void {
    if (this.forcedBuffering === on) return;
    this.forcedBuffering = on;
    if (on) this.video.pause();
    for (const cb of this.bufferingCbs) cb(on);
  }

  private report(kind: UserAction['kind']): void {
    for (const cb of this.actionCbs) cb({ kind, position: this.video.currentTime });
  }

  async load(): Promise<void> {
    this.video.src = '/e2e/test.webm';
    this.video.loop = false;
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 1) resolve();
      else this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  }

  async play(): Promise<'ok' | 'blocked'> {
    if (this.forcedBuffering) return 'ok';
    try {
      await this.video.play();
      return 'ok';
    } catch {
      return 'blocked';
    }
  }

  async pause(): Promise<void> {
    this.video.pause();
  }

  async seek(sec: number): Promise<void> {
    this.video.currentTime = sec;
  }

  setRate(rate: number): void {
    this.video.playbackRate = rate;
  }

  setVolume(level: number): void {
    this.video.volume = Math.min(1, Math.max(0, level));
  }

  getVolume(): number {
    return this.video.volume;
  }

  getPosition(): number {
    return this.video.currentTime;
  }

  getDuration(): number | null {
    return Number.isFinite(this.video.duration) ? this.video.duration : null;
  }

  isPaused(): boolean {
    return this.forcedBuffering ? false : this.video.paused;
  }

  isBuffering(): boolean {
    return this.forcedBuffering;
  }

  isEnded(): boolean {
    return this.video.ended;
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

  destroy(): void {
    this.video.remove();
    if (window.__stub?.adapter === this) delete window.__stub;
  }
}
