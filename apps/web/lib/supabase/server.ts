import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';

export async function getServerClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components cannot write cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/** The signed in user, verified with the sign in service, or null. */
export async function getUser(): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const supabase = await getServerClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user ?? null };
}
