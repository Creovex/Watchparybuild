import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Runs before every page request: refreshes the Supabase session cookie, sends signed out visitors
// away from pages that need an account, and sets the Content Security Policy (CSP) with a fresh
// nonce so only the app's own scripts and the YouTube player API can run.

const SIGNED_IN_ONLY = ['/home', '/new', '/settings'];

function origins(raw: string | undefined, socket: boolean): string[] {
  if (!raw) return [];
  try {
    const url = new URL(raw);
    const secure = url.protocol === 'https:' || url.protocol === 'wss:';
    const list = [`${secure ? 'https' : 'http'}://${url.host}`];
    if (socket) list.push(`${secure ? 'wss' : 'ws'}://${url.host}`);
    return list;
  } catch {
    return [];
  }
}

function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === 'development';
  const supabase = origins(process.env.NEXT_PUBLIC_SUPABASE_URL, true);
  const livekit = origins(process.env.LIVEKIT_URL, true);
  const functions = origins(process.env.NEXT_PUBLIC_FUNCTIONS_URL, false);
  // The YouTube IFrame Player API loads its widget script and its player frame from www.youtube.com
  // only (checked in the browser console, recorded in docs/decisions.md).
  const youtube = ['https://www.youtube.com'];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...youtube, ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://lh3.googleusercontent.com'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...supabase, ...livekit, ...functions],
    'frame-src': ['https://www.youtube.com'],
    'media-src': ["'self'", 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  let signedIn = false;
  try {
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } catch {
    signedIn = false;
  }

  const path = request.nextUrl.pathname;
  if (!signedIn && SIGNED_IN_ONLY.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = `?next=${encodeURIComponent(path)}`;
    const redirect = NextResponse.redirect(url);
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }
  if (signedIn && path === '/') {
    const next = request.nextUrl.searchParams.get('next');
    const url = request.nextUrl.clone();
    url.pathname = next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
    url.search = '';
    return NextResponse.redirect(url);
  }

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|pwa-icon/|manifest.webmanifest|workers/|e2e/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
