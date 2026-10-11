import type { NextConfig } from 'next';

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
