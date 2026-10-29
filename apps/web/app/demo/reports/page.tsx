import type { Metadata } from 'next';
import { Centre } from '@/app/(app)/reports/Centre';
import { DepositReports, FundReports, type Params } from '@/app/(app)/reports/Parts';
import { DemoShell } from '@/components/DemoShell';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { DEMO_HOLDING_MONTHS, DEMO_TODAY, demoView } from '@/lib/demo-funds';
import { demoCentreData } from '@/lib/demo-centre';
import { DEMO_REPORT_FDS } from '@/lib/demo-reports';
import { reportFunds } from '@/lib/reports-data';

export const metadata: Metadata = {
  title: 'Sample reports',
  robots: { index: false, follow: false },
};

export default async function DemoReports({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tab = sp.tab === 'funds' || sp.tab === 'centre' ? sp.tab : 'deposits';
  const params = { ...sp, tab };
  return (
    <DemoShell>
      <PageHead
        title="Reports"
        subtitle="Summaries of deposits and mutual funds, laid out like a sheet: by date, month, year, bank, person and more, each with a grand total and a CSV download."
      />
      <Tabs
        base="/demo/reports"
        current={tab}
        tabs={[
          { key: 'deposits', label: 'Deposits' },
          { key: 'funds', label: 'Mutual funds' },
          { key: 'centre', label: 'Report centre' },
        ]}
      />
      {tab === 'centre' ? (
        <Centre data={demoCentreData()} sp={sp} base="/demo/reports" sample />
      ) : tab === 'deposits' ? (
        <DepositReports
          fds={DEMO_REPORT_FDS}
          sample
          today={DEMO_TODAY}
          base="/demo/reports"
          params={params}
        />
      ) : (
        <FundReports
          funds={reportFunds(demoView(null, 'all'), null)}
          sample
          today={DEMO_TODAY}
          longMonths={DEMO_HOLDING_MONTHS}
          base="/demo/reports"
          params={params}
        />
      )}
    </DemoShell>
  );
}
