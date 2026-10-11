import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CreateRoomResult,
  JoinResult,
  PlaybackStateRow,
  RoomPreview,
  toResult,
  type ControlMode,
  type ModerationAction,
  type PlaybackStatus,
  type ReportReason,
  type Result,
  type Source,
  type SyncMode,
  type SystemCode,
  type Visibility,
} from '@watchparty/sync-core';
import { z } from 'zod';

// Typed wrappers for every RPC and Edge Function the clients call. Argument names match the SQL
// function signatures in supabase/migrations; this is the only file that knows them.

export interface RoomSettings {
  title?: string;
  control_mode?: ControlMode;
  wait_for_everyone?: boolean;
  locked?: boolean;
}

const RoomLink = z.object({ room_link: z.string() });

export interface RoomApiOptions {
  /**
   * Where Edge Functions are served when not at the project's own /functions/v1 path: only the local
   * functions server used where the local stack's edge runtime cannot run (gap G33).
   */
  functionsUrl?: string;
}

export class RoomApi {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly options: RoomApiOptions = {},
  ) {}

  private async rpc<T>(name: string, args: Record<string, unknown>, schema?: z.ZodType<T>): Promise<Result<T>> {
    try {
      const { data, error } = await this.supabase.rpc(name, args);
      if (error) return { ok: false, code: error.code === 'PGRST301' ? 'unauthorized' : 'internal' };
      return toResult(data, schema);
    } catch {
      return { ok: false, code: 'internal' };
    }
  }

  private async fn<T>(name: string, body: Record<string, unknown>, schema?: z.ZodType<T>): Promise<Result<T>> {
    if (this.options.functionsUrl) return this.fnDirect(name, body, schema);
    try {
      const { data, error } = await this.supabase.functions.invoke(name, { body });
      if (error) {
        // Non 2xx responses still carry the { ok: false, code } body.
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          try {
            return toResult(await context.json(), schema);
          } catch {
            return { ok: false, code: 'internal' };
          }
        }
        return { ok: false, code: 'internal' };
      }
      return toResult(data, schema);
    } catch {
      return { ok: false, code: 'internal' };
    }
  }

  private async fnDirect<T>(name: string, body: Record<string, unknown>, schema?: z.ZodType<T>): Promise<Result<T>> {
    try {
      const { data } = await this.supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return { ok: false, code: 'unauthorized' };
      const res = await fetch(`${this.options.functionsUrl!.replace(/\/$/, '')}/${name}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return toResult(await res.json(), schema);
    } catch {
      return { ok: false, code: 'internal' };
    }
  }

  serverTime() {
    return this.rpc('server_time', {}, z.number());
  }

  createRoom(input: {
    title: string;
    source: Source;
    content_ref: string | null;
    visibility: Visibility;
    control_mode: ControlMode;
  }) {
    return this.rpc('create_room', { ...input }, CreateRoomResult);
  }

  roomPreview(slug: string) {
    return this.rpc('room_preview', { slug }, RoomPreview);
  }

  joinRoom(slug: string, joinKey: string | null, syncMode: SyncMode) {
    return this.rpc('join_room', { slug, join_key: joinKey, sync_mode: syncMode }, JoinResult);
  }

  touchMember(roomId: string, engineSession: string, buffering: boolean, syncMode: SyncMode) {
    return this.rpc('touch_member', { room_id: roomId, engine_session: engineSession, buffering, sync_mode: syncMode });
  }

  leaveRoom(roomId: string) {
    return this.rpc('leave_room', { room_id: roomId });
  }

  setPlayback(input: {
    roomId: string;
    expectedSeq: number;
    status: PlaybackStatus;
    positionSec: number;
    rate: number;
    startDelayMs: number;
    reason: 'user' | 'buffer' | 'ended';
  }) {
    return this.rpc(
      'set_playback',
      {
        room_id: input.roomId,
        expected_seq: input.expectedSeq,
        status: input.status,
        position_sec: Math.max(0, input.positionSec),
        rate: input.rate,
        start_delay_ms: input.startDelayMs,
        reason: input.reason,
      },
      PlaybackStateRow,
    );
  }

  setSource(roomId: string, source: Source, contentRef: string) {
    return this.rpc('set_source', { room_id: roomId, source, content_ref: contentRef });
  }

  updateRoomSettings(roomId: string, settings: RoomSettings) {
    return this.rpc('update_room_settings', { room_id: roomId, settings });
  }

  closeRoom(roomId: string) {
    return this.rpc('close_room', { room_id: roomId });
  }

  transferHost(roomId: string, newHostId: string) {
    return this.rpc('transfer_host', { room_id: roomId, new_host_id: newHostId });
  }

  getRoomLink(roomId: string) {
    return this.rpc('get_room_link', { room_id: roomId }, RoomLink);
  }

  rotateJoinKey(roomId: string) {
    return this.rpc('rotate_join_key', { room_id: roomId });
  }

  sendChat(roomId: string, body: string, positionSec: number | null) {
    return this.rpc('send_chat', { room_id: roomId, body, position_sec: positionSec });
  }

  deleteMessage(messageId: string) {
    return this.rpc('delete_message', { message_id: messageId });
  }

  postSystem(roomId: string, code: Extract<SystemCode, 'cue_ready' | 'waiting_for'>) {
    return this.rpc('post_system', { room_id: roomId, system_code: code });
  }

  /** Moderation goes through the Edge Function so LiveKit is told too. */
  moderate(roomId: string, targetId: string, action: ModerationAction) {
    return this.fn('moderate', { room_id: roomId, target_id: targetId, action });
  }

  async report(input: {
    roomId: string;
    reporterId: string;
    targetUserId: string;
    messageId: string | null;
    reason: ReportReason;
    note: string;
  }): Promise<Result<null>> {
    const { error } = await this.supabase.from('reports').insert({
      room_id: input.roomId,
      reporter_id: input.reporterId,
      target_user_id: input.targetUserId,
      message_id: input.messageId,
      reason: input.reason,
      note: input.note.slice(0, 500),
    });
    return error ? { ok: false, code: 'internal' } : { ok: true, data: null };
  }

  /** Closes rooms the caller hosts and deletes the account (Edge Function, needs the service role). */
  deleteAccount() {
    return this.fn('delete-account', {});
  }

  turnCredentials(roomId: string, engineSession: string) {
    return this.fn('turn-credentials', { room_id: roomId, engine_session: engineSession }, z.object({ iceServers: z.array(z.any()) }));
  }

  livekitToken(roomId: string, engineSession: string) {
    return this.fn('livekit-token', { room_id: roomId, engine_session: engineSession }, z.object({ url: z.string(), token: z.string() }));
  }
}
