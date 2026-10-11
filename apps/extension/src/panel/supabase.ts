import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authKey } from '../shared/keys';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../shared/env';

// The panel's Supabase client. Its session lives in `chrome.storage.session`, which the browser
// clears when it closes, under a key per room. The panel is the only holder of the session while
// the room is handed over, so it is the only place that refreshes it.

export interface AsyncStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const sessionAreaStorage: AsyncStorage = {
  async getItem(key) {
    const value = (await chrome.storage.session.get(key))[key];
    return typeof value === 'string' ? value : null;
  },
  async setItem(key, value) {
    await chrome.storage.session.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.session.remove(key);
  },
};

export function createPanelClient(roomId: string, storage: AsyncStorage = sessionAreaStorage): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage,
      storageKey: authKey(roomId),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
