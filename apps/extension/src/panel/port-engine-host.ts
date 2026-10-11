import type { AdapterCapabilities, EngineView, PlaybackStateRow, UserAction } from '@watchparty/sync-core';
import type { EngineHost } from '@watchparty/ui/room';
import type { ContentToPanel, PanelToContent, PlayerSnapshot } from '../shared/messages';

// The room controller's engine, seen from the panel. The engine itself runs in the content script
// of this tab beside the video element; this host sends it playback state and the member's taps over
// the port and keeps the latest readings it reports, so the controller can read position, duration,
// buffering and volume without waiting.

/** How long to wait for the content script to answer a tap before showing the tap button again. */
export const TAP_TIMEOUT_MS = 5000;
const OFFSET_CHECK_MS = 5000;

type Listener<T> = (value: T) => void;

export interface PortEngineHostDeps {
  send: (message: PanelToContent) => void;
  capabilities: AdapterCapabilities;
  /** Milliseconds to add to Date.now() for server time; read from the room controller's clock. */
  serverOffset: () => number;
  wallNow?: () => number;
  setInterval?: (cb: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (cb: () => void, ms: number) => unknown;
}

export class PortEngineHost implements EngineHost {
  private caps: AdapterCapabilities;
  private snapshot: PlayerSnapshot | null = null;
  private view: EngineView | null = null;
  private lastState: PlaybackStateRow | null = null;
  private sentOffset: number | null = null;
  private volumeSeq = 0;
  private sentVolume: number | null = null;
  private tapId = 0;
  private stopped = false;
  private readonly taps = new Map<number, (result: 'ok' | 'blocked') => void>();
  private readonly viewListeners = new Set<Listener<EngineView>>();
  private readonly actionListeners = new Set<Listener<UserAction>>();
  private readonly bufferingListeners = new Set<Listener<boolean>>();
  private readonly endedListeners = new Set<() => void>();
  private readonly offsetTimer: unknown;
  private readonly wallNow: () => number;

  constructor(private readonly deps: PortEngineHostDeps) {
    this.caps = { ...deps.capabilities };
    this.wallNow = deps.wallNow ?? (() => Date.now());
    this.sendOffset(true);
    const every = deps.setInterval ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
    this.offsetTimer = every(() => this.sendOffset(false), OFFSET_CHECK_MS);
  }

  get capabilities(): AdapterCapabilities {
    return this.caps;
  }

  /** The content script reported capabilities again (a new video element, or a new pairing). */
  setCapabilities(capabilities: AdapterCapabilities): void {
    this.caps = { ...capabilities };
  }

  /** The content script reconnected with a fresh engine: bring it up to date. */
  resend(): void {
    if (this.stopped) return;
    this.sendOffset(true);
    if (this.lastState) this.deps.send({ type: 'state', row: this.lastState });
  }

  /** Feeds a message from the content script. */
  receive(message: ContentToPanel): void {
    switch (message.type) {
      case 'view':
        this.snapshot = message.player;
        this.view = message.view;
        for (const cb of this.viewListeners) cb(message.view);
        return;
      case 'user_action':
        for (const cb of this.actionListeners) cb(message.action);
        return;
      case 'buffering':
        if (this.snapshot) this.snapshot = { ...this.snapshot, buffering: message.buffering };
        for (const cb of this.bufferingListeners) cb(message.buffering);
        return;
      case 'ended':
        for (const cb of this.endedListeners) cb();
        return;
      case 'tap_result':
        this.taps.get(message.id)?.(message.result);
        return;
      case 'capabilities':
        this.setCapabilities(message.capabilities);
        return;
      default:
        return;
    }
  }

  // EngineHost ------------------------------------------------------------------------------------

  applyState(row: PlaybackStateRow): void {
    this.lastState = row;
    this.stopped = false;
    this.sendOffset(false);
    this.deps.send({ type: 'state', row });
  }

  holdForLocalAction(): void {
    this.deps.send({ type: 'hold' });
  }

  tapToPlay(): Promise<'ok' | 'blocked'> {
    const id = ++this.tapId;
    const later = this.deps.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
    return new Promise((resolve) => {
      const finish = (result: 'ok' | 'blocked') => {
        if (!this.taps.delete(id)) return;
        resolve(result);
      };
      this.taps.set(id, finish);
      later(() => finish('blocked'), TAP_TIMEOUT_MS);
      this.deps.send({ type: 'tap', id });
    });
  }

  resync(): void {
    this.deps.send({ type: 'resync' });
  }

  getPosition(): number {
    const s = this.snapshot;
    if (!s) return this.view?.local ?? 0;
    if (s.paused || s.buffering) return s.position;
    // Readings arrive four times a second; project forward so heartbeats and pins are current.
    return s.position + (Math.max(0, this.wallNow() - s.at) / 1000) * s.rate;
  }

  getDuration(): number | null {
    return this.snapshot?.duration ?? null;
  }

  isBuffering(): boolean {
    return this.snapshot?.buffering ?? false;
  }

  /**
   * The movie volume. While a change sent from here has not shown up in a reading yet, the value
   * sent is returned, so ducking does not mistake an old reading for the member's own change.
   */
  getVolume(): number {
    const s = this.snapshot;
    if (this.sentVolume !== null && (!s || s.volume_seq < this.volumeSeq)) return this.sentVolume;
    return s?.volume ?? this.sentVolume ?? 1;
  }

  setVolume(level: number): void {
    if (!this.caps.volume) return;
    const clamped = Math.min(1, Math.max(0, level));
    this.volumeSeq += 1;
    this.sentVolume = clamped;
    this.deps.send({ type: 'volume', level: clamped, seq: this.volumeSeq });
  }

  onView(cb: (view: EngineView) => void): () => void {
    this.viewListeners.add(cb);
    if (this.view) cb(this.view);
    return () => this.viewListeners.delete(cb);
  }

  onUserAction(cb: (action: UserAction) => void): () => void {
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

  /** Stops the engine in the content script until the next state is applied. */
  stop(): void {
    this.stopped = true;
    this.deps.send({ type: 'suspend' });
  }

  /** Ends this host for good (the panel is closing the room). */
  dispose(): void {
    this.stop();
    const clear = this.deps.clearInterval ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
    clear(this.offsetTimer);
    for (const finish of [...this.taps.values()]) finish('blocked');
    this.viewListeners.clear();
    this.actionListeners.clear();
    this.bufferingListeners.clear();
    this.endedListeners.clear();
  }

  private sendOffset(force: boolean): void {
    const offset = this.deps.serverOffset();
    if (!force && this.sentOffset !== null && Math.abs(offset - this.sentOffset) < 1) return;
    this.sentOffset = offset;
    this.deps.send({ type: 'server_offset', offset_ms: offset });
  }
}
