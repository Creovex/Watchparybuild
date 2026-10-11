// Serves the four Edge Functions from one Deno process, for machines where the local stack's edge
// runtime cannot start them (in the build container its Docker image could not reach npm through
// the HTTPS proxy, gap G33). Uses the same handler factories as the deployed functions.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... TURN_TEST_MODE=1 \
//   SITE_URL=http://localhost:3100 pnpm fn:serve
//
// Then point the web app at it with NEXT_PUBLIC_FUNCTIONS_URL=http://127.0.0.1:54331 (end to end
// tests do this when E2E_FUNCTIONS_URL is set). Local stack only: the service role key it reads is
// the local stack's own.
import { createAdminClient, userClientFactory } from '../../functions/_shared/clients.ts';
import { createDeleteAccountHandler } from '../../functions/delete-account/handler.ts';
import { createLiveKitTokenHandler } from '../../functions/livekit-token/handler.ts';
import { createModerateHandler } from '../../functions/moderate/handler.ts';
import { createTurnCredentialsHandler } from '../../functions/turn-credentials/handler.ts';

const env = Deno.env;
const admin = createAdminClient(env);
const handlers: Record<string, (req: Request) => Promise<Response>> = {
  'turn-credentials': createTurnCredentialsHandler({ env, admin }),
  'livekit-token': createLiveKitTokenHandler({ env, admin }),
  moderate: createModerateHandler({ env, admin, createUserClient: userClientFactory(env) }),
  'delete-account': createDeleteAccountHandler({ env, admin }),
};

const port = Number(env.get('FUNCTIONS_PORT') ?? 54331);
Deno.serve({ port, hostname: '127.0.0.1' }, (req) => {
  const name = new URL(req.url).pathname.replace(/^\/(functions\/v1\/)?/, '').split('/')[0] ?? '';
  const handler = handlers[name];
  return handler ? handler(req) : new Response('Not found', { status: 404 });
});
