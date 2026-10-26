import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Connectivity check used during setup. Reports whether the three environment variables exist
 * and whether Supabase Auth answers. It never returns keys, URLs or error bodies.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(url),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(anon),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(service),
  };

  let supabase: 'not_configured' | 'reachable' | 'unreachable' = 'not_configured';
  if (url && anon) {
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
        headers: { apikey: anon },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      supabase = res.ok ? 'reachable' : 'unreachable';
    } catch {
      supabase = 'unreachable';
    }
  }

  const ok = Object.values(env).every(Boolean) && supabase === 'reachable';
  return NextResponse.json({ ok, env, supabase }, { status: ok ? 200 : 503 });
}
