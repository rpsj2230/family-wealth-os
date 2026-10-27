import Link from 'next/link';
import { DEFAULT_APP_URL, buildDigestEmail } from '@fwos/core';
import { buildDigestInput } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DigestFrames } from '@/components/DigestFrames';
import { PageHead } from '@/components/PageHead';
import { niceDate } from '@/lib/dates';
import { loadContext } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Today's summary e-mail, built now from the live figures through the same code the 08:30 job uses, shown at phone and laptop
 * width. Nothing is sent from here. A switch left off in Settings is honoured, so the preview is what would arrive.
 */
export default async function DigestPreviewPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [h, s] = await Promise.all([
    supabase.from('households').select('name').eq('id', householdId).single(),
    supabase.from('digest_settings').select('*').maybeSingle(),
  ]);
  const set = s.data as {
    include_retirement?: boolean | null;
    include_goals?: boolean | null;
  } | null;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const input = await buildDigestInput(supabase as unknown as SupabaseClient, {
    date,
    householdName: (h.data as { name: string } | null)?.name ?? 'Household',
    appUrl: DEFAULT_APP_URL,
    includeRetirement: set?.include_retirement ?? true,
    includeGoals: set?.include_goals ?? true,
  });
  const email = buildDigestEmail(input);
  return (
    <>
      <PageHead
        title="Preview today’s e-mail"
        subtitle={`Built just now from your own figures for ${niceDate(date)}, the way the 08:30 e-mail is built. Nothing is sent from here.`}
        pills={[
          {
            label: set?.include_goals === false ? 'Goals left out' : 'Goals included',
            tone: 'info',
          },
          {
            label:
              set?.include_retirement === false ? 'Retirement left out' : 'Retirement included',
            tone: 'info',
          },
        ]}
        actions={
          <Link className="btn" href="/settings?tab=notifications">
            Back to Notifications
          </Link>
        }
      />
      <DigestFrames email={email} />
      <p className="muted small">
        To get a real test in your inbox, open GitHub, then Actions, <em>Daily summary email</em>,
        Run workflow, and tick <em>Digest test</em>. It uses the Gmail sign-in kept there, so the
        app itself cannot send one.
      </p>
    </>
  );
}
