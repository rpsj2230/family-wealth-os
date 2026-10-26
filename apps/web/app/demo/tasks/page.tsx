import type { Metadata } from 'next';
import Link from 'next/link';
import type { TaskModel } from '@/app/(app)/tasks/Parts';
import { TasksView, parseTaskTab } from '@/app/(app)/tasks/TasksView';

export const metadata: Metadata = {
  title: 'Sample: Tasks',
  robots: { index: false, follow: false },
};

const TODAY = '2026-10-26';
const t = (
  id: string,
  title: string,
  dueOn: string | null,
  extra: Partial<TaskModel> = {},
): TaskModel => ({
  id,
  title,
  status: 'open',
  dueOn,
  doneAt: null,
  assetId: null,
  institutionId: null,
  ...extra,
});

const TASKS: TaskModel[] = [
  t('t1', 'Update the address at Sample Yes Bank', '2026-10-20', { institutionId: 'i1' }),
  t(
    't2',
    '[Raise ₹5,00,000] Sample Jan Bank FD-2091 has matured: ask for it to be paid out. Expect ₹5,00,000 by 2026-10-28.',
    '2026-10-28',
  ),
  t('t3', 'Add the nominee on the Sample Equity Bank savings account', '2026-10-31', {
    assetId: 'a1',
  }),
  t('t4', '[Harvest 2026-27 Anil] Redeem units of Sample Small Cap Fund', '2027-03-20'),
  t('t5', 'Ask the bank for a new cheque book', null),
  t('t6', 'Update KYC at Sample AU Bank', '2026-09-30', {
    status: 'done',
    doneAt: '2026-10-02T08:00:00Z',
    institutionId: 'i2',
  }),
  t('t7', 'Renew the old standing instruction', null, { status: 'dropped' }),
];

/** Public preview of Tasks with invented tasks. Nothing is stored. */
export default async function DemoTasks({
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
        Invented tasks, to show the page. Nothing here is your data.
      </p>
      <TasksView
        tasks={TASKS}
        today={TODAY}
        names={{
          asset: new Map([['a1', 'Sample Equity Bank · Cash-NRE-1101']]),
          institution: new Map([
            ['i1', 'Sample Yes Bank'],
            ['i2', 'Sample AU Bank'],
          ]),
        }}
        banks={[]}
        tab={parseTaskTab(tab)}
        base="/demo/tasks"
        title="Tasks (sample)"
        linked={false}
      />
    </main>
  );
}
