import { SyncEngine, TICK_MS, type EngineLogEntry, type EngineView, type PlayerAdapter } from '@watchparty/sync-core';
import type { ContentToPanel, PanelToContent, PlayerSnapshot } from '../shared/messages';

// Runs the sync engine inside the streaming tab, beside the player it drives. The panel owns the
// room and sends playback state, the clock offset and the member's taps; this side answers with the
// engine's view, the player's readings and the member's own play, pause and seek.
//
// The engine ticks every 250 ms from a page timer. Browsers slow page timers in hidden tabs to about
// once a second, which the once a second drift check tolerates; a tab playing sound is exempt from
// the stronger throttling, and every `state` from the panel ticks the engine straight away.

export interface RunnerAdapter extends PlayerAdapter {
  getRate?(): number;
}

export interface EngineRunnerDeps {
  adapter: RunnerAdapter;
  post: (message: ContentToPanel) => void;
  now?: () => number;
  wallNow?: () => number;
  setInterval?: (cb: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  log?: (entry: EngineLogEntry) => void;
}

export class EngineRunner {
  private engine: SyncEngine | null = null;
  private timer: unknown = null;
  private offsetMs = 0;
  private volumeSeq = 0;
  private readonly unsubs: Array<() => void> = [];
  private engineUnsubs: Array<() => void> = [];
  private readonly now: () => number;
  private readonly wallNow: () => number;

  constructor(private readonly deps: EngineRunnerDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.wallNow = deps.wallNow ?? (() => Date.now());
    this.unsubs.push(
      deps.adapter.onBuffering((buffering) => deps.post({ type: 'buffering', buffering })),
      deps.adapter.onEnded(() => deps.post({ type: 'ended' })),
    );
  }

  get running(): boolean {
    return this.engine !== null;
  }

  /** Server time as this tab sees it. */
  serverNow(): number {
    return this.wallNow() + this.offsetMs;
  }

  async handle(message: PanelToContent): Promise<void> {
    switch (message.type) {
      case 'state': {
        const engine = this.engine ?? this.start();
        if (engine.applyState(message.row)) engine.tick();
        return;
      }
      case 'server_offset':
        this.offsetMs = message.offset_ms;
        return;
      case 'hold':
        this.engine?.holdForLocalAction();
        return;
      case 'tap': {
        // The tap happened in the panel; the browser counts it as activation for this page too.
        const result = this.engine ? await this.engine.tapToPlay() : await this.deps.adapter.play();
        this.deps.post({ type: 'tap_result', id: message.id, result });
        return;
      }
      case 'resync':
        this.engine?.resync();
        return;
      case 'volume':
        this.deps.adapter.setVolume(message.level);
        this.volumeSeq = Math.max(this.volumeSeq, message.seq);
        this.postView();
        return;
      case 'suspend':
        this.stopEngine();
        return;
      default:
        // Panel interface messages (collapse, full screen state, navigation) are handled elsewhere.
        return;
    }
  }

  snapshot(): PlayerSnapshot {
    const adapter = this.deps.adapter;
    return {
      position: adapter.getPosition(),
      duration: adapter.getDuration(),
      buffering: adapter.isBuffering(),
      paused: adapter.isPaused(),
      volume: Math.min(1, Math.max(0, adapter.getVolume())),
      volume_seq: this.volumeSeq,
      rate: adapter.getRate?.() || 1,
      at: this.wallNow(),
    };
  }

  private start(): SyncEngine {
    const engine = new SyncEngine({
      adapter: this.deps.adapter,
      now: this.now,
      serverNow: () => this.serverNow(),
      log: this.deps.log,
    });
    this.engine = engine;
    this.engineUnsubs = [
      engine.onView((view) => this.postView(view)),
      engine.onUserAction((action) => this.deps.post({ type: 'user_action', action })),
    ];
    const every = this.deps.setInterval ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
    this.timer = every(() => engine.tick(), TICK_MS);
    return engine;
  }

  private postView(view: EngineView | null = this.engine?.currentView ?? null): void {
    if (!view) return;
    this.deps.post({ type: 'view', view, player: this.snapshot() });
  }

  private stopEngine(): void {
    if (this.timer !== null) {
      const clear = this.deps.clearInterval ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
      clear(this.timer);
      this.timer = null;
    }
    for (const off of this.engineUnsubs) off();
    this.engineUnsubs = [];
    this.engine?.stop();
    this.engine = null;
  }

  destroy(): void {
    this.stopEngine();
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
  }
}
