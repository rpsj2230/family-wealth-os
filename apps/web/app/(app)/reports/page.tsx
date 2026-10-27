import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { loadContext } from '@/lib/data';
import { reportFds, reportFunds, loadReportsInput } from '@/lib/reports-data';
import { DepositReports, FundReports, type Params } from './Parts';

export const dynamic = 'force-dynamic';

const TABS = ['deposits', 'funds'] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'deposits';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const input = await loadReportsInput(supabase, { funds: tab === 'funds' });
  const who = sp.p && input.styles[sp.p] ? sp.p : null;
  const keep = { ...sp, tab };
  return (
    <>
      <PageHead
        title="Reports"
        subtitle="Summaries of deposits and mutual funds, laid out like a sheet: by date, month, year, bank, person and more, each with a grand total and a CSV download."
      />
      <Tabs
        base="/reports"
        current={tab}
        keep={who ? { p: who } : {}}
        tabs={[
          { key: 'deposits', label: 'Deposits' },
          { key: 'funds', label: 'Mutual funds' },
        ]}
      />
      <PersonFilter people={input.people} basePath="/reports" current={who} keep={{ tab }} />
      {tab === 'deposits' && (
        <DepositReports
          fds={reportFds(input.fdLines, input.fdRows, who)}
          scope={who ? (input.styles[who]?.name ?? null) : null}
          today={input.today}
          base="/reports"
          params={keep}
        />
      )}
      {tab === 'funds' && input.view && (
        <FundReports
          funds={reportFunds(input.view, who)}
          scope={who ? (input.styles[who]?.name ?? null) : null}
          today={input.today}
          longMonths={input.view.holdingMonths}
          base="/reports"
          params={keep}
        />
      )}
    </>
  );
}
