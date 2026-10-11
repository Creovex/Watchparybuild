import { createAdminClient } from '../_shared/clients.ts';
import { createLiveKitTokenHandler } from './handler.ts';

Deno.serve(createLiveKitTokenHandler({ env: Deno.env, admin: createAdminClient(Deno.env) }));
