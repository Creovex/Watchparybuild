import type { PaidSource } from '@watchparty/sync-core';
import { PORT_CONTENT, ToContent, parseMessage, type ContentToPanel } from '../shared/messages';
import { S1_RESULTS, sourceForHost, titleKey } from '../shared/services';
import { EngineRunner } from './engine-runner';
import { FullscreenControl } from './fullscreen-control';
import { PanelHost } from './panel-host';
import { VideoElementAdapter } from './video-adapter';

// The content script in a Netflix, Prime Video or Disney+ watch page. It opens no network
// connections: it drives the page's video element and runs the sync engine, and talks only to the
// extension's service worker over a port, which relays to the panel in this tab. Until the worker
// says this tab holds a room, it does nothing to the page.

const PANEL_URL = chrome.runtime.getURL('src/panel/panel.html');
const RECONNECT_MS = 1000;
const ADDRESS_CHECK_MS = 1000;

function log(message: string, detail?: unknown): void {
  console.warn(`[watchparty] ${message}`, detail ?? '');
}

class ContentApp {
  private port: chrome.runtime.Port | null = null;
  private bound = false;
  private adapter: VideoElementAdapter | null = null;
  private runner: EngineRunner | null = null;
  private readonly panel = new PanelHost(document, PANEL_URL);
  private readonly fullscreen: FullscreenControl;
  private lastUrl = '';
  private stopped = false;
  private readonly addressTimer: ReturnType<typeof setInterval>;

  constructor(private readonly source: PaidSource) {
    this.fullscreen = new FullscreenControl(document, (action) => this.post({ type: 'fs_action', ...action }));
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
    // Services change title (the next episode) without reloading the page, so watch the address,
    // and keep the full screen control in place.
    this.addressTimer = setInterval(() => this.checkAddress(), ADDRESS_CHECK_MS);
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PORT_CONTENT });
    } catch {
      // The extension was reloaded or removed; this copy of the script is orphaned.
      this.shutdown();
      return;
    }
    this.port = port;
    port.onMessage.addListener((message) => this.handle(message));
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
      if (!chrome.runtime?.id) {
        this.shutdown();
        return;
      }
      setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  private post(message: ContentToPanel): void {
    try {
      this.port?.postMessage(message);
    } catch {
      // Reconnecting; the panel is brought up to date when the pair forms again.
    }
  }

  private handle(raw: unknown): void {
    const message = parseMessage(ToContent, raw, (issues) => log('dropped invalid message', issues));
    if (!message) return;
    switch (message.type) {
      case 'bound':
        this.setBound(message.bound);
        return;
      case 'peer':
        if (message.connected && this.bound) this.announce();
        return;
      case 'panel_ui':
        this.panel.setCollapsed(message.collapsed);
        return;
      case 'fs_state':
        this.fullscreen.update(message.voice, message.unread);
        return;
      case 'navigate':
        this.navigate(message.url);
        return;
      default:
        void this.runner?.handle(message);
    }
  }

  private setBound(bound: boolean): void {
    if (bound === this.bound) return;
    this.bound = bound;
    if (bound) {
      const adapter = new VideoElementAdapter({ doc: document, capabilities: S1_RESULTS[this.source].capabilities });
      this.adapter = adapter;
      this.runner = new EngineRunner({
        adapter,
        post: (message) => this.post(message),
        log: (entry) => log(`engine ${entry.event}`, { source: this.source, ...entry.detail }),
      });
      adapter.onVideoChange(() => this.sendCapabilities());
      this.panel.mount();
      this.announce();
      this.onFullscreenChange();
    } else {
      this.runner?.destroy();
      this.adapter?.destroy();
      this.runner = null;
      this.adapter = null;
      this.panel.unmount();
      this.fullscreen.detach();
    }
  }

  /** Brings a newly paired panel up to date. */
  private announce(): void {
    this.sendCapabilities();
    this.sendAddress();
    this.post({ type: 'fullscreen', on: Boolean(document.fullscreenElement) });
  }

  private sendCapabilities(): void {
    if (!this.adapter) return;
    this.post({
      type: 'capabilities',
      source: this.source,
      capabilities: this.adapter.capabilities,
      video: this.adapter.element !== null,
    });
  }

  private sendAddress(): void {
    this.lastUrl = location.href;
    this.post({ type: 'content_ref', url: location.href, title_key: titleKey(this.source, location.href) });
  }

  private checkAddress(): void {
    if (!this.bound) return;
    if (location.href !== this.lastUrl) this.sendAddress();
    // A service that redraws its full screen player can drop the control; put it back.
    const element = document.fullscreenElement;
    if (element && !this.fullscreen.attached) this.fullscreen.attach(element);
  }

  private onFullscreenChange(): void {
    const element = document.fullscreenElement;
    if (this.bound && element) this.fullscreen.attach(element);
    else this.fullscreen.detach();
    if (this.bound) this.post({ type: 'fullscreen', on: Boolean(element) });
  }

  /** Opens another title of the same service in this tab ("Go to the host's episode"). */
  private navigate(url: string): void {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return;
    }
    if (target.protocol !== 'https:' || sourceForHost(target.hostname) !== this.source) {
      log('refused navigation to another site', target.hostname);
      return;
    }
    location.assign(target.toString());
  }

  private shutdown(): void {
    this.stopped = true;
    clearInterval(this.addressTimer);
    this.setBound(false);
  }
}

const source = sourceForHost(location.hostname);
if (source && window.top === window) new ContentApp(source);
