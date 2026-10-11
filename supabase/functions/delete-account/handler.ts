// delete-account: closes every open room the caller hosts, then deletes the user. Foreign keys do
// the rest: memberships go, messages stay with no author ("Deleted user"), reports keep no reporter.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { verifyWithAuth, type VerifyJwt } from '../_shared/clients.ts';
import type { Env } from '../_shared/env.ts';
import { createHandler, type Handler } from '../_shared/handler.ts';
import { fail } from '../_shared/http.ts';

/** No input: an empty body or `{}`. */
export const DeleteAccountInput = z.strictObject({});

export interface DeleteAccountDeps {
  env: Env;
  admin: SupabaseClient;
  verify?: VerifyJwt;
}

export function createDeleteAccountHandler(deps: DeleteAccountDeps): Handler {
  return createHandler({
    name: 'delete-account',
    env: deps.env,
    verify: deps.verify ?? verifyWithAuth(deps.admin),
    input: DeleteAccountInput,
    async run({ caller }) {
      // Closing through an update fires the room trigger, so every member sees "This room was closed".
      const closed = await deps.admin
        .from('rooms')
        .update({ status: 'closed' })
        .eq('host_id', caller.id)
        .eq('status', 'open');
      if (closed.error) {
        console.error('[delete-account] could not close hosted rooms', closed.error);
        return fail('internal');
      }
      const deleted = await deps.admin.auth.admin.deleteUser(caller.id);
      if (deleted.error) {
        console.error('[delete-account] could not delete the user', deleted.error);
        return fail('internal');
      }
      return { ok: true, data: null };
    },
  });
}
