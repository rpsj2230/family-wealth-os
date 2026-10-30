import type { Handbook } from '@fwos/core';
import { buildHandbookDoc, loadHandbookTicks } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAccess, loadContext } from '@/lib/data';
import { sameJson, tickMap } from '@/lib/handbook-view';
import { HandbookGuide } from './HandbookGuide';
import { HandbookView } from './HandbookView';
import { refreshHandbook, tickStep } from './actions';

export const dynamic = 'force-dynamic';

export default async function EmergencyPage() {
  const { supabase, householdId, role } = await loadAccess();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const isMember = role === 'admin' || role === 'member';
  if (!isMember) {
    const { data: st } = await supabase.rpc('emergency_status', { h: householdId });
    const status = st as {
      open: boolean;
      mode: string;
      inactiveDays: number;
      daysUntilOpen: number | null;
    } | null;
    if (status && !status.open)
      return (
        <>
          <h1>Family handbook</h1>
          <p className="notice warn">
            The handbook is locked for now.{' '}
            {status.mode === 'inactive'
              ? `It opens by itself when nobody from the household has signed in for ${status.inactiveDays} days${status.daysUntilOpen !== null ? ` (about ${status.daysUntilOpen} days from now if that stays so)` : ''}.`
              : 'A family member has to release it first.'}{' '}
            If something has happened, ask a trusted adult or the people listed on the paper copy.
          </p>
        </>
      );
  }
  let row = (
    await supabase.from('emergency_documents').select('content, generated_at').maybeSingle()
  ).data as { content: Handbook; generated_at: string } | null;
  // a member opening the page always sees a fresh handbook, so a nominee or helpline just filled in shows at once; the stored copy
  // (what the read-only family login reads) is rewritten when anything in it changed, or at least every six hours
  if (isMember) {
    try {
      const doc = await buildHandbookDoc(supabase as unknown as SupabaseClient);
      const changed =
        !row ||
        !sameJson(row.content, doc) ||
        Date.now() - Date.parse(row.generated_at) > 6 * 3_600_000;
      if (changed) {
        await supabase.rpc('save_emergency_document', { p_household: householdId, p_content: doc });
        row = { content: doc, generated_at: new Date().toISOString() };
      }
    } catch {
      /* show the stored one */
    }
  }
  if (!row)
    return (
      <>
        <h1>Family handbook</h1>
        <p className="notice warn">
          The handbook has not been created yet. A family member with full access can open this page
          to create it.
        </p>
      </>
    );
  let accessNote: string | undefined;
  if (isMember) {
    const a = (
      await supabase.from('emergency_access').select('mode, inactive_days, released').maybeSingle()
    ).data as { mode: string; inactive_days: number; released: boolean } | null;
    const mode = a?.mode ?? 'always';
    accessNote =
      mode === 'inactive'
        ? `The read-only family login opens this after nobody from the household has signed in for ${a?.inactive_days ?? 30} days${a?.released ? ' (released by hand now)' : ''}.`
        : mode === 'manual'
          ? `The read-only family login opens this only when you release it. Now: ${a?.released ? 'released' : 'locked'}.`
          : 'The read-only family login can always open this.';
  }
  const guide = row.content.guide;
  if (guide) {
    const [{ userId }, ticks, viewers] = await Promise.all([
      loadContext(),
      loadHandbookTicks(supabase as unknown as SupabaseClient),
      // members may see who the read-only family login is, so a tick can say "ticked by the family login"
      isMember
        ? supabase
            .from('household_members')
            .select('user_id')
            .eq('household_id', householdId)
            .eq('role', 'emergency_viewer')
            .then((r) => (r.data ?? []).map((x) => x.user_id as string))
        : Promise.resolve([] as string[]),
    ]);
    return (
      <HandbookGuide
        guide={guide}
        generatedAt={row.generated_at}
        initialTicks={tickMap(ticks, userId, new Set(viewers))}
        tick={tickStep}
        refresh={isMember ? refreshHandbook : undefined}
        member={isMember}
        accessNote={accessNote}
      />
    );
  }
  // a copy stored before the guide existed (until the next daily rewrite)
  return (
    <HandbookView
      doc={row.content}
      generatedAt={row.generated_at}
      refresh={isMember ? refreshHandbook : undefined}
      settingsHref={isMember ? '/settings?tab=access' : undefined}
      accessNote={accessNote}
    />
  );
}
