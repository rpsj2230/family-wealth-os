import Link from 'next/link';
import { parseHomeRange, parseMovementKey } from '@fwos/core';
import { redirect } from 'next/navigation';
import { PageHead } from '@/components/PageHead';
import { SetupChecklist } from '@/components/SetupChecklist';
import { setSetupItemOff } from './settings/actions';
import { loadAccess, loadContext } from '@/lib/data';
import { loadHome } from '@/lib/home-data';
import { loadSetupStatus } from '@/lib/setup-status';
import { niceDate } from '@/lib/dates';
import { addMember, createHousehold } from './actions';
import { HomeView } from './dashboard/HomeView';
import { SnapshotBeacon } from './SnapshotBeacon';
import { WhatsAppButton } from './share/WhatsAppButton';

export const dynamic = 'force-dynamic';

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{
    problem?: string;
    range?: string;
    period?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { problem, range, period, from, to } = await searchParams;
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const { supabase, householdId, role } = await loadContext();

  if (!householdId) {
    return (
      <section className="card">
        <h1>Set up your household</h1>
        <p className="muted">
          This creates the private space that you and your spouse share. You become its
          administrator.
        </p>
        {problem && (
          <p className="notice warn" role="alert">
            Could not set up the household: {problem}. If you share an account with someone who has
            already set it up, ask them to add you, or sign in with the same email they used.
          </p>
        )}
        <form action={createHousehold} className="form">
          <label>
            Household name
            <input name="name" defaultValue="Our household" required />
          </label>
          <button className="btn primary">Create household</button>
        </form>
      </section>
    );
  }

  const [home, setup] = await Promise.all([
    loadHome(supabase, parseHomeRange(range), {
      key: parseMovementKey(period),
      custom: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
    }),
    loadSetupStatus(supabase),
  ]);

  if (!home) {
    return (
      <section className="card">
        <h1>Welcome</h1>
        <p>Your household is ready, but nothing has been recorded yet.</p>
        <p>
          <Link className="btn primary" href="/import">
            Import your Excel workbook
          </Link>
        </p>
        {role === 'admin' && <AddMember />}
      </section>
    );
  }

  const late = home.attention.filter((a) => a.tone === 'bad').length;
  return (
    <>
      <SnapshotBeacon />
      <PageHead
        title="Family wealth"
        subtitle="Net worth, how the money is growing, and what needs you."
        pills={[
          { label: `values as of ${niceDate(home.asOf ?? home.today)}`, tone: 'info' },
          home.attention.length === 0
            ? { label: 'Nothing needs you', tone: 'ok' }
            : {
                label: `${home.attention.length} need${home.attention.length === 1 ? 's' : ''} you${late > 0 ? `, ${late} late` : ''}`,
                tone: late > 0 ? 'bad' : 'warn',
              },
        ]}
        actions={<WhatsAppButton icon />}
      />
      <SetupChecklist
        items={setup}
        compact
        max={4}
        title="Finish setting up"
        switchOff={setSetupItemOff}
      />
      <HomeView m={home} />
      {role === 'admin' && <AddMember />}
    </>
  );
}

function AddMember() {
  return (
    <section className="card">
      <h2>Add your spouse</h2>
      <p className="muted small">
        Create their login in Supabase first, then enter the same email here. They will see
        everything you see.
      </p>
      <form action={addMember} className="form row">
        <input
          name="email"
          type="email"
          placeholder="spouse@example.com"
          required
          aria-label="Spouse email"
        />
        <button className="btn">Add</button>
      </form>
    </section>
  );
}
