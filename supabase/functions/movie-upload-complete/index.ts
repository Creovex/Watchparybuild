import { createAdminClient } from '../_shared/clients.ts';
import { createMovieHandler } from '../_shared/movie-handler.ts';
Deno.serve(createMovieHandler('complete', { env: Deno.env, admin: createAdminClient(Deno.env) }));
