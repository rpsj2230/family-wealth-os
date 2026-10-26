import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadSetupStatus } from '@/lib/setup-status';
import { signOut } from '../../login/actions';
import { MoreMenu } from './MoreMenu';

export const dynamic = 'force-dynamic';

export default async function More() {
  const { supabase, householdId } = await loadContext();
  const setup = householdId
    ? await loadSetupStatus(supabase as unknown as SupabaseClient)
    : undefined;
  return <MoreMenu signOut={signOut} setup={setup} />;
}
