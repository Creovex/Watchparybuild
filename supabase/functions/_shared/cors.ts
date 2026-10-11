// CORS (Cross Origin Resource Sharing): browsers ask before sending the Authorization header from
// another origin. Only the site, the preview domain and the sync extension may call the functions.

import { readEnv, type Env } from './env.ts';

export const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';
export const ALLOWED_METHODS = 'POST, OPTIONS';

function webOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Origins from `SITE_URL`, `PREVIEW_URL` and `EXTENSION_ORIGINS` (comma separated, each
 * `chrome-extension://<id>`).
 */
export function allowedOrigins(env: Env): Set<string> {
  const origins = new Set<string>();
  for (const name of ['SITE_URL', 'PREVIEW_URL']) {
    const value = readEnv(env, name);
    const origin = value ? webOrigin(value) : null;
    if (origin) origins.add(origin);
  }
  for (const entry of (readEnv(env, 'EXTENSION_ORIGINS') ?? '').split(',')) {
    // Extension origins have no host part a URL parser understands, so they are compared as text.
    const origin = entry.trim().replace(/\/+$/, '');
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(origin)) origins.add(origin);
  }
  return origins;
}

/** Headers for an actual request: the origin is echoed only when it is allowed. */
export function corsHeaders(origin: string | null, allowed: Set<string>): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/** Answers an OPTIONS preflight: 204 for an allowed origin, 403 for anything else. */
export function preflight(req: Request, allowed: Set<string>): Response {
  const origin = req.headers.get('Origin');
  if (!origin || !allowed.has(origin)) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, allowed),
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
}
