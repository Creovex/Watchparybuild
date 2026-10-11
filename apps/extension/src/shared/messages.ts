import { z } from 'zod';
import { PlaybackStateRow, ReactionEmoji } from '@watchparty/sync-core';

// Every message on the extension's internal ports. The content script and the panel each open a
// port to the service worker, which pairs them by tab and relays between them. Receivers validate
// with these schemas and drop anything that does not match: the content script lives inside the
// streaming page, so nothing it sends is trusted without a check.

export const PORT_CONTENT = 'content';
export const PORT_PANEL = 'panel';
export const ROOM_PAGE_PREFIX = 'room-page:';

const Id = z.guid();
const Capabilities = z.object({
  fineRate: z.boolean(),
  volume: z.boolean(),
  seek: z.boolean(),
  seekLatencySec: z.number().nonnegative(),
});
const PaidSourceSchema = z.enum(['netflix', 'prime', 'disney']);
const Level = z.number().min(0).max(1);

export const EngineViewSchema = z.object({
  mode: z.enum(['idle', 'countdown', 'playing', 'paused', 'ended', 'blocked', 'cant_keep_up']),
  seq: z.number().int(),
  expected: z.number().nullable(),
  local: z.number().nullable(),
  drift: z.number().nullable(),
  countdownMs: z.number().nullable(),
  nudging: z.boolean(),
  buffering: z.boolean(),
  seekLatencySec: z.number(),
  manualSeek: z.boolean(),
});

/** What the player reported when the view was made; the panel reads position and volume from it. */
export const PlayerSnapshot = z.object({
  position: z.number(),
  duration: z.number().nullable(),
  buffering: z.boolean(),
  paused: z.boolean(),
  volume: Level,
  /** The last `volume` message applied, so the panel can tell a stale reading from a manual change. */
  volume_seq: z.number().int().nonnegative(),
  rate: z.number().positive(),
  /** Local wall clock milliseconds when the snapshot was taken. */
  at: z.number(),
});
export type PlayerSnapshot = z.infer<typeof PlayerSnapshot>;

export const VoiceIndicator = z.enum(['off', 'muted', 'live', 'host_muted']);
export type VoiceIndicator = z.infer<typeof VoiceIndicator>;

// Content script to panel (relayed by the worker) -------------------------------------------------

export const ContentToPanel = z.discriminatedUnion('type', [
  z.object({ type: z.literal('capabilities'), source: PaidSourceSchema, capabilities: Capabilities, video: z.boolean() }),
  z.object({ type: z.literal('view'), view: EngineViewSchema, player: PlayerSnapshot }),
  z.object({
    type: z.literal('user_action'),
    action: z.object({ kind: z.enum(['play', 'pause', 'seek']), position: z.number() }),
  }),
  z.object({ type: z.literal('buffering'), buffering: z.boolean() }),
  z.object({ type: z.literal('ended') }),
  /** The tab's address changed, or was first read: the panel compares titles with the room's. */
  z.object({ type: z.literal('content_ref'), url: z.url(), title_key: z.string().nullable() }),
  z.object({ type: z.literal('fullscreen'), on: z.boolean() }),
  z.object({ type: z.literal('tap_result'), id: z.number().int(), result: z.enum(['ok', 'blocked']) }),
  z.discriminatedUnion('action', [
    z.object({ type: z.literal('fs_action'), action: z.literal('mic') }),
    z.object({ type: z.literal('fs_action'), action: z.literal('react'), emoji: ReactionEmoji }),
  ]),
]);
export type ContentToPanel = z.infer<typeof ContentToPanel>;

// Panel to content script (relayed by the worker) -------------------------------------------------

export const PanelToContent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), row: PlaybackStateRow }),
  /** Server time is `Date.now() + offset_ms`. */
  z.object({ type: z.literal('server_offset'), offset_ms: z.number() }),
  z.object({ type: z.literal('hold') }),
  z.object({ type: z.literal('tap'), id: z.number().int() }),
  z.object({ type: z.literal('resync') }),
  z.object({ type: z.literal('volume'), level: Level, seq: z.number().int().positive() }),
  /** Stop the engine until the next `state`; the adapter stays. */
  z.object({ type: z.literal('suspend') }),
  z.object({ type: z.literal('navigate'), url: z.url() }),
  z.object({ type: z.literal('panel_ui'), collapsed: z.boolean() }),
  z.object({ type: z.literal('fs_state'), voice: VoiceIndicator, unread: z.number().int().nonnegative() }),
]);
export type PanelToContent = z.infer<typeof PanelToContent>;

// Panel to worker (consumed by the worker, never relayed) -----------------------------------------

export const PanelToWorker = z.discriminatedUnion('type', [
  /** Answer to `stop`: the panel no longer refreshes the session and has written its last tokens. */
  z.object({ type: z.literal('stopped'), room_id: Id }),
  /** The panel reached an end state (left, removed, closed, replaced) and gives the session up. */
  z.object({ type: z.literal('release'), room_id: Id }),
]);
export type PanelToWorker = z.infer<typeof PanelToWorker>;

// Worker to either side ------------------------------------------------------------------------------

export const PeerMessage = z.object({ type: z.literal('peer'), connected: z.boolean() });

export const WorkerToPanel = z.discriminatedUnion('type', [
  PeerMessage,
  /** Which room this tab holds; null when the tab holds none. */
  z.object({ type: z.literal('bind'), room_id: Id.nullable() }),
  z.object({ type: z.literal('stop'), reason: z.enum(['reclaimed', 'replaced']) }),
]);
export type WorkerToPanel = z.infer<typeof WorkerToPanel>;

export const WorkerToContent = z.discriminatedUnion('type', [
  PeerMessage,
  /** Whether this tab holds a room; the content script shows the panel only when it does. */
  z.object({ type: z.literal('bound'), bound: z.boolean() }),
]);
export type WorkerToContent = z.infer<typeof WorkerToContent>;

export const ToContent = z.union([WorkerToContent, PanelToContent]);
export type ToContent = z.infer<typeof ToContent>;

export const ToPanel = z.union([WorkerToPanel, ContentToPanel]);
export type ToPanel = z.infer<typeof ToPanel>;

/** Parses a message, returning null (and logging) when it does not match. */
export function parseMessage<T>(schema: z.ZodType<T>, raw: unknown, log: (detail: unknown) => void = () => {}): T | null {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  log(parsed.error.issues);
  return null;
}

/** The room id in a room page port name, `room-page:<roomId>`, or null. */
export function roomIdFromPortName(name: string): string | null {
  if (!name.startsWith(ROOM_PAGE_PREFIX)) return null;
  const id = name.slice(ROOM_PAGE_PREFIX.length);
  return Id.safeParse(id).success ? id : null;
}
