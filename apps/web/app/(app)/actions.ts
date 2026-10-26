'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loadContext } from '@/lib/data';

export async function createHousehold(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim() || 'Our household';
  const { supabase } = await loadContext();
  const { error } = await supabase.rpc('create_household', { p_name: name });
  if (error) redirect(`/?problem=${encodeURIComponent(error.message.slice(0, 160))}`);
  revalidatePath('/');
  redirect('/');
}

export async function addMember(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const { supabase, householdId } = await loadContext();
  if (!householdId || !email) return;
  const { error } = await supabase.rpc('add_household_member', {
    p_household: householdId,
    p_email: email,
    p_role: 'member',
  });
  if (error)
    throw new Error('Could not add that person. Check the email matches an existing login.');
  revalidatePath('/');
}
