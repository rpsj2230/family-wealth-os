import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export interface Ctx {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string;
  householdId: string | null;
  role: string | null;
}

/** Signed-in user and their household (null until a household exists). Redirects to /login otherwise. */
export async function loadContext(): Promise<Ctx> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await supabase
    .from('household_members')
    .select('household_id, role')
    .eq('user_id', user.id)
    .in('role', ['admin', 'member'])
    .limit(1);
  const m = data?.[0];
  return {
    supabase,
    userId: user.id,
    email: user.email ?? '',
    householdId: m?.household_id ?? null,
    role: m?.role ?? null,
  };
}

/** The signed-in user's household and role for ANY role, including the read-only emergency viewer. */
export async function loadAccess(): Promise<{
  supabase: Ctx['supabase'];
  email: string;
  householdId: string | null;
  role: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await supabase
    .from('household_members')
    .select('household_id, role')
    .eq('user_id', user.id)
    .limit(1);
  const m = data?.[0];
  return {
    supabase,
    email: user.email ?? '',
    householdId: m?.household_id ?? null,
    role: m?.role ?? null,
  };
}
