'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseEnv } from '@/lib/supabase/env';

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
