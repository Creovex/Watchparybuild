// Public configuration. Each value is read with its literal name so Next.js can inline it at build.

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Watchparty';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const EXTENSION_IDS = (process.env.NEXT_PUBLIC_EXTENSION_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
/** Test builds only: lets end to end tests swap the YouTube player for a local video. */
export const E2E_STUB = process.env.NEXT_PUBLIC_E2E === '1';
/** Local functions server only (gap G33); unset in every hosted environment. */
export const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL || '';
