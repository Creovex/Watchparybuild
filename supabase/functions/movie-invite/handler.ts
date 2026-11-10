import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { userClientFactory, verifyWithAuth, type VerifyJwt } from '../_shared/clients.ts';
import type { Env } from '../_shared/env.ts';
import { createHandler } from '../_shared/handler.ts';
import { fail, isFunctionCode } from '../_shared/http.ts';
export function createMovieInviteHandler(deps: {
  env: Env;
  admin: SupabaseClient;
  verify?: VerifyJwt;
  createUserClient?: (jwt: string) => SupabaseClient;
}) {
  const userClient = deps.createUserClient ?? userClientFactory(deps.env);
  return createHandler({
    name: 'movie-invite',
    env: deps.env,
    verify: deps.verify ?? verifyWithAuth(deps.admin),
    input: z.strictObject({
      slug: z.string().regex(/^[A-Za-z0-9_-]{10}$/),
      join_key: z.string().max(128).nullable(),
    }),
    async run({ jwt, input }) {
      const { data, error } = await userClient(jwt).rpc('movie_invitation', input);
      if (error) return fail('internal');
      if (!data?.ok) return fail(isFunctionCode(data?.code) ? data.code : 'internal');
      const info = data.data;
      let poster_url: string | null = null;
      if (info.poster_path) {
        const { data: poster } = await deps.admin.storage
          .from('posters')
          .createSignedUrl(info.poster_path, 600);
        poster_url = poster?.signedUrl ?? null;
      }
      return { ok: true, data: { title: info.title, host_name: info.host_name, poster_url } };
    },
  });
}
