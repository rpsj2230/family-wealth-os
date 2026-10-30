import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseEnv } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

/**
 * The link in a password-reset email lands here: a one-time token (the household's own email) or a code (Supabase's email) is
 * turned into a short session for setting the new password. A used or expired link goes back to "Forgot your password?".
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!supabaseEnv()) return NextResponse.redirect(new URL('/login?error=setup', url));
  const supabase = await createClient();
  const tokenHash = url.searchParams.get('token_hash');
  const code = url.searchParams.get('code');
  let ok = false;
  if (tokenHash)
    ok = !(await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })).error;
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  return NextResponse.redirect(
    new URL(ok ? '/login/reset/new' : '/login/forgot?error=expired', url),
  );
}
