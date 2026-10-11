// Public configuration, read from the same NEXT_PUBLIC_ variables as the web app. Vite replaces each
// `import.meta.env` read with its value at build time; nothing secret may ever be read here.

export const APP_NAME = import.meta.env.NEXT_PUBLIC_APP_NAME || 'Synvello';
export const SITE_URL = (import.meta.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const SUPABASE_URL = import.meta.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const LOCAL_ORIGIN = 'http://localhost:3000';

/** Origins of the web app that may talk to the extension: the local dev server and the site. */
export function pageOrigins(siteUrl: string = SITE_URL): string[] {
  const origins = new Set<string>([LOCAL_ORIGIN]);
  try {
    origins.add(new URL(siteUrl).origin);
  } catch {
    // A malformed site address adds nothing; the local origin still works.
  }
  return [...origins];
}
