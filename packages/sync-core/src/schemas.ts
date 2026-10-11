import { z } from 'zod';

// Shared schemas. The database, the web app and the extension all exchange these shapes, and every
// receiver validates with the same schema the sender used.

export const SOURCES = ['youtube', 'netflix', 'prime', 'disney'] as const;
export const PAID_SOURCES = ['netflix', 'prime', 'disney'] as const;
export const REACTION_EMOJI = ['❤️', '😂', '😮', '😢', '😡', '👏', '🔥', '🍿'] as const;
export const SYSTEM_CODES = ['waiting_for', 'cue_ready', 'joined', 'left', 'host_changed'] as const;
export const MODERATION_ACTIONS = ['remove', 'ban', 'mute_voice', 'unmute_voice', 'allow_back'] as const;
export const REPORT_REASONS = ['spam', 'harassment', 'sexual', 'other'] as const;

export const Source = z.enum(SOURCES);
export type Source = z.infer<typeof Source>;
export type PaidSource = (typeof PAID_SOURCES)[number];
export const Visibility = z.enum(['public', 'private']);
export type Visibility = z.infer<typeof Visibility>;
export const ControlMode = z.enum(['host', 'everyone']);
export type ControlMode = z.infer<typeof ControlMode>;
export const SyncMode = z.enum(['auto', 'cue']);
export type SyncMode = z.infer<typeof SyncMode>;
export const VoiceMode = z.enum(['mesh', 'server']);
export type VoiceMode = z.infer<typeof VoiceMode>;
export const MemberState = z.enum(['joined', 'left', 'removed', 'banned']);
export type MemberState = z.infer<typeof MemberState>;
export const Role = z.enum(['host', 'guest']);
export type Role = z.infer<typeof Role>;
export const PlaybackStatus = z.enum(['playing', 'paused', 'ended']);
export type PlaybackStatus = z.infer<typeof PlaybackStatus>;
export const PausedReason = z.enum(['user', 'buffer']);
export type PausedReason = z.infer<typeof PausedReason>;
export const Plan = z.enum(['free', 'paid']);
export type Plan = z.infer<typeof Plan>;
export const ReactionEmoji = z.enum(REACTION_EMOJI);
export type ReactionEmoji = z.infer<typeof ReactionEmoji>;
export const SystemCode = z.enum(SYSTEM_CODES);
export type SystemCode = z.infer<typeof SystemCode>;
export const ModerationAction = z.enum(MODERATION_ACTIONS);
export type ModerationAction = z.infer<typeof ModerationAction>;
export const ReportReason = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReason>;

const Id = z.guid();
// Postgres timestamps arrive as ISO strings with microseconds and an offset.
const Timestamp = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'timestamp');

export function isPaidSource(source: Source): source is PaidSource {
  return (PAID_SOURCES as readonly string[]).includes(source);
}

// Database rows ---------------------------------------------------------------------------------

export const PlaybackStateRow = z.object({
  room_id: Id,
  seq: z.number().int().nonnegative(),
  status: PlaybackStatus,
  position_sec: z.number().nonnegative(),
  rate: z.number().positive(),
  server_ts: Timestamp,
  paused_reason: PausedReason.nullable(),
  updated_by: Id.nullable(),
});
export type PlaybackStateRow = z.infer<typeof PlaybackStateRow>;

export const RoomRow = z.object({
  id: Id,
  slug: z.string(),
  host_id: Id.nullable(),
  title: z.string(),
  visibility: Visibility,
  source: Source,
  content_ref: z.string().nullable(),
  control_mode: ControlMode,
  wait_for_everyone: z.boolean(),
  room_cap: z.union([z.literal(3), z.literal(10)]),
  voice_mode: VoiceMode,
  locked: z.boolean(),
  status: z.enum(['open', 'closed']),
  channel_epoch: z.number().int().positive(),
  created_at: Timestamp,
  last_active_at: Timestamp,
});
export type RoomRow = z.infer<typeof RoomRow>;

export const MemberRow = z.object({
  room_id: Id,
  user_id: Id,
  role: Role,
  state: MemberState,
  voice_muted: z.boolean(),
  sync_mode: SyncMode,
  buffering_since: Timestamp.nullable(),
  first_joined_at: Timestamp,
  last_seen_at: Timestamp,
  left_at: Timestamp.nullable(),
});
export type MemberRow = z.infer<typeof MemberRow>;

export const MessageRow = z.object({
  id: Id,
  room_id: Id,
  user_id: Id.nullable(),
  kind: z.enum(['chat', 'timed', 'system']),
  body: z.string(),
  system_code: SystemCode.nullable(),
  position_sec: z.number().nullable(),
  created_at: Timestamp,
  deleted_at: Timestamp.nullable(),
});
export type MessageRow = z.infer<typeof MessageRow>;

export const ProfilePublic = z.object({
  id: Id,
  display_name: z.string(),
  avatar_url: z.string().nullable(),
});
export type ProfilePublic = z.infer<typeof ProfilePublic>;

// System message bodies hold the data the client needs to render the sentence; the sentence itself
// is built on the client from `system_code` so names stay current.
export const SystemBody = z.object({
  user_id: Id.optional(),
  user_ids: z.array(Id).optional(),
  position_sec: z.number().optional(),
});
export type SystemBody = z.infer<typeof SystemBody>;

// Server topic events (written only by the database) --------------------------------------------

export const ModerationEvent = z.object({
  target: Id,
  action: ModerationAction,
  new_epoch: z.number().int().positive(),
});
export type ModerationEvent = z.infer<typeof ModerationEvent>;

export const ServerEvents = {
  state: PlaybackStateRow,
  room: RoomRow,
  members: MemberRow,
  chat: MessageRow,
  moderation: ModerationEvent,
} as const;
export type ServerEventName = keyof typeof ServerEvents;

// Client topic events (sent by members, validated by receivers) ----------------------------------

export const HeartbeatEvent = z.object({
  seq: z.number().int().nonnegative(),
  observed_position: z.number(),
  observed_server_ms: z.number(),
});
export type HeartbeatEvent = z.infer<typeof HeartbeatEvent>;

export const ReactionEvent = z.object({
  emoji: ReactionEmoji,
  position_sec: z.number().nonnegative(),
});
export type ReactionEvent = z.infer<typeof ReactionEvent>;

export const RtcEvent = z
  .object({
    from: Id,
    to: Id.nullable(),
    kind: z.enum(['hello', 'description', 'candidate']),
    payload: z.unknown(),
  })
  .refine((e) => e.to !== null || e.kind === 'hello', 'only hello may be broadcast');
export type RtcEvent = z.infer<typeof RtcEvent>;

export const ClientEvents = {
  heartbeat: HeartbeatEvent,
  reaction: ReactionEvent,
  rtc: RtcEvent,
} as const;
export type ClientEventName = keyof typeof ClientEvents;

export const PresencePayload = z.object({
  user_id: Id,
  display_name: z.string(),
  device: z.enum(['phone', 'desktop']),
  sync_mode: SyncMode,
  voice: z.enum(['off', 'muted', 'live']),
  engine: z.enum(['page', 'extension']),
});
export type PresencePayload = z.infer<typeof PresencePayload>;

// Returns the parsed payload, or null after logging when the event does not match its schema.
export function parseEvent<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  log: (msg: string, detail: unknown) => void = () => {},
): T | null {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  log('dropped invalid event', result.error.issues);
  return null;
}

// RPC and Edge Function results -------------------------------------------------------------------

export const RPC_CODES = [
  'invalid_input',
  'too_many_rooms',
  'internal',
  'not_found',
  'closed',
  'locked',
  'banned',
  'removed',
  'bad_key',
  'room_full',
  'not_member',
  'replaced',
  'not_controller',
  'not_elected',
  'stale_seq',
  'not_host',
  'not_allowed',
  'rate_limited',
] as const;

export const FUNCTION_CODES = [
  'invalid_input',
  'unauthorized',
  'not_member',
  'not_host',
  'wrong_voice_mode',
  'voice_muted',
  'not_found',
  'rate_limited',
  'internal',
  'voice_sync_failed',
] as const;

export const ERROR_CODES = Array.from(new Set([...RPC_CODES, ...FUNCTION_CODES])) as ErrorCode[];
export type ErrorCode = (typeof RPC_CODES)[number] | (typeof FUNCTION_CODES)[number];

// Codes the app handles on its own and never shows to a person.
export const SILENT_CODES: readonly ErrorCode[] = ['stale_seq', 'not_elected'];

export type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; data?: unknown };

export const ResultEnvelope = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), code: z.string(), data: z.unknown().optional() }),
]);

// Normalises any RPC or function response into a Result; unknown shapes become `internal`.
export function toResult<T>(raw: unknown, dataSchema?: z.ZodType<T>): Result<T> {
  const parsed = ResultEnvelope.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'internal' };
  const env = parsed.data;
  if (!env.ok) {
    const code = (ERROR_CODES as string[]).includes(env.code) ? (env.code as ErrorCode) : 'internal';
    return { ok: false, code, data: env.data };
  }
  if (!dataSchema) return { ok: true, data: env.data as T };
  const data = dataSchema.safeParse(env.data);
  return data.success ? { ok: true, data: data.data } : { ok: false, code: 'internal' };
}

// Join and create responses ----------------------------------------------------------------------

export const RoomPreview = z.object({
  title: z.string(),
  source: Source,
  visibility: Visibility,
  locked: z.boolean(),
  status: z.enum(['open', 'closed']),
  present_count: z.number().int().nonnegative(),
  room_cap: z.number().int().positive(),
});
export type RoomPreview = z.infer<typeof RoomPreview>;

export const JoinResult = z.object({
  room: RoomRow,
  playback_state: PlaybackStateRow,
  channel_epoch: z.number().int().positive(),
  engine_session: Id,
});
export type JoinResult = z.infer<typeof JoinResult>;

export const CreateRoomResult = z.object({
  room: RoomRow,
  room_link: z.string(),
});
export type CreateRoomResult = z.infer<typeof CreateRoomResult>;

// Sync extension handover --------------------------------------------------------------------------

export const HandoverMessage = z.object({
  type: z.literal('handover'),
  room_id: Id,
  slug: z.string(),
  source: Source,
  content_ref: z.string(),
  engine_session: Id,
  session: z.object({
    access_token: z.string(),
    refresh_token: z.string(),
  }),
});
export type HandoverMessage = z.infer<typeof HandoverMessage>;

export const PingMessage = z.object({ type: z.literal('ping') });

// Sent by the room page over its port to ask for the session back ("Bring it back here").
export const ReclaimMessage = z.object({ type: z.literal('reclaim'), room_id: Id });

// Sent by the extension to the room page when it gives the engine back, either because the page
// asked or because the streaming tab closed.
export const ReturnMessage = z.object({
  type: z.literal('return'),
  room_id: Id,
  session: z.object({
    access_token: z.string(),
    refresh_token: z.string(),
  }),
});
export type ReturnMessage = z.infer<typeof ReturnMessage>;

export const PageToExtension = z.union([PingMessage, HandoverMessage, ReclaimMessage]);
export type PageToExtension = z.infer<typeof PageToExtension>;

export const ExtensionReply = z.union([
  z.object({ type: z.literal('pong'), version: z.string() }),
  z.object({ type: z.literal('handover_ok') }),
  z.object({ type: z.literal('handover_refused'), reason: z.string() }),
  ReturnMessage,
]);
export type ExtensionReply = z.infer<typeof ExtensionReply>;
