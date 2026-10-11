import { createAdminClient } from '../_shared/clients.ts';
import { createTurnCredentialsHandler } from './handler.ts';

Deno.serve(createTurnCredentialsHandler({ env: Deno.env, admin: createAdminClient(Deno.env) }));
