// livekit-token: a 10 minute LiveKit join token for server voice. LiveKit room = room id,
// identity = user id.

import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyWithAuth, type VerifyJwt } from '../_shared/clients.ts';
import type { Env } from '../_shared/env.ts';
import { createHandler, type Handler } from '../_shared/handler.ts';
import { fail } from '../_shared/http.ts';
import { createJoinToken, liveKitConfig } from '../_shared/livekit.ts';
import { VoiceInput, checkVoiceAccess } from '../_shared/voice-access.ts';

export interface LiveKitTokenDeps {
  env: Env;
  admin: SupabaseClient;
  verify?: VerifyJwt;
}

async function displayName(admin: SupabaseClient, userId: string): Promise<string | undefined> {
  const { data, error } = await admin.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  if (error || !data) return undefined;
  const name = (data as { display_name?: unknown }).display_name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

export function createLiveKitTokenHandler(deps: LiveKitTokenDeps): Handler {
  return createHandler({
    name: 'livekit-token',
    env: deps.env,
    verify: deps.verify ?? verifyWithAuth(deps.admin),
    input: VoiceInput,
    async run({ caller, input }) {
      const access = await checkVoiceAccess(deps.admin, {
        roomId: input.room_id,
        userId: caller.id,
        engineSession: input.engine_session,
        voiceMode: 'server',
      });
      if (!access.ok) return access;

      const config = liveKitConfig(deps.env);
      if (!config) {
        console.error('[livekit-token] LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not set');
        return fail('internal');
      }
      const token = await createJoinToken(config, {
        roomId: input.room_id,
        userId: caller.id,
        name: await displayName(deps.admin, caller.id),
      });
      return { ok: true, data: { url: config.url, token } };
    },
  });
}
