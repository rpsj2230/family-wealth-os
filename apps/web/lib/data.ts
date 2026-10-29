import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export interface Ctx {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string;
  householdId: string | null;
  role: string | null;
}

/**
 * Who is signed in, once per page: the session's token is checked by its signature (getClaims), which needs no call to the auth
 * server when the project signs with asymmetric keys, and asks the server otherwise. Redirects to /login when no one is.
 */
const currentUser = cache(async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; email?: string } | undefined;
  if (!claims?.sub) redirect('/login');
  return { supabase, userId: claims.sub, email: claims.email ?? '' };
});

/** The signed-in user's memberships, once per page. */
const memberships = cache(async function memberships() {
  const { supabase, userId } = await currentUser();
  const { data } = await supabase
    .from('household_members')
    .select('household_id, role')
    .eq('user_id', userId);
  return (data ?? []) as { household_id: string; role: string }[];
});

/** Signed-in user and their household (null until a household exists). Redirects to /login otherwise. */
export const loadContext = cache(async function loadContext(): Promise<Ctx> {
  const { supabase, userId, email } = await currentUser();
  const m = (await memberships()).find((x) => x.role === 'admin' || x.role === 'member');
  return {
    supabase,
    userId,
    email,
    householdId: m?.household_id ?? null,
    role: m?.role ?? null,
  };
});

/** The signed-in user's household and role for ANY role, including the read-only emergency viewer. */
export const loadAccess = cache(async function loadAccess(): Promise<{
  supabase: Ctx['supabase'];
  email: string;
  householdId: string | null;
  role: string | null;
}> {
  const { supabase, email } = await currentUser();
  const m = (await memberships())[0];
  return {
    supabase,
    email,
    householdId: m?.household_id ?? null,
    role: m?.role ?? null,
  };
});
