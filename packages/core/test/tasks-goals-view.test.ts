import { describe, expect, it } from 'vitest';
import { goalCardFigures } from '../src/goal-card';
import { projectGoal } from '../src/goals';
import { dueText, groupOpenTasks, taskConcern, type TaskLite } from '../src/tasks-view';

const t = (o: Partial<TaskLite> & { id: string }): TaskLite => ({
  title: o.id,
  status: 'open',
  dueOn: null,
  ...o,
});
const TODAY = '2026-10-26';

describe('groupOpenTasks', () => {
  const tasks = [
    t({ id: 'late', dueOn: '2026-10-20' }),
    t({ id: 'today', dueOn: '2026-10-26' }),
    t({ id: 'wk', dueOn: '2026-11-02' }),
    t({ id: 'wk2', dueOn: '2026-10-28' }),
    t({ id: 'far', dueOn: '2027-03-31' }),
    t({ id: 'none' }),
    t({ id: 'done', status: 'done', dueOn: '2026-10-01' }),
    t({ id: 'dropped', status: 'dropped' }),
  ];
  const g = groupOpenTasks(tasks, TODAY);
  it('puts open tasks in overdue, this week, later and no date, soonest first', () => {
    expect(g.map((b) => [b.key, b.tasks.map((x) => x.id)])).toEqual([
      ['overdue', ['late']],
      ['week', ['today', 'wk2', 'wk']],
      ['later', ['far']],
      ['nodate', ['none']],
    ]);
  });
  it('leaves done and dropped tasks out', () => {
    expect(g.flatMap((b) => b.tasks).some((x) => x.id === 'done' || x.id === 'dropped')).toBe(
      false,
    );
  });
  it('respects a different week length', () => {
    const w = groupOpenTasks(tasks, TODAY, 1);
    expect(w.find((b) => b.key === 'week')!.tasks.map((x) => x.id)).toEqual(['today']);
  });
});

describe('dueText', () => {
  it('says how late or soon in plain words', () => {
    expect(dueText('2026-10-20', TODAY)).toBe('6 days overdue');
    expect(dueText('2026-10-25', TODAY)).toBe('1 day overdue');
    expect(dueText('2026-10-26', TODAY)).toBe('Due today');
    expect(dueText('2026-10-27', TODAY)).toBe('Due tomorrow');
    expect(dueText('2026-10-30', TODAY)).toBe('Due in 4 days');
    expect(dueText('2026-12-12', TODAY)).toBe('Due 12 Dec 2026');
    expect(dueText(null, TODAY)).toBe('No date');
  });
});

describe('taskConcern', () => {
  it('links to the account, the bank, or the page that made the task', () => {
    expect(
      taskConcern(
        { title: 'x', assetId: 'a1', institutionId: null },
        { asset: new Map([['a1', 'Cash-1']]) },
      ),
    ).toEqual({
      label: 'Cash-1',
      href: '/asset/a1',
    });
    expect(
      taskConcern(
        { title: 'x', assetId: null, institutionId: 'i1' },
        { institution: new Map([['i1', 'Yes Bank']]) },
      ),
    ).toEqual({
      label: 'Yes Bank',
      href: '/bank/i1',
    });
    expect(
      taskConcern({ title: '[Raise ₹5,00,000] Sell units', assetId: null, institutionId: null }),
    ).toEqual({
      label: 'I need money',
      href: '/raise',
    });
    expect(
      taskConcern({ title: '[Harvest 2026-27 Anil] Redeem', assetId: null, institutionId: null })!
        .href,
    ).toBe('/tax');
    expect(taskConcern({ title: 'Update address', assetId: null, institutionId: null })).toBeNull();
  });
});

describe('goalCardFigures', () => {
  const base = {
    inflation: 0.06,
    annualReturn: 0.08,
    today: TODAY,
    targetDate: '2036-10-26',
  };
  it('reports a funded goal as on track with no top-up', () => {
    const proj = projectGoal({
      ...base,
      targetToday: 1_000_000,
      allocatedNow: 2_000_000,
      monthlyContribution: 10_000,
    });
    const f = goalCardFigures({ proj, allocated: 2_000_000 });
    expect(f.state).toBe('on_track');
    expect(f.fundedPct).toBe(100);
    expect(f.topUp).toBe(0);
  });
  it('reports a shortfall with the monthly top-up and the share already earmarked', () => {
    const proj = projectGoal({
      ...base,
      targetToday: 5_000_000,
      allocatedNow: 500_000,
      monthlyContribution: 5_000,
    });
    const f = goalCardFigures({ proj, allocated: 500_000 });
    expect(f.state).toBe('shortfall');
    expect(f.fundedPct).toBeLessThan(100);
    expect(f.earmarkedPct).toBeGreaterThan(0);
    expect(f.earmarkedPct!).toBeLessThanOrEqual(f.fundedPct!);
    expect(f.topUp).toBeGreaterThan(0);
    expect(f.headline).toMatch(/more each month/);
  });
  it('asks for a target when there is none, and flags a date that has passed', () => {
    const none = goalCardFigures({
      proj: projectGoal({ ...base, targetToday: null, allocatedNow: 0, monthlyContribution: 0 }),
      allocated: 0,
    });
    expect(none.state).toBe('no_target');
    expect(none.fundedPct).toBeNull();
    const past = goalCardFigures({
      proj: projectGoal({
        ...base,
        targetDate: '2026-01-01',
        targetToday: 100_000,
        allocatedNow: 0,
        monthlyContribution: 0,
      }),
      allocated: 0,
    });
    expect(past.state).toBe('past_due');
  });
});
