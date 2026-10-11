// turn-credentials: ICE (Interactive Connectivity Establishment) servers for mesh voice. Cloudflare
// STUN and TURN credentials valid for 6 hours, longer than any normal watching session.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { verifyWithAuth, type VerifyJwt } from '../_shared/clients.ts';
import { flagSet, readEnv, type Env } from '../_shared/env.ts';
import { createHandler, type Handler } from '../_shared/handler.ts';
import { fail } from '../_shared/http.ts';
import { VoiceInput, checkVoiceAccess } from '../_shared/voice-access.ts';

export const TURN_TTL_SECONDS = 6 * 60 * 60;
export const CLOUDFLARE_STUN = 'stun:stun.cloudflare.com:3478';

export interface TurnCredentialsDeps {
  env: Env;
  admin: SupabaseClient;
  verify?: VerifyJwt;
  fetch?: typeof fetch;
}

const IceServer = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
type IceServer = z.infer<typeof IceServer>;

const CloudflareResponse = z.object({ iceServers: z.array(IceServer).min(1) });

/** Port 53 is blocked by browsers and only makes ICE wait for a timeout; Cloudflare advises dropping it. */
export function withoutPort53(servers: IceServer[]): IceServer[] {
  const blocked = (url: string) => /:53(\?|$)/.test(url);
  const out: IceServer[] = [];
  for (const server of servers) {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((u) => !blocked(u));
    if (urls.length > 0) out.push({ ...server, urls });
  }
  return out;
}

export function cloudflareEndpoint(keyId: string): string {
  return `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
}

export function createTurnCredentialsHandler(deps: TurnCredentialsDeps): Handler {
  const fetchFn = deps.fetch ?? fetch;
  return createHandler({
    name: 'turn-credentials',
    env: deps.env,
    verify: deps.verify ?? verifyWithAuth(deps.admin),
    input: VoiceInput,
    async run({ caller, input }) {
      const access = await checkVoiceAccess(deps.admin, {
        roomId: input.room_id,
        userId: caller.id,
        engineSession: input.engine_session,
        voiceMode: 'mesh',
      });
      if (!access.ok) return access;

      // Local stack only: STUN and no TURN, so tests need no Cloudflare key.
      if (flagSet(deps.env, 'TURN_TEST_MODE')) {
        return { ok: true, data: { iceServers: [{ urls: [CLOUDFLARE_STUN] }] } };
      }

      const keyId = readEnv(deps.env, 'CLOUDFLARE_TURN_KEY_ID');
      const token = readEnv(deps.env, 'CLOUDFLARE_TURN_API_TOKEN');
      if (!keyId || !token) {
        console.error('[turn-credentials] CLOUDFLARE_TURN_KEY_ID or CLOUDFLARE_TURN_API_TOKEN is not set');
        return fail('internal');
      }
      const res = await fetchFn(cloudflareEndpoint(keyId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      });
      if (!res.ok) {
        console.error(`[turn-credentials] Cloudflare answered ${res.status}`);
        return fail('internal');
      }
      const body = CloudflareResponse.safeParse(await res.json().catch(() => null));
      if (!body.success) {
        console.error('[turn-credentials] Cloudflare sent an unexpected body');
        return fail('internal');
      }
      return { ok: true, data: { iceServers: withoutPort53(body.data.iceServers) } };
    },
  });
}
