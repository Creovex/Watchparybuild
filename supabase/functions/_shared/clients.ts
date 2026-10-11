// Supabase clients. Secrets come only from the environment Supabase injects into Edge Functions.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnv, type Env } from './env.ts';

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function need(env: Env, name: string): string {
  const value = readEnv(env, name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Service role client: bypasses Row Level Security. Used only for reads and writes the function checked itself. */
export function createAdminClient(env: Env): SupabaseClient {
  return createClient(need(env, 'SUPABASE_URL'), need(env, 'SUPABASE_SERVICE_ROLE_KEY'), { auth: NO_SESSION });
}

/** A client that acts as the caller, so RPCs see the caller's `auth.uid()`. */
export function userClientFactory(env: Env): (jwt: string) => SupabaseClient {
  const url = need(env, 'SUPABASE_URL');
  const anonKey = need(env, 'SUPABASE_ANON_KEY');
  return (jwt) =>
    createClient(url, anonKey, {
      auth: NO_SESSION,
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
}

export interface Caller {
  id: string;
}

/** Checks a JWT (JSON Web Token) and returns the signed in user, or null when it is not valid. */
export type VerifyJwt = (jwt: string) => Promise<Caller | null>;

/** Verifies with Supabase Auth, which checks the signature, expiry and that the user still exists. */
export function verifyWithAuth(admin: SupabaseClient): VerifyJwt {
  return async (jwt) => {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error) {
      const status = (error as { status?: number }).status;
      // 4xx: the token is bad. Anything else means Auth could not be asked.
      if (typeof status === 'number' && status >= 400 && status < 500) return null;
      throw error;
    }
    return data.user ? { id: data.user.id } : null;
  };
}
