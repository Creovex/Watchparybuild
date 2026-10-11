import {
  HandoverMessage,
  isPaidSource,
  PageToExtension,
  parsePaidRef,
  ReclaimMessage,
  type ExtensionReply,
  type PaidSource,
  type ReturnMessage,
} from '@watchparty/sync-core';
import { authKey, roomKey, tabKey, tokensKey } from '../shared/keys';
import { isWatchPage } from '../shared/services';

export { authKey, roomKey, tabKey, tokensKey };

// The service worker's handover logic, with every chrome API injected so it can be unit tested.
//
// The room page hands the member's session to the extension ("Open in Netflix"). Only one holder may
// refresh a Supabase session, because Supabase revokes a refresh token used twice, so the session
// lives in exactly one place at a time: the room page, or the panel in the streaming tab. It goes
// back to the room page when the page asks ("Bring it back here"), when the panel gives it up, or
// when the streaming tab closes while the room page is open. Otherwise it is dropped and the member
// stops being present after 60 seconds.

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

/** What the worker keeps per room in `chrome.storage.session`, which the browser clears on exit. */
export interface RoomRecord {
  room_id: string;
  slug: string;
  source: PaidSource;
  content_ref: string;
  engine_session: string;
  session: SessionTokens;
  /** The streaming tab holding the room, once it is open. */
  tab_id: number | null;
  /** True once the panel gave the session up; it goes to the room page as soon as one connects. */
  released: boolean;
}

export interface KeyValueStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface MessagePort {
  postMessage(message: unknown): void;
}

export interface WorkerDeps {
  store: KeyValueStore;
  /** Opens a tab and returns its id, or null when it could not. */
  openTab(url: string): Promise<number | null>;
  /** Tells an open tab which room it holds (the content script and the panel, when connected). */
  notifyBinding(tabId: number, roomId: string | null): void;
  /** Sends `stop` to the panel in a tab; false when no panel is connected there. */
  sendStop(tabId: number, reason: 'reclaimed' | 'replaced'): boolean;
  version: string;
  allowedOrigins: readonly string[];
  stopTimeoutMs?: number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  log?: (message: string, detail?: unknown) => void;
}

const DEFAULT_STOP_TIMEOUT_MS = 4000;

function isTokens(value: unknown): value is SessionTokens {
  const v = value as Partial<SessionTokens> | null;
  return Boolean(v && typeof v.access_token === 'string' && typeof v.refresh_token === 'string');
}

export class WorkerCore {
  private readonly roomPorts = new Map<string, Set<MessagePort>>();
  private readonly pendingStops = new Map<string, () => void>();

  constructor(private readonly deps: WorkerDeps) {}

  // Messages from the room page ---------------------------------------------------------------------

  /** Handles `chrome.runtime.onMessageExternal`: ping, handover, and reclaim sent as a message. */
  async handleExternal(raw: unknown, origin: string | undefined): Promise<ExtensionReply> {
    if (!origin || !this.deps.allowedOrigins.includes(origin)) {
      return { type: 'handover_refused', reason: 'origin_not_allowed' };
    }
    const parsed = PageToExtension.safeParse(raw);
    if (!parsed.success) return { type: 'handover_refused', reason: 'invalid_message' };
    const message = parsed.data;
    if (message.type === 'ping') return { type: 'pong', version: this.deps.version };
    if (message.type === 'reclaim') {
      const returned = await this.reclaim(message.room_id);
      return returned ?? { type: 'handover_refused', reason: 'no_session' };
    }
    return this.handover(message);
  }

  private async handover(message: HandoverMessage): Promise<ExtensionReply> {
    if (!isPaidSource(message.source)) return { type: 'handover_refused', reason: 'unsupported_source' };
    const ref = parsePaidRef(message.source, message.content_ref);
    if (!ref.ok) return { type: 'handover_refused', reason: 'invalid_content_ref' };
    if (!isWatchPage(ref.ref)) return { type: 'handover_refused', reason: 'not_a_watch_page' };

    // A second handover for the same room supersedes the first: the old panel stops acting.
    const existing = await this.getRecord(message.room_id);
    if (existing?.tab_id != null) {
      await this.stopPanel(existing.tab_id, message.room_id, 'replaced');
      await this.deps.store.remove([tabKey(existing.tab_id)]);
    }

    const record: RoomRecord = {
      room_id: message.room_id,
      slug: message.slug,
      source: message.source,
      content_ref: ref.ref,
      engine_session: message.engine_session,
      session: message.session,
      tab_id: null,
      released: false,
    };
    // Supabase storage from an earlier handover would hold an older token pair; start clean.
    await this.deps.store.remove([authKey(record.room_id)]);
    await this.deps.store.set({ [roomKey(record.room_id)]: record, [tokensKey(record.room_id)]: message.session });

    const tabId = await this.deps.openTab(ref.ref);
    if (tabId === null) {
      await this.forget(record);
      return { type: 'handover_refused', reason: 'tab_failed' };
    }
    record.tab_id = tabId;
    await this.deps.store.set({ [roomKey(record.room_id)]: record, [tabKey(tabId)]: record.room_id });
    this.deps.notifyBinding(tabId, record.room_id);
    return { type: 'handover_ok' };
  }

  /**
   * Gives the session back to the room page: the panel stops (token refresh, voice, presence,
   * touch timer) and writes its last tokens, then the worker forgets the session.
   */
  async reclaim(roomId: string): Promise<ReturnMessage | null> {
    const record = await this.getRecord(roomId);
    if (!record) return null;
    if (record.tab_id !== null) await this.stopPanel(record.tab_id, roomId, 'reclaimed');
    const session = await this.latestTokens(record);
    await this.forget(record);
    return { type: 'return', room_id: roomId, session };
  }

  // Room page ports ---------------------------------------------------------------------------------

  /** A room page opened `room-page:<roomId>`. If the panel already gave the session up, return it now. */
  async addRoomPagePort(roomId: string, port: MessagePort): Promise<void> {
    const ports = this.roomPorts.get(roomId) ?? new Set<MessagePort>();
    ports.add(port);
    this.roomPorts.set(roomId, ports);
    const record = await this.getRecord(roomId);
    if (record?.released) await this.returnToPage(record);
  }

  removeRoomPagePort(roomId: string, port: MessagePort): void {
    const ports = this.roomPorts.get(roomId);
    if (!ports) return;
    ports.delete(port);
    if (ports.size === 0) this.roomPorts.delete(roomId);
  }

  hasRoomPagePort(roomId: string): boolean {
    return (this.roomPorts.get(roomId)?.size ?? 0) > 0;
  }

  /** A message on a room page port: only `reclaim` for that port's own room is accepted. */
  async handleRoomPageMessage(roomId: string, port: MessagePort, raw: unknown): Promise<void> {
    const parsed = ReclaimMessage.safeParse(raw);
    if (!parsed.success || parsed.data.room_id !== roomId) {
      this.deps.log?.('dropped room page message', raw);
      return;
    }
    const returned = await this.reclaim(roomId);
    if (returned) safePost(port, returned);
  }

  // Tabs and panels ---------------------------------------------------------------------------------

  /** The room a tab holds, or null. */
  async bindingFor(tabId: number): Promise<string | null> {
    const key = tabKey(tabId);
    const roomId = (await this.deps.store.get([key]))[key];
    if (typeof roomId !== 'string') return null;
    const record = await this.getRecord(roomId);
    return record && record.tab_id === tabId ? roomId : null;
  }

  /** The streaming tab closed: return the session to an open room page, or drop it. */
  async onTabRemoved(tabId: number): Promise<void> {
    const roomId = await this.bindingFor(tabId);
    if (!roomId) {
      await this.deps.store.remove([tabKey(tabId)]);
      return;
    }
    const record = await this.getRecord(roomId);
    if (!record) return;
    if (this.hasRoomPagePort(roomId)) {
      await this.returnToPage(record);
    } else {
      await this.forget(record);
    }
  }

  async handlePanelMessage(message: { type: 'stopped' | 'release'; room_id: string }, tabId: number): Promise<void> {
    if (message.type === 'stopped') {
      this.pendingStops.get(message.room_id)?.();
      return;
    }
    const record = await this.getRecord(message.room_id);
    if (!record || record.tab_id !== tabId) return;
    record.released = true;
    await this.deps.store.set({ [roomKey(record.room_id)]: record });
    if (this.hasRoomPagePort(record.room_id)) await this.returnToPage(record);
  }

  // Internals ----------------------------------------------------------------------------------------

  private stopPanel(tabId: number, roomId: string, reason: 'reclaimed' | 'replaced'): Promise<boolean> {
    if (!this.deps.sendStop(tabId, reason)) return Promise.resolve(false);
    const schedule = this.deps.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
    return new Promise((resolve) => {
      const finish = (answered: boolean) => {
        if (this.pendingStops.get(roomId) !== done) return;
        this.pendingStops.delete(roomId);
        resolve(answered);
      };
      const done = () => finish(true);
      this.pendingStops.set(roomId, done);
      schedule(() => finish(false), this.deps.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
    });
  }

  private async returnToPage(record: RoomRecord): Promise<void> {
    const session = await this.latestTokens(record);
    const message: ReturnMessage = { type: 'return', room_id: record.room_id, session };
    for (const port of this.roomPorts.get(record.room_id) ?? []) safePost(port, message);
    await this.forget(record);
  }

  /** The newest token pair: what the panel last wrote, else what the room page handed over. */
  private async latestTokens(record: RoomRecord): Promise<SessionTokens> {
    const key = tokensKey(record.room_id);
    const stored = (await this.deps.store.get([key]))[key];
    return isTokens(stored) ? { access_token: stored.access_token, refresh_token: stored.refresh_token } : record.session;
  }

  private async getRecord(roomId: string): Promise<RoomRecord | null> {
    const key = roomKey(roomId);
    const value = (await this.deps.store.get([key]))[key] as RoomRecord | undefined;
    return value && typeof value === 'object' && value.room_id === roomId ? value : null;
  }

  private async forget(record: RoomRecord): Promise<void> {
    const keys = [roomKey(record.room_id), tokensKey(record.room_id), authKey(record.room_id)];
    if (record.tab_id !== null) keys.push(tabKey(record.tab_id));
    await this.deps.store.remove(keys);
  }
}

function safePost(port: MessagePort, message: unknown): void {
  try {
    port.postMessage(message);
  } catch {
    // The page closed between the check and the send.
  }
}
