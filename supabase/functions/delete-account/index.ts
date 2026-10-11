import { createAdminClient } from '../_shared/clients.ts';
import { createDeleteAccountHandler } from './handler.ts';

Deno.serve(createDeleteAccountHandler({ env: Deno.env, admin: createAdminClient(Deno.env) }));
