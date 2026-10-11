'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';

let client: SupabaseClient | null = null;

/** One browser client per page, so every component shares one session and one realtime socket. */
export function getBrowserClient(): SupabaseClient {
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

/**
 * Drops the browser client and the session cookies without signing out. Used when the session is
 * handed to the sync extension: signing out would revoke the refresh token the extension now holds.
 */
export function forgetBrowserSession(): void {
  client?.auth.stopAutoRefresh();
  client?.removeAllChannels();
  client = null;
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name && name.startsWith('sb-') && name.includes('-auth-token')) {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    }
  }
}
