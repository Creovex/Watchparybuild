import { createAdminClient } from '../_shared/clients.ts';
import { createStorageProofHandler } from './handler.ts';
Deno.serve(createStorageProofHandler({ env: Deno.env, admin: createAdminClient(Deno.env) }));
