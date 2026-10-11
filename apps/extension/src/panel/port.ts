import { PORT_PANEL, ToPanel, parseMessage, type PanelToContent, type PanelToWorker, type ToPanel as ToPanelMessage } from '../shared/messages';

// The panel's port to the service worker. The worker relays content script messages to it and sends
// its own (which room this tab holds, whether the content script is connected, stop). The port is
// reopened if the worker restarts.

const RECONNECT_MS = 1000;

export class PanelPort {
  private port: chrome.runtime.Port | null = null;
  private closed = false;
  private readonly listeners = new Set<(message: ToPanelMessage) => void>();
  private readonly reconnectListeners = new Set<() => void>();

  constructor() {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const port = chrome.runtime.connect({ name: PORT_PANEL });
    this.port = port;
    port.onMessage.addListener((raw) => {
      const message = parseMessage(ToPanel, raw, (issues) => console.warn('[panel] dropped invalid message', issues));
      if (!message) return;
      for (const cb of this.listeners) cb(message);
    });
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
      for (const cb of this.reconnectListeners) cb();
      setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  send(message: PanelToContent | PanelToWorker): void {
    try {
      this.port?.postMessage(message);
    } catch {
      // Reconnecting; state is sent again once the pair forms.
    }
  }

  onMessage(cb: (message: ToPanelMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Called when the connection to the worker drops (it reconnects by itself). */
  onDisconnect(cb: () => void): () => void {
    this.reconnectListeners.add(cb);
    return () => this.reconnectListeners.delete(cb);
  }

  close(): void {
    this.closed = true;
    this.port?.disconnect();
    this.port = null;
  }
}
