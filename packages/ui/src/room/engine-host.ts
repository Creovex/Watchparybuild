import {
  SyncEngine,
  TICK_MS,
  type AdapterCapabilities,
  type EngineLogEntry,
  type EngineView,
  type PlaybackStateRow,
  type PlayerAdapter,
  type UserAction,
} from '@watchparty/sync-core';

// The room talks to the sync engine through this interface. On the room page the engine runs here
// beside a YouTube adapter; in the extension the engine runs in the streaming tab's content script
// and the panel drives it over a port, with the same interface.

export interface EngineHost {
  readonly capabilities: AdapterCapabilities;
  applyState(row: PlaybackStateRow): void;
  holdForLocalAction(): void;
  tapToPlay(): Promise<'ok' | 'blocked'>;
  resync(): void;
  getPosition(): number;
  getDuration(): number | null;
  isBuffering(): boolean;
  getVolume(): number;
  setVolume(level: number): void;
  onView(cb: (view: EngineView) => void): () => void;
  onUserAction(cb: (action: UserAction) => void): () => void;
  onBuffering(cb: (buffering: boolean) => void): () => void;
  onEnded(cb: () => void): () => void;
  stop(): void;
}

export class LocalEngineHost implements EngineHost {
  private readonly engine: SyncEngine;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly adapter: PlayerAdapter,
    serverNow: () => number,
    log?: (entry: EngineLogEntry) => void,
  ) {
    this.engine = new SyncEngine({ adapter, now: () => performance.now(), serverNow, log });
    this.timer = setInterval(() => this.engine.tick(), TICK_MS);
  }

  get capabilities() {
    return this.adapter.capabilities;
  }

  applyState(row: PlaybackStateRow) {
    if (this.engine.applyState(row)) this.engine.tick();
  }

  holdForLocalAction() {
    this.engine.holdForLocalAction();
  }

  tapToPlay() {
    return this.engine.tapToPlay();
  }

  resync() {
    this.engine.resync();
  }

  getPosition() {
    return this.adapter.getPosition();
  }

  getDuration() {
    return this.adapter.getDuration();
  }

  isBuffering() {
    return this.adapter.isBuffering();
  }

  getVolume() {
    return this.adapter.getVolume();
  }

  setVolume(level: number) {
    this.adapter.setVolume(level);
  }

  onView(cb: (view: EngineView) => void) {
    return this.engine.onView(cb);
  }

  onUserAction(cb: (action: UserAction) => void) {
    return this.engine.onUserAction(cb);
  }

  onBuffering(cb: (buffering: boolean) => void) {
    return this.adapter.onBuffering(cb);
  }

  onEnded(cb: () => void) {
    return this.adapter.onEnded(cb);
  }

  stop() {
    clearInterval(this.timer);
    this.engine.stop();
  }
}
