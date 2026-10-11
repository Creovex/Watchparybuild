import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import {
  ClientEvents,
  COUNTDOWN_MS,
  electedMember,
  expectedPosition,
  HEARTBEAT_INTERVAL_MS,
  isPaidSource,
  isPresent,
  MemberRow,
  MessageRow,
  parseEvent,
  passedComments,
  PlaybackStateRow,
  PresencePayload,
  ProfilePublic,
  ReactionLimiter,
  REACTION_VISIBLE_MS,
  RoomRow,
  ServerClock,
  ServerEvents,
  TIMED_VISIBLE_MS,
  TOUCH_INTERVAL_MS,
  WaitForEveryone,
  type EngineView,
  type ErrorCode,
  type JoinResult,
  type ModerationAction,
  type ModerationEvent,
  type PlaybackStatus,
  type ReactionEmoji,
  type ReportReason,
  type Result,
  type RtcEvent,
  type Source,
  type SyncMode,
  type UserAction,
} from '@watchparty/sync-core';
import { RoomApi, type RoomSettings } from './api';
import type { EngineHost } from './engine-host';
import { Store } from './store';

// The room client: everything a member's engine owner does while in a room, except drawing it.
// Used by the room page and by the extension panel. Spec references are to the build prompt's
// "Realtime channels", "Reconnection" and "Sync design" sections.

export type DeviceKind = 'phone' | 'desktop';
export type VoicePresence = 'off' | 'muted' | 'live';
export type FatalKind =
  | 'removed'
  | 'banned'
  | 'closed'
  | 'replaced'
  | 'not_member'
  | 'room_full'
  | 'left'
  | 'handed_over';

export interface Me {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface MemberView extends MemberRow {
  name: string;
  avatar_url: string | null;
  present: boolean;
  presence: PresencePayload | null;
}

export interface FloatingReaction {
  id: number;
  emoji: ReactionEmoji;
  userId: string;
  /** Horizontal start, 0 to 1 of the band's width. */
  x: number;
  /** Sideways drift in pixels while rising. */
  drift: number;
}

export interface TimedPopup {
  id: string;
  body: string;
  userId: string | null;
  position: number;
}

export interface RoomSnapshot {
  status: 'idle' | 'joining' | 'live' | 'reconnecting' | 'fatal';
  fatal: FatalKind | null;
  room: RoomRow | null;
  playback: PlaybackStateRow | null;
  members: MemberView[];
  messages: MessageRow[];
  hasOlder: boolean;
  loadingOlder: boolean;
  reactions: FloatingReaction[];
  popups: TimedPopup[];
  engine: EngineView | null;
  online: boolean;
  syncMode: SyncMode;
  electedId: string | null;
  voice: VoicePresence;
  /** Presence on the client topic, this member included. For display and voice only. */
  presence: PresencePayload[];
}

export interface Notice {
  message: string;
  tone: 'info' | 'error';
  code?: ErrorCode;
}

export interface RoomControllerOptions {
  supabase: SupabaseClient;
  me: Me;
  device: DeviceKind;
  engine: 'page' | 'extension';
  /** Runs `cb` every `ms`; the web app uses a Web Worker so hidden tabs are not throttled. */
  createTicker?: (ms: number, cb: () => void) => () => void;
  log?: (event: string, detail?: unknown) => void;
}

const MESSAGE_PAGE = 100;
const CLOCK_RESYNC_MS = 60_000;
const WAIT_CHECK_MS = 1_000;
const POSITION_POLL_MS = 250;

function defaultTicker(ms: number, cb: () => void): () => void {
  const id = setInterval(cb, ms);
  return () => clearInterval(id);
}

function byCreatedAt(a: MessageRow, b: MessageRow): number {
  return Date.parse(a.created_at) - Date.parse(b.created_at);
}

export class RoomController {
  readonly store: Store<RoomSnapshot>;
  readonly api: RoomApi;
  readonly clock: ServerClock;
  private readonly supabase: SupabaseClient;
  private readonly opts: RoomControllerOptions;
  private readonly me: Me;
  private roomId: string | null = null;
  private slug: string | null = null;
  private engineSession: string | null = null;
  private epoch = 0;
  private lastSeq = -1;
  private buffering = false;
  private serverChannel: RealtimeChannel | null = null;
  private clientChannel: RealtimeChannel | null = null;
  private host: EngineHost | null = null;
  private hostUnsubs: Array<() => void> = [];
  private stops: Array<() => void> = [];
  private profiles = new Map<string, ProfilePublic>();
  private presence = new Map<string, PresencePayload>();
  private memberRows = new Map<string, MemberRow>();
  private readonly reactionLimiter = new ReactionLimiter();
  private readonly waiter = new WaitForEveryone();
  private reactionId = 1;
  private lastPolledPosition: number | null = null;
  private reconnecting = false;
  private destroyed = false;
  private readonly noticeListeners = new Set<(n: Notice) => void>();
  private readonly rtcListeners = new Set<(e: RtcEvent) => void>();
  private readonly moderationListeners = new Set<(e: ModerationEvent) => void>();

  constructor(opts: RoomControllerOptions) {
    this.opts = opts;
    this.supabase = opts.supabase;
    this.me = opts.me;
    this.api = new RoomApi(opts.supabase);
    this.clock = new ServerClock(async () => {
      const res = await this.api.serverTime();
      if (!res.ok) throw new Error('server_time failed');
      return res.data;
    });
    this.store = new Store<RoomSnapshot>({
      status: 'idle',
      fatal: null,
      room: null,
      playback: null,
      members: [],
      messages: [],
      hasOlder: false,
      loadingOlder: false,
      reactions: [],
      popups: [],
      engine: null,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      syncMode: 'auto',
      electedId: null,
      voice: 'off',
      presence: [],
    });
  }

  get userId(): string {
    return this.me.id;
  }

  get session(): { roomId: string; slug: string; engineSession: string } | null {
    if (!this.roomId || !this.slug || !this.engineSession) return null;
    return { roomId: this.roomId, slug: this.slug, engineSession: this.engineSession };
  }

  // Joining ---------------------------------------------------------------------------------------

  /** Joins the room, subscribes to both topics, then loads state. Returns the join result. */
  async join(slug: string, joinKey: string | null, syncMode: SyncMode): Promise<Result<JoinResult>> {
    this.store.set({ status: 'joining', syncMode });
    const res = await this.api.joinRoom(slug, joinKey, syncMode);
    if (!res.ok) {
      this.store.set({ status: 'idle' });
      return res;
    }
    await this.start(res.data, slug, syncMode);
    return res;
  }

  /** Takes over an existing engine session, as the extension panel does after a handover. */
  async resume(input: { roomId: string; slug: string; engineSession: string; syncMode: SyncMode }): Promise<Result<null>> {
    this.store.set({ status: 'joining', syncMode: input.syncMode });
    this.roomId = input.roomId;
    this.slug = input.slug;
    this.engineSession = input.engineSession;
    const touch = await this.api.touchMember(input.roomId, input.engineSession, false, input.syncMode);
    if (!touch.ok) {
      this.handleTouchFailure(touch.code);
      return { ok: false, code: touch.code };
    }
    const room = await this.fetchRoom();
    if (!room) return { ok: false, code: 'not_member' };
    await this.start(
      {
        room,
        playback_state: (await this.fetchPlayback()) as PlaybackStateRow,
        channel_epoch: room.channel_epoch,
        engine_session: input.engineSession,
      },
      input.slug,
      input.syncMode,
    );
    return { ok: true, data: null };
  }

  private async start(join: JoinResult, slug: string, syncMode: SyncMode): Promise<void> {
    this.roomId = join.room.id;
    this.slug = slug;
    this.engineSession = join.engine_session;
    this.epoch = join.channel_epoch;
    this.store.set({ room: join.room, syncMode });

    await Promise.allSettled([this.clock.sync()]);
    // Subscribe to both topics before fetching playback state, then apply rows by increasing seq.
    await this.subscribe(this.epoch);
    this.applyPlayback(join.playback_state);
    const fresh = await this.fetchPlayback();
    if (fresh) this.applyPlayback(fresh);
    await Promise.allSettled([this.refreshMembers(), this.loadMessages()]);
    this.store.set({ status: 'live' });
    this.startLoops();
    this.watchConnectivity();
  }

  // Engine ----------------------------------------------------------------------------------------

  /** Connects a player. The room page attaches its YouTube adapter's host once the player loads. */
  attachEngine(host: EngineHost): void {
    this.detachEngine();
    this.host = host;
    const playback = this.store.get().playback;
    if (playback) host.applyState(playback);
    this.hostUnsubs.push(
      host.onView((view) => this.store.set({ engine: view })),
      host.onUserAction((action) => void this.handleUserAction(action)),
      host.onBuffering((buffering) => {
        this.buffering = buffering;
        // Members report buffering immediately, besides the 20 second refresh.
        void this.touch();
      }),
      host.onEnded(() => void this.handleEnded()),
    );
  }

  detachEngine(): void {
    for (const off of this.hostUnsubs) off();
    this.hostUnsubs = [];
    this.host = null;
    this.store.set({ engine: null });
  }

  get engineHost(): EngineHost | null {
    return this.host;
  }

  /** Where the room says everyone should be now, in seconds. */
  expectedPosition(): number {
    const playback = this.store.get().playback;
    return playback ? expectedPosition(playback, this.clock.now()) : 0;
  }

  /** This member's own position: the player's when there is one, otherwise the expected one. */
  currentPosition(): number {
    return this.host ? this.host.getPosition() : this.expectedPosition();
  }

  isController(): boolean {
    const room = this.store.get().room;
    if (!room) return false;
    return room.control_mode === 'everyone' || room.host_id === this.me.id;
  }

  isHost(): boolean {
    return this.store.get().room?.host_id === this.me.id;
  }

  private async handleUserAction(action: UserAction): Promise<void> {
    if (!this.isController()) {
      // The engine restores the expected state on its next tick.
      this.notify({ message: 'Only the host controls playback.', tone: 'info', code: 'not_controller' });
      return;
    }
    const playback = this.store.get().playback;
    if (!playback) return;
    let status: PlaybackStatus;
    if (action.kind === 'play') status = 'playing';
    else if (action.kind === 'pause') status = 'paused';
    else status = playback.status === 'playing' ? 'playing' : 'paused';
    this.host?.holdForLocalAction();
    await this.sendPlayback(status, action.position, action.kind === 'play' ? this.playDelay() : 0, 'user');
  }

  /** Plays in paid source rooms start after a 3, 2, 1 countdown so cue sync members can start too. */
  private playDelay(): number {
    const room = this.store.get().room;
    return room && isPaidSource(room.source) ? COUNTDOWN_MS : 0;
  }

  private async sendPlayback(
    status: PlaybackStatus,
    positionSec: number,
    startDelayMs: number,
    reason: 'user' | 'buffer' | 'ended',
  ): Promise<boolean> {
    const playback = this.store.get().playback;
    if (!this.roomId || !playback) return false;
    const res = await this.api.setPlayback({
      roomId: this.roomId,
      expectedSeq: this.lastSeq,
      status,
      positionSec,
      rate: playback.rate,
      startDelayMs,
      reason,
    });
    if (res.ok) {
      this.applyPlayback(res.data);
      return true;
    }
    if (res.code === 'stale_seq') {
      // Someone else changed playback first: take their row and drop this action.
      const row = PlaybackStateRow.safeParse(res.data);
      if (row.success) this.applyPlayback(row.data);
      return false;
    }
    if (res.code !== 'not_elected') this.notify({ message: '', tone: 'error', code: res.code });
    return false;
  }

  /** Cue controls for a controller without a player: play (with countdown), pause, jump to. */
  async cuePlay(): Promise<void> {
    await this.sendPlayback('playing', this.expectedPosition(), this.playDelay(), 'user');
  }

  async cuePause(): Promise<void> {
    await this.sendPlayback('paused', this.expectedPosition(), 0, 'user');
  }

  async cueJumpTo(sec: number): Promise<void> {
    const playback = this.store.get().playback;
    const status = playback?.status === 'playing' ? 'playing' : 'paused';
    await this.sendPlayback(status, sec, status === 'playing' ? this.playDelay() : 0, 'user');
  }

  async cueReady(): Promise<Result<unknown>> {
    if (!this.roomId) return { ok: false, code: 'not_member' };
    const res = await this.api.postSystem(this.roomId, 'cue_ready');
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
    return res;
  }

  private async handleEnded(): Promise<void> {
    const state = this.store.get();
    const room = state.room;
    if (!room || !this.host) return;
    const hostMember = state.members.find((m) => m.user_id === room.host_id);
    const hostOnCue = !hostMember || hostMember.sync_mode === 'cue' || !hostMember.present;
    if (this.isHost() || (hostOnCue && state.electedId === this.me.id)) {
      await this.sendPlayback('ended', this.host.getDuration() ?? this.host.getPosition(), 0, 'ended');
    }
  }

  private applyPlayback(row: PlaybackStateRow): void {
    if (row.seq <= this.lastSeq) return;
    this.lastSeq = row.seq;
    this.store.set({ playback: row });
    this.host?.applyState(row);
  }

  // Realtime --------------------------------------------------------------------------------------

  private topic(epoch: number, kind: 'server' | 'client'): string {
    return `room:${this.roomId}:${epoch}:${kind}`;
  }

  private async subscribe(epoch: number): Promise<void> {
    await this.unsubscribe();
    await this.supabase.realtime.setAuth();
    const server = this.supabase.channel(this.topic(epoch, 'server'), { config: { private: true } });
    server
      .on('broadcast', { event: 'state' }, ({ payload }) => {
        const row = parseEvent(ServerEvents.state, payload, this.logDrop);
        if (row) this.applyPlayback(row);
      })
      .on('broadcast', { event: 'room' }, ({ payload }) => {
        const room = parseEvent(ServerEvents.room, payload, this.logDrop);
        if (room) this.applyRoom(room);
      })
      .on('broadcast', { event: 'members' }, ({ payload }) => {
        const member = parseEvent(ServerEvents.members, payload, this.logDrop);
        if (member) this.applyMember(member);
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const message = parseEvent(ServerEvents.chat, payload, this.logDrop);
        if (message) this.applyMessage(message);
      })
      .on('broadcast', { event: 'moderation' }, ({ payload }) => {
        const event = parseEvent(ServerEvents.moderation, payload, this.logDrop);
        if (event) this.applyModeration(event);
      });

    const client = this.supabase.channel(this.topic(epoch, 'client'), {
      config: { private: true, presence: { key: this.me.id }, broadcast: { self: false } },
    });
    client
      .on('broadcast', { event: 'heartbeat' }, ({ payload }) => {
        const beat = parseEvent(ClientEvents.heartbeat, payload, this.logDrop);
        // A higher seq than the last applied means a `state` event was missed.
        if (beat && beat.seq > this.lastSeq) void this.refetchPlayback();
      })
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        const reaction = parseEvent(ClientEvents.reaction, payload, this.logDrop);
        if (reaction) this.showReaction(reaction.emoji, reaction.from);
      })
      .on('broadcast', { event: 'rtc' }, ({ payload }) => {
        const event = parseEvent(ClientEvents.rtc, payload, this.logDrop);
        if (!event || event.from === this.me.id) return;
        if (event.to !== null && event.to !== this.me.id) return;
        for (const cb of this.rtcListeners) cb(event);
      })
      .on('presence', { event: 'sync' }, () => this.applyPresence(client));

    this.serverChannel = server;
    this.clientChannel = client;
    await Promise.all([this.subscribeChannel(server), this.subscribeChannel(client)]);
    await this.trackPresence();
  }

  private subscribeChannel(channel: RealtimeChannel): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (!settled) {
            settled = true;
            reject(new Error(status));
            return;
          }
          if (channel === this.serverChannel || channel === this.clientChannel) this.scheduleReconnect();
        }
      });
    });
  }

  private async unsubscribe(): Promise<void> {
    const channels = [this.serverChannel, this.clientChannel].filter(Boolean) as RealtimeChannel[];
    this.serverChannel = null;
    this.clientChannel = null;
    await Promise.allSettled(channels.map((c) => this.supabase.removeChannel(c)));
  }

  private async trackPresence(): Promise<void> {
    if (!this.clientChannel) return;
    const state = this.store.get();
    const payload: PresencePayload = {
      user_id: this.me.id,
      display_name: this.me.name,
      device: this.opts.device,
      sync_mode: state.syncMode,
      voice: state.voice,
      engine: this.opts.engine,
    };
    try {
      await this.clientChannel.track(payload);
    } catch {
      // Presence is for display only; the next reconnect tracks again.
    }
  }

  private applyPresence(channel: RealtimeChannel): void {
    const raw = channel.presenceState() as Record<string, unknown[]>;
    const next = new Map<string, PresencePayload>();
    for (const entries of Object.values(raw)) {
      const latest = entries[entries.length - 1];
      const parsed = PresencePayload.safeParse(latest);
      if (parsed.success) next.set(parsed.data.user_id, parsed.data);
    }
    this.presence = next;
    this.store.set({ presence: [...next.values()] });
    this.publishMembers();
  }

  private applyRoom(room: RoomRow): void {
    const previous = this.store.get().room;
    this.store.set({ room });
    if (room.status === 'closed') {
      this.fail('closed');
      return;
    }
    if (previous && previous.host_id !== room.host_id) void this.refreshMembers();
  }

  private applyMember(row: MemberRow): void {
    if (row.user_id === this.me.id && (row.state === 'removed' || row.state === 'banned')) {
      this.fail(row.state);
      return;
    }
    this.memberRows.set(row.user_id, row);
    if (!this.profiles.has(row.user_id)) void this.loadProfiles([row.user_id]);
    this.publishMembers();
  }

  private applyMessage(message: MessageRow): void {
    const messages = this.store.get().messages.filter((m) => m.id !== message.id);
    if (!message.deleted_at) {
      messages.push(message);
      messages.sort(byCreatedAt);
      if (message.user_id && !this.profiles.has(message.user_id)) void this.loadProfiles([message.user_id]);
    }
    this.store.set({ messages });
  }

  private applyModeration(event: ModerationEvent): void {
    for (const cb of this.moderationListeners) cb(event);
    if (event.target === this.me.id && (event.action === 'remove' || event.action === 'ban')) {
      this.fail(event.action === 'ban' ? 'banned' : 'removed');
      return;
    }
    if ((event.action === 'remove' || event.action === 'ban') && event.new_epoch > this.epoch) {
      // Remaining members move to the new topics; the removed member cannot join them.
      this.epoch = event.new_epoch;
      void this.subscribe(this.epoch).catch(() => this.scheduleReconnect());
    }
    void this.refreshMembers();
  }

  private readonly logDrop = (message: string, detail: unknown) => this.opts.log?.(message, detail);

  // Data ------------------------------------------------------------------------------------------

  private async fetchRoom(): Promise<RoomRow | null> {
    if (!this.roomId) return null;
    const { data } = await this.supabase.from('room_view').select('*').eq('id', this.roomId).maybeSingle();
    const parsed = RoomRow.safeParse(data);
    return parsed.success ? parsed.data : null;
  }

  private async fetchPlayback(): Promise<PlaybackStateRow | null> {
    if (!this.roomId) return null;
    const { data } = await this.supabase.from('playback_state').select('*').eq('room_id', this.roomId).maybeSingle();
    const parsed = PlaybackStateRow.safeParse(data);
    return parsed.success ? parsed.data : null;
  }

  private async refetchPlayback(): Promise<void> {
    const row = await this.fetchPlayback();
    if (row) this.applyPlayback(row);
  }

  async refreshMembers(): Promise<void> {
    if (!this.roomId) return;
    const { data } = await this.supabase.from('room_members').select('*').eq('room_id', this.roomId);
    if (!Array.isArray(data)) return;
    const rows = new Map<string, MemberRow>();
    for (const raw of data) {
      const parsed = MemberRow.safeParse(raw);
      if (parsed.success) rows.set(parsed.data.user_id, parsed.data);
    }
    this.memberRows = rows;
    const missing = [...rows.keys()].filter((id) => !this.profiles.has(id));
    if (missing.length) await this.loadProfiles(missing);
    this.publishMembers();
  }

  private async loadProfiles(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) return;
    const { data } = await this.supabase.from('profile_public').select('id, display_name, avatar_url').in('id', unique);
    for (const raw of data ?? []) {
      const parsed = ProfilePublic.safeParse(raw);
      if (parsed.success) this.profiles.set(parsed.data.id, parsed.data);
    }
    this.publishMembers();
  }

  /** The display name for a user id, or "Deleted user" when the account is gone. */
  nameOf(userId: string | null): string {
    if (!userId) return 'Deleted user';
    if (userId === this.me.id) return this.me.name;
    return this.profiles.get(userId)?.display_name ?? this.presence.get(userId)?.display_name ?? 'Someone';
  }

  avatarOf(userId: string | null): string | null {
    if (!userId) return null;
    if (userId === this.me.id) return this.me.avatarUrl;
    return this.profiles.get(userId)?.avatar_url ?? null;
  }

  private publishMembers(): void {
    const now = this.clock.now();
    const members: MemberView[] = [...this.memberRows.values()]
      .filter((m) => m.state !== 'left' || this.presence.has(m.user_id))
      .map((m) => ({
        ...m,
        name: this.nameOf(m.user_id),
        avatar_url: this.avatarOf(m.user_id),
        present: isPresent(m, now),
        presence: this.presence.get(m.user_id) ?? null,
      }))
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'host' ? -1 : 1;
        return Date.parse(a.first_joined_at) - Date.parse(b.first_joined_at);
      });
    const elected = electedMember(members, now);
    this.store.set({ members, electedId: elected?.user_id ?? null });
  }

  private async loadMessages(): Promise<void> {
    if (!this.roomId) return;
    const { data } = await this.supabase
      .from('messages')
      .select('*')
      .eq('room_id', this.roomId)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_PAGE);
    const messages = this.parseMessages(data).sort(byCreatedAt);
    this.store.set({ messages, hasOlder: messages.length === MESSAGE_PAGE });
    await this.loadProfiles(messages.map((m) => m.user_id).filter((id): id is string => Boolean(id)));
  }

  /** Loads the previous page of messages, for scrolling up. */
  async loadOlder(): Promise<void> {
    const state = this.store.get();
    if (!this.roomId || state.loadingOlder || !state.hasOlder) return;
    const oldest = state.messages[0];
    if (!oldest) return;
    this.store.set({ loadingOlder: true });
    const { data } = await this.supabase
      .from('messages')
      .select('*')
      .eq('room_id', this.roomId)
      .lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_PAGE);
    const older = this.parseMessages(data);
    const known = new Set(state.messages.map((m) => m.id));
    const merged = [...older.filter((m) => !known.has(m.id)), ...this.store.get().messages].sort(byCreatedAt);
    this.store.set({ messages: merged, hasOlder: older.length === MESSAGE_PAGE, loadingOlder: false });
    await this.loadProfiles(older.map((m) => m.user_id).filter((id): id is string => Boolean(id)));
  }

  private async loadNewerMessages(): Promise<void> {
    if (!this.roomId) return;
    const messages = this.store.get().messages;
    const newest = messages[messages.length - 1];
    if (!newest) {
      await this.loadMessages();
      return;
    }
    const { data } = await this.supabase
      .from('messages')
      .select('*')
      .eq('room_id', this.roomId)
      .gt('created_at', newest.created_at)
      .order('created_at', { ascending: true })
      .limit(MESSAGE_PAGE);
    for (const message of this.parseMessages(data)) this.applyMessage(message);
  }

  private parseMessages(data: unknown): MessageRow[] {
    if (!Array.isArray(data)) return [];
    return data.flatMap((raw) => {
      const parsed = MessageRow.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    });
  }

  // Timers ----------------------------------------------------------------------------------------

  private startLoops(): void {
    const ticker = this.opts.createTicker ?? defaultTicker;
    this.stops.push(
      ticker(TOUCH_INTERVAL_MS, () => void this.touch().then(() => this.refreshMembers())),
      ticker(CLOCK_RESYNC_MS, () => void this.clock.sync().catch(() => undefined)),
      defaultTicker(HEARTBEAT_INTERVAL_MS, () => this.sendHeartbeat()),
      defaultTicker(WAIT_CHECK_MS, () => void this.waitForEveryone()),
      defaultTicker(POSITION_POLL_MS, () => this.pollPosition()),
    );
  }

  private async touch(): Promise<void> {
    const state = this.store.get();
    if (!this.roomId || !this.engineSession || state.status === 'fatal') return;
    const res = await this.api.touchMember(this.roomId, this.engineSession, this.buffering, state.syncMode);
    if (!res.ok) this.handleTouchFailure(res.code);
  }

  private handleTouchFailure(code: ErrorCode, retry = true): void {
    switch (code) {
      case 'removed':
      case 'banned':
      case 'closed':
      case 'replaced':
      case 'not_member':
      case 'room_full':
        this.fail(code);
        break;
      default:
        if (retry) this.scheduleReconnect();
    }
  }

  private sendHeartbeat(): void {
    const state = this.store.get();
    if (!this.clientChannel || !this.host || state.electedId !== this.me.id) return;
    if (state.playback?.status !== 'playing') return;
    void this.clientChannel.send({
      type: 'broadcast',
      event: 'heartbeat',
      payload: { seq: this.lastSeq, observed_position: this.host.getPosition(), observed_server_ms: this.clock.now() },
    });
  }

  /** Wait for everyone, run only by the elected member while the room has it on. */
  private async waitForEveryone(): Promise<void> {
    const state = this.store.get();
    const { room, playback } = state;
    if (!this.roomId || !room?.wait_for_everyone || !playback || state.electedId !== this.me.id) return;
    const watching = playback.status === 'playing' || (playback.status === 'paused' && playback.paused_reason === 'buffer');
    if (!watching) return;
    await this.refreshMembers();
    const decision = this.waiter.decide({
      waitForEveryone: room.wait_for_everyone,
      status: playback.status,
      pausedReason: playback.paused_reason,
      members: this.store.get().members,
      serverNow: this.clock.now(),
    });
    if (decision.action === 'pause') {
      const paused = await this.sendPlayback('paused', this.expectedPosition(), 0, 'buffer');
      if (paused) void this.api.postSystem(this.roomId, 'waiting_for');
    } else if (decision.action === 'resume') {
      await this.sendPlayback('playing', playback.position_sec, 0, 'buffer');
    }
  }

  /** Shows timed comments as playback passes them. */
  private pollPosition(): void {
    const state = this.store.get();
    if (state.status !== 'live' || !state.playback) return;
    const position = this.currentPosition();
    const previous = this.lastPolledPosition;
    this.lastPolledPosition = position;
    if (previous === null) return;
    const timed = state.messages.filter((m) => m.kind === 'timed');
    const passed = passedComments(previous, position, timed);
    if (!passed.length) return;
    const popups = [
      ...state.popups,
      ...passed.map((m) => ({ id: m.id, body: m.body, userId: m.user_id, position: m.position_sec ?? 0 })),
    ];
    this.store.set({ popups });
    for (const m of passed) {
      setTimeout(() => this.store.set((s) => ({ popups: s.popups.filter((p) => p.id !== m.id) })), TIMED_VISIBLE_MS);
    }
  }

  // Reconnection ----------------------------------------------------------------------------------

  private watchConnectivity(): void {
    if (typeof window === 'undefined') return;
    const online = () => {
      this.store.set({ online: true });
      this.scheduleReconnect();
    };
    const offline = () => this.store.set({ online: false });
    const visible = () => {
      if (document.visibilityState === 'visible') this.scheduleReconnect();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    const { data } = this.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) void this.supabase.realtime.setAuth(session.access_token);
    });
    this.stops.push(() => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
      data.subscription.unsubscribe();
    });
  }

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  scheduleReconnect(delayMs = 500): void {
    if (this.destroyed || this.store.get().status === 'fatal') return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delayMs);
  }

  /** Refresh the session, touch, refetch room, state and messages, re-track presence, resume. */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.destroyed || !this.roomId) return;
    this.reconnecting = true;
    this.store.set({ status: 'reconnecting' });
    try {
      await this.supabase.auth.getSession();
      await this.supabase.realtime.setAuth();
      const res = await this.api.touchMember(this.roomId, this.engineSession ?? '', this.buffering, this.store.get().syncMode);
      if (!res.ok) {
        this.handleTouchFailure(res.code, false);
        if (this.store.get().status === 'fatal') return;
        throw new Error(res.code);
      }
      const room = await this.fetchRoom();
      if (room) {
        this.applyRoom(room);
        if (this.store.get().status === 'fatal') return;
        const channelsHealthy =
          this.serverChannel?.state === 'joined' && this.clientChannel?.state === 'joined' && room.channel_epoch === this.epoch;
        this.epoch = room.channel_epoch;
        if (!channelsHealthy) await this.subscribe(this.epoch);
        else await this.trackPresence();
      }
      await Promise.allSettled([this.refetchPlayback(), this.loadNewerMessages(), this.refreshMembers(), this.clock.sync()]);
      this.host?.resync();
      this.store.set({ status: 'live' });
    } catch {
      this.store.set({ status: 'reconnecting' });
      this.reconnecting = false;
      this.scheduleReconnect(3000);
      return;
    }
    this.reconnecting = false;
  }

  // Actions ---------------------------------------------------------------------------------------

  async sendChat(body: string, pinned: boolean): Promise<Result<unknown>> {
    if (!this.roomId) return { ok: false, code: 'not_member' };
    const text = body.trim();
    if (!text) return { ok: false, code: 'invalid_input' };
    const res = await this.api.sendChat(this.roomId, text.slice(0, 1000), pinned ? this.currentPosition() : null);
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
    return res;
  }

  async deleteMessage(messageId: string): Promise<void> {
    const res = await this.api.deleteMessage(messageId);
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
  }

  react(emoji: ReactionEmoji): void {
    if (!this.clientChannel) return;
    if (!this.showReaction(emoji, this.me.id)) return;
    void this.clientChannel.send({
      type: 'broadcast',
      event: 'reaction',
      payload: { from: this.me.id, emoji, position_sec: Math.max(0, this.currentPosition()) },
    });
  }

  private showReaction(emoji: ReactionEmoji, from: string): boolean {
    if (!this.reactionLimiter.allow(from, Date.now())) return false;
    const reaction: FloatingReaction = {
      id: this.reactionId++,
      emoji,
      userId: from,
      x: 0.08 + Math.random() * 0.84,
      drift: Math.round((Math.random() - 0.5) * 32),
    };
    this.store.set((s) => ({ reactions: [...s.reactions.slice(-24), reaction] }));
    setTimeout(() => this.store.set((s) => ({ reactions: s.reactions.filter((r) => r.id !== reaction.id) })), REACTION_VISIBLE_MS);
    return true;
  }

  async updateSettings(settings: RoomSettings): Promise<boolean> {
    if (!this.roomId) return false;
    const res = await this.api.updateRoomSettings(this.roomId, settings);
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
    return res.ok;
  }

  async setSource(source: Source, contentRef: string): Promise<boolean> {
    if (!this.roomId) return false;
    const res = await this.api.setSource(this.roomId, source, contentRef);
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
    else await this.refetchPlayback();
    return res.ok;
  }

  async closeRoom(): Promise<boolean> {
    if (!this.roomId) return false;
    const res = await this.api.closeRoom(this.roomId);
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
    return res.ok;
  }

  async transferHost(userId: string): Promise<boolean> {
    if (!this.roomId) return false;
    const res = await this.api.transferHost(this.roomId, userId);
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
    return res.ok;
  }

  async moderate(userId: string, action: ModerationAction): Promise<boolean> {
    if (!this.roomId) return false;
    const res = await this.api.moderate(this.roomId, userId, action);
    if (!res.ok) {
      this.notify({ message: '', tone: 'error', code: res.code });
      // voice_sync_failed still means the database change stands.
      if (res.code !== 'voice_sync_failed') return false;
    }
    await this.refreshMembers();
    return true;
  }

  async roomLink(): Promise<string | null> {
    if (!this.roomId) return null;
    const res = await this.api.getRoomLink(this.roomId);
    if (!res.ok) {
      this.notify({ message: '', tone: 'error', code: res.code });
      return null;
    }
    return res.data.room_link;
  }

  async rotateKey(): Promise<boolean> {
    if (!this.roomId) return false;
    const res = await this.api.rotateJoinKey(this.roomId);
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
    return res.ok;
  }

  async report(input: { targetUserId: string; messageId: string | null; reason: ReportReason; note: string }): Promise<boolean> {
    if (!this.roomId) return false;
    const res = await this.api.report({ roomId: this.roomId, reporterId: this.me.id, ...input });
    if (!res.ok) this.notify({ message: '', tone: 'error', code: res.code });
    return res.ok;
  }

  async leave(): Promise<void> {
    if (this.roomId) await this.api.leaveRoom(this.roomId);
    this.fail('left');
  }

  /** Stops this context acting for the member so another context (the extension) can take over. */
  async handOver(): Promise<{ roomId: string; slug: string; engineSession: string } | null> {
    const session = this.session;
    if (!session) return null;
    this.store.set({ status: 'fatal', fatal: 'handed_over' });
    await this.teardown();
    return session;
  }

  // Voice wiring -----------------------------------------------------------------------------------

  sendRtc(event: RtcEvent): void {
    void this.clientChannel?.send({ type: 'broadcast', event: 'rtc', payload: event });
  }

  onRtc(cb: (event: RtcEvent) => void): () => void {
    this.rtcListeners.add(cb);
    return () => this.rtcListeners.delete(cb);
  }

  onModeration(cb: (event: ModerationEvent) => void): () => void {
    this.moderationListeners.add(cb);
    return () => this.moderationListeners.delete(cb);
  }

  setVoicePresence(voice: VoicePresence): void {
    this.store.set({ voice });
    void this.trackPresence();
  }

  setSyncMode(syncMode: SyncMode): void {
    this.store.set({ syncMode });
    void this.trackPresence();
    void this.touch();
  }

  // Lifecycle --------------------------------------------------------------------------------------

  onNotice(cb: (notice: Notice) => void): () => void {
    this.noticeListeners.add(cb);
    return () => this.noticeListeners.delete(cb);
  }

  private notify(notice: Notice): void {
    for (const cb of this.noticeListeners) cb(notice);
  }

  private fail(kind: FatalKind): void {
    if (this.store.get().status === 'fatal' && this.store.get().fatal) return;
    this.store.set({ status: 'fatal', fatal: kind });
    void this.teardown();
  }

  private async teardown(): Promise<void> {
    for (const stop of this.stops) stop();
    this.stops = [];
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.detachEngine();
    try {
      await this.clientChannel?.untrack();
    } catch {
      // The channel may already be gone.
    }
    await this.unsubscribe();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.teardown();
    this.noticeListeners.clear();
    this.rtcListeners.clear();
    this.moderationListeners.clear();
  }
}
