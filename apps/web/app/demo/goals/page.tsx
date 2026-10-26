import type { Metadata } from 'next';
import Link from 'next/link';
import { projectGoal } from '@fwos/core';
import { GoalsView, parseGoalTab, type FreeHolding } from '@/app/(app)/goals/GoalsView';
import type { GoalModel } from '@/app/(app)/goals/Parts';

export const metadata: Metadata = {
  title: 'Sample: Goals',
  robots: { index: false, follow: false },
};

const TODAY = '2026-10-26';

const goal = (
  id: string,
  name: string,
  kind: string,
  target: number | null,
  date: string | null,
  infl: number,
  allocated: number,
  monthly: number,
  funds: GoalModel['funds'],
): GoalModel => {
  const years = date ? (Date.parse(date) - Date.parse(TODAY)) / (365.25 * 86_400_000) : 0;
  const ret = years >= 8 ? 0.1 : years >= 4 ? 0.08 : 0.065;
  return {
    id,
    name,
    kind,
    targetToday: target,
    targetDate: date,
    inflationPct: '',
    defaultInflationPct: (infl * 100).toFixed(1),
    yearsLeft: date ? years : null,
    returnPct: (ret * 100).toFixed(1),
    inflation: infl,
    allocated,
    monthly,
    funds,
    proj: projectGoal({
      targetToday: target,
      targetDate: date,
      inflation: infl,
      allocatedNow: allocated,
      monthlyContribution: monthly,
      annualReturn: ret,
      today: TODAY,
    }),
  };
};

const GOALS: GoalModel[] = [
  goal(
    'g1',
    'Sample overseas education',
    'education',
    6_000_000,
    '2036-08-01',
    0.09,
    1_450_000,
    12_000,
    [
      { assetId: 'a1', name: 'Sample Flexi Cap Fund', pct: 60, share: 900_000 },
      { assetId: 'a2', name: 'Sample Index Fund', pct: 50, share: 550_000 },
    ],
  ),
  goal('g2', 'Sample wedding', 'marriage', 2_500_000, '2031-02-01', 0.07, 2_300_000, 8_000, [
    { assetId: 'a3', name: 'Sample Jan Bank FD-2091', pct: 100, share: 2_300_000 },
  ]),
  goal('g3', 'Sample new flat', 'property', null, null, 0.06, 0, 0, []),
];
const CHOICES: FreeHolding[] = [
  { id: 'a1', name: 'Sample Flexi Cap Fund', value: 1_500_000, freePct: 40, freeValue: 600_000 },
  { id: 'a2', name: 'Sample Index Fund', value: 1_100_000, freePct: 50, freeValue: 550_000 },
  {
    id: 'a4',
    name: 'Sample Equity Bank savings',
    value: 420_000,
    freePct: 100,
    freeValue: 420_000,
  },
  { id: 'a3', name: 'Sample Jan Bank FD-2091', value: 2_300_000, freePct: 0, freeValue: 0 },
];

/** Public preview of Goals with invented goals and holdings. Nothing is stored. */
export default async function DemoGoals({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <p className="notice warn" role="note">
        Invented goals and holdings, to show the page. Nothing here is your data.
      </p>
      <GoalsView
        goals={GOALS}
        choices={CHOICES}
        tab={parseGoalTab(tab)}
        base="/demo/goals"
        title="Goals (sample)"
      />
    </main>
  );
}
