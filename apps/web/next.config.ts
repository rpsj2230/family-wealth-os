import type { NextConfig } from 'next';

// Next.js emits small inline bootstrap scripts, so script-src keeps 'unsafe-inline'; everything else is locked down.
// Data only ever goes to this site and the project's own Supabase host.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config: NextConfig = {
  transpilePackages: ['@fwos/core', '@fwos/ingest', '@fwos/data'],
  serverExternalPackages: ['exceljs'],
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
    // a page seen in the last 30 seconds opens at once from the browser's memory (back, forward, the menu); saving anything
    // clears it, so a change always shows
    staleTimes: { dynamic: 30, static: 300 },
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
