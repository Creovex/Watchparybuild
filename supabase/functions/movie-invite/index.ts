import { createAdminClient } from '../_shared/clients.ts';
import { createMovieInviteHandler } from './handler.ts';
Deno.serve(createMovieInviteHandler({ env: Deno.env, admin: createAdminClient(Deno.env) }));
