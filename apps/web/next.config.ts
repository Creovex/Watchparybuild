import type { NextConfig } from 'next';

// A key copied from a dashboard that shows dots in place of a hidden key still builds, but every
// call the server makes to Supabase then fails before it is sent, so Google sign in never finishes.
// Stop the build instead. A real key is printable ASCII (American Standard Code for Information
// Interchange) with no spaces.
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
if (anonKey && !/^[\x21-\x7E]+$/.test(anonKey)) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY holds characters no real key has, such as the dots a dashboard shows in place of a hidden key, or a space. Paste the full key again.',
  );
}

// Security headers that do not change per request. The Content Security Policy needs a fresh nonce
// on every request, so proxy.ts sets it.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@watchparty/sync-core', '@watchparty/ui', '@watchparty/voice'],
  poweredByHeader: false,
  // Next.js would otherwise write an AGENTS.md into the app folder on every dev start.
  agentRules: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The room address carries the room's slug; keep it out of every outgoing request.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
