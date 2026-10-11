// Who may get voice credentials: a joined, unmuted, not replaced member of an open room whose voice
// mode matches the function.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { FunctionCode } from './http.ts';

/**
 * Input of `turn-credentials` and `livekit-token`. `engine_session` is the value `join_room`
 * returned; it proves the caller is the browser context currently acting for the member, so a
 * replaced context cannot get credentials (gap G30).
 */
export const VoiceInput = z.strictObject({
  room_id: z.guid(),
  engine_session: z.guid(),
});
export type VoiceInput = z.infer<typeof VoiceInput>;

const MemberRow = z.object({
  state: z.string(),
  engine_session: z.string().nullable(),
  voice_muted: z.boolean(),
});

const RoomRow = z.object({
  voice_mode: z.string(),
  status: z.string(),
});

export type VoiceAccess = { ok: true } | { ok: false; code: FunctionCode };

export async function checkVoiceAccess(
  admin: SupabaseClient,
  args: { roomId: string; userId: string; engineSession: string; voiceMode: 'mesh' | 'server' },
): Promise<VoiceAccess> {
  const [member, room] = await Promise.all([
    admin
      .from('room_members')
      .select('state, engine_session, voice_muted')
      .eq('room_id', args.roomId)
      .eq('user_id', args.userId)
      .maybeSingle(),
    admin.from('rooms').select('voice_mode, status').eq('id', args.roomId).maybeSingle(),
  ]);
  if (member.error) throw member.error;
  if (room.error) throw room.error;

  const m = member.data === null ? null : MemberRow.parse(member.data);
  const r = room.data === null ? null : RoomRow.parse(room.data);
  // A closed room has no members to speak to, so it is treated like not being a member.
  if (!m || !r || m.state !== 'joined' || m.engine_session !== args.engineSession || r.status !== 'open') {
    return { ok: false, code: 'not_member' };
  }
  if (r.voice_mode !== args.voiceMode) return { ok: false, code: 'wrong_voice_mode' };
  if (m.voice_muted) return { ok: false, code: 'voice_muted' };
  return { ok: true };
}
