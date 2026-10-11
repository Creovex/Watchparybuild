import type { SupabaseClient } from '@supabase/supabase-js';
import { isPaidSource, parsePaidRef, type AdapterCapabilities, type PaidSource, type ReactionEmoji } from '@watchparty/sync-core';
import { RoomController, Store, type FatalKind, type Me } from '@watchparty/ui/room';
import type { RoomRecord } from '../background/core';
import { roomKey, tokensKey } from '../shared/keys';
import type { ContentToPanel, PanelToContent, PanelToWorker, ToPanel, VoiceIndicator } from '../shared/messages';
import { titleKey } from '../shared/services';
import { errorSentence } from './errors';
import { PortEngineHost } from './port-engine-host';
import { createPanelClient } from './supabase';
import { workerTicker } from './ticker';

// Everything the panel does outside React: it learns from the service worker which room this tab
// holds, restores the handed over session, takes over the member's engine session with the shared
// RoomController, and drives the engine in the content script through a PortEngineHost.

export interface PanelMe extends Me {
  duckLevel: number | null;
}

export type EpisodeState = 'match' | 'guest_elsewhere' | 'host_elsewhere';

export interface PanelState {
  phase: 'connecting' | 'no_room' | 'starting' | 'room' | 'error';
  error: string | null;
  roomId: string | null;
  controller: RoomController | null;
  me: PanelMe | null;
  /** True while the content script in this tab is connected. */
  peer: boolean;
  source: PaidSource | null;
  /** True when the content script found a video element. */
  video: boolean;
  tabUrl: string | null;
  fullscreen: boolean;
  episode: EpisodeState;
  /** Why the worker stopped this panel, when it did. */
  stopReason: 'reclaimed' | 'replaced' | null;
}

export interface PanelTransport {
  send(message: PanelToContent | PanelToWorker): void;
  onMessage(cb: (message: ToPanel) => void): () => void;
  onDisconnect(cb: () => void): () => void;
}

export interface SessionStore {
  get(key: string): Promise<unknown>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface PanelSessionDeps {
  port: PanelTransport;
  storage: SessionStore;
  createClient?: (roomId: string) => SupabaseClient;
  log?: (event: string, detail?: unknown) => void;
}

export class PanelSession {
  readonly store = new Store<PanelState>({
    phase: 'connecting',
    error: null,
    roomId: null,
    controller: null,
    me: null,
    peer: false,
    source: null,
    video: false,
    tabUrl: null,
    fullscreen: false,
    episode: 'match',
    stopReason: null,
  });

  private supabase: SupabaseClient | null = null;
  private controller: RoomController | null = null;
  private record: RoomRecord | null = null;
  private host: PortEngineHost | null = null;
  private capabilities: AdapterCapabilities | null = null;
  private engineAttached = false;
  private lastTabKey: string | null = null;
  private lastAutoSource: string | null = null;
  private finished = false;
  private voiceIndicator: VoiceIndicator = 'off';
  private unreadBaseline: Set<string> | null = null;
  private lastFsState = '';
  private leaveVoice: (() => Promise<void>) | null = null;
  private readonly micListeners = new Set<() => void>();
  private readonly unsubs: Array<() => void> = [];

  constructor(private readonly deps: PanelSessionDeps) {
    this.unsubs.push(
      deps.port.onMessage((message) => void this.handle(message)),
      deps.port.onDisconnect(() => this.store.set({ peer: false })),
    );
  }

  private log(event: string, detail?: unknown): void {
    this.deps.log?.(event, detail);
  }

  // Messages ----------------------------------------------------------------------------------------

  private async handle(message: ToPanel): Promise<void> {
    switch (message.type) {
      case 'bind':
        if (message.room_id === null) {
          if (!this.controller) this.store.set({ phase: 'no_room' });
        } else if (message.room_id !== this.store.get().roomId) {
          await this.start(message.room_id);
        }
        return;
      case 'peer':
        this.store.set({ peer: message.connected });
        if (message.connected) {
          this.host?.resend();
          this.lastFsState = '';
          this.sendFullscreenState();
        }
        return;
      case 'stop':
        await this.stop(message.reason);
        return;
      case 'capabilities':
        this.capabilities = message.capabilities;
        this.store.set({ source: message.source, video: message.video });
        this.host?.setCapabilities(message.capabilities);
        this.ensureEngine();
        return;
      case 'content_ref':
        this.onTabAddress(message.url, message.title_key);
        return;
      case 'fullscreen':
        this.store.set({ fullscreen: message.on });
        this.unreadBaseline = message.on ? new Set(this.controller?.store.get().messages.map((m) => m.id) ?? []) : null;
        this.sendFullscreenState();
        return;
      case 'fs_action':
        if (message.action === 'react') this.controller?.react(message.emoji);
        else for (const cb of this.micListeners) cb();
        return;
      default:
        this.host?.receive(message as ContentToPanel);
    }
  }

  // Starting ------------------------------------------------------------------------------------------

  private async start(roomId: string): Promise<void> {
    try {
      await this.startRoom(roomId);
    } catch (error) {
      // A build without the Supabase settings, or storage that cannot be read, ends here.
      this.log('could not start the room', error);
      this.fail(errorSentence('internal'));
    }
  }

  private async startRoom(roomId: string): Promise<void> {
    this.store.set({ phase: 'starting', roomId, error: null });
    const key = roomKey(roomId);
    const record = (await this.deps.storage.get(key)) as RoomRecord | undefined;
    if (!record || record.room_id !== roomId) {
      this.store.set({ phase: 'no_room' });
      return;
    }
    this.record = record;
    const supabase = (this.deps.createClient ?? createPanelClient)(roomId);
    this.supabase = supabase;

    // Prefer the session Supabase already stored for this panel (it may have been refreshed since
    // the handover); use the handed over pair only on the first load. Using an older refresh token
    // than the newest would get the session revoked.
    let { data } = await supabase.auth.getSession();
    if (!data.session) {
      const restored = await supabase.auth.setSession(record.session);
      if (restored.error || !restored.data.session) {
        this.fail(errorSentence('unauthorized'));
        return;
      }
      data = { session: restored.data.session };
    }
    const session = data.session!;
    await this.writeTokens(session.access_token, session.refresh_token);
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      // The pair the worker returns to the room page must be the newest one.
      if (next && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
        void this.writeTokens(next.access_token, next.refresh_token);
      }
    });
    this.unsubs.push(() => listener.subscription.unsubscribe());

    const me = await this.loadMe(supabase, session.user.id, session.user.user_metadata);
    const controller = new RoomController({
      supabase,
      me,
      device: 'desktop',
      engine: 'extension',
      createTicker: workerTicker,
      log: (event, detail) => this.log(event, detail),
    });
    this.controller = controller;
    this.unsubs.push(controller.store.subscribe(() => this.onRoomChange()));
    const res = await controller.resume({
      roomId,
      slug: record.slug,
      engineSession: record.engine_session,
      syncMode: 'auto',
    });
    if (!res.ok && controller.store.get().status !== 'fatal') {
      this.fail(errorSentence(res.code, { roomCap: controller.store.get().room?.room_cap }));
      void this.finish('release');
      return;
    }
    this.store.set({ phase: 'room', controller, me });
    this.ensureEngine();
    this.evaluateEpisode();
  }

  private async loadMe(supabase: SupabaseClient, userId: string, metadata: Record<string, unknown>): Promise<PanelMe> {
    const { data } = await supabase.from('profiles').select('display_name, avatar_url, duck_level').eq('id', userId).maybeSingle();
    const profile = data as { display_name?: string; avatar_url?: string | null; duck_level?: number | null } | null;
    const fallbackName = typeof metadata.full_name === 'string' ? metadata.full_name : 'You';
    return {
      id: userId,
      name: profile?.display_name || fallbackName,
      avatarUrl: profile?.avatar_url ?? null,
      duckLevel: profile ? (profile.duck_level ?? null) : 0.35,
    };
  }

  private fail(message: string): void {
    this.store.set({ phase: 'error', error: message });
  }

  private async writeTokens(accessToken: string, refreshToken: string): Promise<void> {
    if (!this.record) return;
    await this.deps.storage.set({ [tokensKey(this.record.room_id)]: { access_token: accessToken, refresh_token: refreshToken } });
  }

  // Engine ------------------------------------------------------------------------------------------

  private ensureEngine(): void {
    const controller = this.controller;
    if (!controller || !this.capabilities || this.finished) return;
    if (!this.host) {
      this.host = new PortEngineHost({
        send: (message) => this.deps.port.send(message),
        capabilities: this.capabilities,
        serverOffset: () => controller.clock.offset,
      });
    }
    this.syncEngineAttachment();
  }

  /** The engine follows the room only while this tab is on the room's title. */
  private syncEngineAttachment(): void {
    const controller = this.controller;
    const host = this.host;
    if (!controller || !host || this.finished) return;
    const status = controller.store.get().status;
    const shouldAttach = this.store.get().episode === 'match' && status !== 'fatal' && status !== 'idle';
    if (shouldAttach && !this.engineAttached) {
      controller.attachEngine(host);
      this.engineAttached = true;
    } else if (!shouldAttach && this.engineAttached) {
      controller.detachEngine();
      host.stop();
      this.engineAttached = false;
    }
  }

  // Episodes ------------------------------------------------------------------------------------------

  private onTabAddress(url: string, key: string | null): void {
    const changedHere = key !== null && this.lastTabKey !== null && key !== this.lastTabKey;
    if (key !== null) this.lastTabKey = key;
    this.store.set({ tabUrl: url });
    this.evaluateEpisode(changedHere ? url : null);
  }

  /**
   * Compares this tab's title with the room's. When the host's tab moves to a new title (the next
   * episode), the room follows. A guest on another title sees a notice and a way back, and the
   * engine stops driving their player meanwhile.
   */
  private evaluateEpisode(hostMovedTo: string | null = null): void {
    const controller = this.controller;
    const room = controller?.store.get().room;
    const tabUrl = this.store.get().tabUrl;
    if (!controller || !room || !tabUrl || !isPaidSource(room.source)) return;
    const tabKey = titleKey(room.source, tabUrl);
    const roomTitle = titleKey(room.source, room.content_ref);
    const differs = tabKey !== null && roomTitle !== null && tabKey !== roomTitle;
    const isHost = controller.isHost();

    if (differs && isHost && hostMovedTo && this.lastAutoSource !== tabKey) {
      this.lastAutoSource = tabKey;
      void this.playThisTitleForEveryone();
    }
    const episode: EpisodeState = !differs ? 'match' : isHost ? 'host_elsewhere' : 'guest_elsewhere';
    if (episode !== this.store.get().episode) this.store.set({ episode });
    this.syncEngineAttachment();
  }

  /** The host's choice: make the title in this tab the room's title. */
  async playThisTitleForEveryone(): Promise<boolean> {
    const controller = this.controller;
    const room = controller?.store.get().room;
    const tabUrl = this.store.get().tabUrl;
    if (!controller || !room || !tabUrl || !isPaidSource(room.source)) return false;
    const ref = parsePaidRef(room.source, tabUrl);
    if (!ref.ok) return false;
    return controller.setSource(room.source, ref.ref);
  }

  /** The guest's choice: open the host's title in this tab. */
  openRoomTitle(): void {
    const room = this.controller?.store.get().room;
    if (room?.content_ref) this.deps.port.send({ type: 'navigate', url: room.content_ref });
  }

  // Room changes ------------------------------------------------------------------------------------

  private lastRoomRef: string | null | undefined = undefined;
  private lastHostId: string | null | undefined = undefined;

  private onRoomChange(): void {
    const controller = this.controller;
    if (!controller) return;
    const snapshot = controller.store.get();
    if (snapshot.room && (snapshot.room.content_ref !== this.lastRoomRef || snapshot.room.host_id !== this.lastHostId)) {
      this.lastRoomRef = snapshot.room.content_ref;
      this.lastHostId = snapshot.room.host_id;
      this.evaluateEpisode();
    }
    if (snapshot.status === 'fatal' && snapshot.fatal) this.onFatal(snapshot.fatal);
    this.sendFullscreenState();
  }

  private onFatal(kind: FatalKind): void {
    if (this.finished) return;
    // A stop from the worker finishes on its own path and answers `stopped`.
    if (kind === 'handed_over' && this.store.get().stopReason) return;
    void this.finish('release');
  }

  // Stopping ------------------------------------------------------------------------------------------

  /** React registers how to leave voice, so a stop can leave it before handing the session back. */
  setVoiceLeave(leave: (() => Promise<void>) | null): void {
    this.leaveVoice = leave;
  }

  /** The worker asked this panel to stop: the room page took the room back, or another tab did. */
  private async stop(reason: 'reclaimed' | 'replaced'): Promise<void> {
    this.store.set({ stopReason: reason });
    this.supabase?.auth.stopAutoRefresh();
    try {
      await this.leaveVoice?.();
    } catch {
      // Voice may already be gone.
    }
    await this.controller?.handOver();
    await this.finish('stopped');
  }

  /**
   * Stops acting for the member: no more token refresh, engine suspended, realtime closed. The last
   * tokens are written so the worker returns the newest pair, then the worker is told.
   */
  private async finish(answer: 'stopped' | 'release'): Promise<void> {
    if (this.finished && answer === 'release') return;
    this.finished = true;
    const roomId = this.record?.room_id;
    const supabase = this.supabase;
    supabase?.auth.stopAutoRefresh();
    if (this.engineAttached) this.controller?.detachEngine();
    this.engineAttached = false;
    this.host?.dispose();
    this.host = null;
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session) await this.writeTokens(data.session.access_token, data.session.refresh_token);
      void supabase.realtime.disconnect();
    }
    if (roomId) this.deps.port.send({ type: answer, room_id: roomId });
  }

  // Full screen control -------------------------------------------------------------------------------

  setVoiceIndicator(voice: VoiceIndicator): void {
    this.voiceIndicator = voice;
    this.sendFullscreenState();
  }

  /** The floating control's microphone button was pressed. */
  onFullscreenMic(cb: () => void): () => void {
    this.micListeners.add(cb);
    return () => this.micListeners.delete(cb);
  }

  private unread(): number {
    const baseline = this.unreadBaseline;
    const controller = this.controller;
    if (!baseline || !controller) return 0;
    return controller.store
      .get()
      .messages.filter((m) => m.kind !== 'system' && m.user_id !== controller.userId && !baseline.has(m.id)).length;
  }

  private sendFullscreenState(): void {
    if (!this.store.get().fullscreen) return;
    const unread = this.unread();
    const key = `${this.voiceIndicator}:${unread}`;
    if (key === this.lastFsState) return;
    this.lastFsState = key;
    this.deps.port.send({ type: 'fs_state', voice: this.voiceIndicator, unread });
  }

  /** Collapses the docked panel (the header's hide button). */
  collapse(): void {
    this.deps.port.send({ type: 'panel_ui', collapsed: true });
  }

  /** Reacts from the panel or the floating control. */
  react(emoji: ReactionEmoji): void {
    this.controller?.react(emoji);
  }

  async destroy(): Promise<void> {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    await this.controller?.destroy();
  }
}
