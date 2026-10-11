// moderate: calls the `moderate` RPC as the host, then tells LiveKit for server voice rooms. If
// LiveKit still fails after 3 retries the database change stands and the host sees
// `voice_sync_failed`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { verifyWithAuth, type VerifyJwt } from '../_shared/clients.ts';
import type { Env } from '../_shared/env.ts';
import { createHandler, type Handler } from '../_shared/handler.ts';
import { fail, isFunctionCode } from '../_shared/http.ts';
import {
  isParticipantNotFound,
  publishPermission,
  roomServiceFromEnv,
  type ParticipantAdmin,
} from '../_shared/livekit.ts';

export const MODERATION_ACTIONS = ['remove', 'ban', 'mute_voice', 'unmute_voice', 'allow_back'] as const;

export const ModerateInput = z.strictObject({
  room_id: z.guid(),
  target_id: z.guid(),
  action: z.enum(MODERATION_ACTIONS),
});
export type ModerateInput = z.infer<typeof ModerateInput>;

/** The LiveKit call is tried once and retried 3 times. */
export const LIVEKIT_RETRIES = 3;
export const RETRY_BASE_MS = 250;

export interface ModerateDeps {
  env: Env;
  admin: SupabaseClient;
  createUserClient(jwt: string): SupabaseClient;
  verify?: VerifyJwt;
  roomService?: (env: Env) => ParticipantAdmin | null;
  sleep?: (ms: number) => Promise<void>;
}

const RpcResult = z.union([
  z.object({ ok: z.literal(true), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), code: z.string() }),
]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `call` once and up to `retries` more times; "participant not found" counts as done. */
export async function withRetries(
  call: () => Promise<unknown>,
  retries: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    try {
      await call();
      return { ok: true };
    } catch (err) {
      if (isParticipantNotFound(err)) return { ok: true };
      lastError = err;
    }
  }
  return { ok: false, error: lastError };
}

export function createModerateHandler(deps: ModerateDeps): Handler {
  const sleep = deps.sleep ?? defaultSleep;
  const roomService = deps.roomService ?? roomServiceFromEnv;
  return createHandler({
    name: 'moderate',
    env: deps.env,
    verify: deps.verify ?? verifyWithAuth(deps.admin),
    input: ModerateInput,
    async run({ jwt, input }) {
      // The RPC runs as the caller, so it decides whether they are the host.
      const rpc = await deps.createUserClient(jwt).rpc('moderate', {
        room_id: input.room_id,
        target_id: input.target_id,
        action: input.action,
      });
      if (rpc.error) {
        console.error('[moderate] the moderate RPC failed', rpc.error);
        return fail('internal');
      }
      const result = RpcResult.safeParse(rpc.data);
      if (!result.success) {
        console.error('[moderate] the moderate RPC returned an unexpected shape');
        return fail('internal');
      }
      if (!result.data.ok) {
        const code = result.data.code;
        if (!isFunctionCode(code)) console.error(`[moderate] unexpected RPC code ${code}`);
        return fail(isFunctionCode(code) ? code : 'internal');
      }
      const data = result.data.data ?? null;
      if (input.action === 'allow_back') return { ok: true, data };

      // From here on the database change stands; only voice can lag behind.
      const room = await deps.admin.from('rooms').select('voice_mode').eq('id', input.room_id).maybeSingle();
      if (room.error || !room.data) {
        console.error('[moderate] could not read the room voice mode after moderating', room.error);
        return fail('voice_sync_failed');
      }
      if ((room.data as { voice_mode?: unknown }).voice_mode !== 'server') return { ok: true, data };

      const service = roomService(deps.env);
      if (!service) {
        console.error('[moderate] LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not set');
        return fail('voice_sync_failed');
      }
      const mute = input.action === 'mute_voice';
      const call =
        input.action === 'mute_voice' || input.action === 'unmute_voice'
          ? () =>
              service.updateParticipant(input.room_id, input.target_id, {
                permission: publishPermission(!mute),
              })
          : () => service.removeParticipant(input.room_id, input.target_id);
      const outcome = await withRetries(call, LIVEKIT_RETRIES, sleep);
      if (!outcome.ok) {
        console.error(
          `[moderate] LiveKit ${input.action} for ${input.target_id} in room ${input.room_id} failed after ${LIVEKIT_RETRIES} retries; the database change stands`,
          outcome.error,
        );
        return fail('voice_sync_failed');
      }
      return { ok: true, data };
    },
  });
}
