import type { AdapterCapabilities, PlayerAdapter, UserAction } from '@watchparty/sync-core';
import { isIOS } from './youtube';
type PlaybackUrl = { url: string; expires_at: string };
export class Html5VideoAdapter implements PlayerAdapter {
  readonly capabilities: AdapterCapabilities = {
    fineRate: true,
    volume: !isIOS(),
    seek: true,
    seekLatencySec: 0.3,
  };
  private video: HTMLVideoElement;
  private buffering = false;
  private destroyed = false;
  private refreshing = false;
  private expires = 0;
  private lastRefresh = 0;
  private actions = new Set<(a: UserAction) => void>();
  private buffers = new Set<(b: boolean) => void>();
  private ends = new Set<() => void>();
  private suppressed = new Map<string, { until: number; count: number }>();
  private timer: ReturnType<typeof setInterval>;
  constructor(
    container: HTMLElement,
    private resolveUrl: () => Promise<PlaybackUrl>,
    private state: () => { position: number; playing: boolean },
  ) {
    this.video = document.createElement('video');
    this.video.controls = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.className = 'absolute inset-0 size-full bg-black';
    this.video.dataset.testid = 'movie-video';
    this.video.setAttribute(
      'controlsList',
      `nodownload noremoteplayback${document.fullscreenEnabled && !isIOS() ? ' nofullscreen' : ''}`,
    );
    container.replaceChildren(this.video);
    for (const name of ['play', 'pause', 'seeked'])
      this.video.addEventListener(name, () => {
        const current = this.suppressed.get(name);
        if (current && current.until > Date.now() && current.count > 0) {
          current.count--;
          return;
        }
        if (!this.refreshing)
          for (const cb of this.actions)
            cb({
              kind: name === 'seeked' ? 'seek' : (name as 'play' | 'pause'),
              position: this.video.currentTime,
            });
      });
    for (const name of ['waiting', 'stalled'])
      this.video.addEventListener(name, () => this.setBuffering(true));
    for (const name of ['playing', 'canplay'])
      this.video.addEventListener(name, () => this.setBuffering(false));
    this.video.addEventListener('ended', () => this.ends.forEach((cb) => cb()));
    this.video.addEventListener('error', () => {
      void this.refresh().catch(() => this.setBuffering(true));
    });
    this.timer = setInterval(() => {
      if (this.video.paused && this.expires - Date.now() < 600000)
        void this.refresh().catch(() => this.setBuffering(true));
    }, 60000);
  }
  private suppress(name: string) {
    const old = this.suppressed.get(name);
    this.suppressed.set(name, {
      until: Date.now() + 3000,
      count: old && old.until > Date.now() ? old.count + 1 : 1,
    });
  }
  private setBuffering(on: boolean) {
    if (this.buffering !== on) {
      this.buffering = on;
      this.buffers.forEach((cb) => cb(on));
    }
  }
  private metadata(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.video.removeEventListener('loadedmetadata', ready);
        this.video.removeEventListener('error', failed);
      };
      const ready = () => {
        done();
        resolve();
      };
      const failed = () => {
        done();
        reject(new Error('Movie could not load'));
      };
      const timer = setTimeout(failed, 30000);
      this.video.addEventListener('loadedmetadata', ready, { once: true });
      this.video.addEventListener('error', failed, { once: true });
      this.video.src = url;
    });
  }
  async load(_id: string) {
    const url = await this.resolveUrl();
    if (this.destroyed) return;
    this.expires = Date.parse(url.expires_at);
    await this.metadata(url.url);
  }
  private async refresh() {
    if (this.destroyed || this.refreshing || Date.now() - this.lastRefresh < 30000) return;
    this.refreshing = true;
    this.lastRefresh = Date.now();
    try {
      const url = await this.resolveUrl();
      if (this.destroyed) return;
      this.expires = Date.parse(url.expires_at);
      await this.metadata(url.url);
      const current = this.state();
      await this.seek(current.position);
      if (current.playing) await this.play();
    } finally {
      this.refreshing = false;
    }
  }
  async play(): Promise<'ok' | 'blocked'> {
    if (!this.video.paused) return 'ok';
    this.suppress('play');
    try {
      await this.video.play();
      return 'ok';
    } catch {
      this.suppressed.delete('play');
      return 'blocked';
    }
  }
  async pause() {
    if (!this.video.paused) {
      this.suppress('pause');
      this.video.pause();
    }
  }
  async seek(sec: number) {
    const position = Math.max(0, Math.min(sec, this.getDuration() ?? sec));
    if (Math.abs(this.video.currentTime - position) > 0.001) {
      this.suppress('seeked');
      this.video.currentTime = position;
    }
  }
  setRate(rate: number) {
    this.video.playbackRate = rate;
  }
  setVolume(level: number) {
    if (this.capabilities.volume) this.video.volume = Math.min(1, Math.max(0, level));
  }
  getVolume() {
    return this.video.volume;
  }
  getPosition() {
    return this.video.currentTime;
  }
  getDuration() {
    return Number.isFinite(this.video.duration) ? this.video.duration : null;
  }
  isPaused() {
    return this.video.paused;
  }
  isBuffering() {
    return this.buffering;
  }
  isEnded() {
    return this.video.ended;
  }
  onUserAction(cb: (a: UserAction) => void) {
    this.actions.add(cb);
    return () => {
      this.actions.delete(cb);
    };
  }
  onBuffering(cb: (b: boolean) => void) {
    this.buffers.add(cb);
    return () => {
      this.buffers.delete(cb);
    };
  }
  onEnded(cb: () => void) {
    this.ends.add(cb);
    return () => {
      this.ends.delete(cb);
    };
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    this.actions.clear();
    this.buffers.clear();
    this.ends.clear();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }
}
