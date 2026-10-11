import { createAdminClient, userClientFactory } from '../_shared/clients.ts';
import { createModerateHandler } from './handler.ts';

Deno.serve(
  createModerateHandler({
    env: Deno.env,
    admin: createAdminClient(Deno.env),
    createUserClient: userClientFactory(Deno.env),
  }),
);
