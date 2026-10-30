'use server';

import { createClient as createAdmin } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { MIN_PASSWORD, resetMailer, sendResetMail } from '@/lib/reset-mail';
import { createClient } from '@/lib/supabase/server';
import { supabaseEnv } from '@/lib/supabase/env';

/** The site's own address, as the browser reached it. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * Sends a link to set a new password. With the household's Gmail set on the site, the link is made here and sent from it (it reaches
 * any member and needs no Supabase settings); otherwise Supabase sends its own e-mail. Either way the page says the same thing,
 * so it never tells whether an address has a login.
 */
export async function requestReset(formData: FormData) {
  const env = supabaseEnv();
  if (!env) redirect('/login?error=setup');
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect('/login/forgot?error=email');
  const confirm = `${await origin()}/login/reset/confirm`;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    if (resetMailer() && service) {
      const admin = createAdmin(env.url, service, { auth: { persistSession: false } });
      const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
      const hash = data?.properties?.hashed_token;
      if (!error && hash)
        await sendResetMail(
          email,
          `${confirm}?token_hash=${encodeURIComponent(hash)}&type=recovery`,
        );
    } else {
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: confirm });
    }
  } catch {
    // the same answer whatever happened
  }
  redirect('/login/forgot?sent=1');
}

/** Sets the new password for the person the reset link (or their own sign-in) identifies. */
export async function setNewPassword(formData: FormData) {
  if (!supabaseEnv()) redirect('/login?error=setup');
  const password = String(formData.get('password') ?? '');
  const again = String(formData.get('again') ?? '');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login/forgot?error=expired');
  if (password.length < MIN_PASSWORD) redirect('/login/reset/new?error=short');
  if (password !== again) redirect('/login/reset/new?error=match');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect('/login/reset/new?error=failed');
  redirect('/login/reset/new?done=1');
}

export async function signIn(formData: FormData) {
  if (!supabaseEnv()) redirect('/login?error=setup');
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/login?error=invalid');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Never reveal whether the email exists.
  if (error) redirect('/login?error=invalid');
  redirect('/');
}

export async function signOut() {
  if (supabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect('/login');
}
