import { describe, expect, it } from 'vitest';
import {
  findMonthTab,
  formatMonthTitle,
  insertIndexFor,
  monthIn,
  monthTabs,
  parseMonthTitle,
  pickTemplate,
  tabOrder,
  type SheetTab,
} from '../src/sheet-months';

const tab = (title: string, index: number, hidden = false): SheetTab => ({
  sheetId: 100 + index,
  title,
  index,
  hidden,
});

describe('month tab names', () => {
  it('reads the usual name and the small variants', () => {
    expect(parseMonthTitle('Oct 2026')).toMatchObject({ year: 2026, month: 10 });
    expect(parseMonthTitle('Sep 2026')).toMatchObject({ year: 2026, month: 9 });
    expect(parseMonthTitle('October 2026')).toMatchObject({ year: 2026, month: 10 });
    expect(parseMonthTitle(' oct-2026 ')).toMatchObject({ year: 2026, month: 10 });
    expect(parseMonthTitle("Oct'26")).toMatchObject({ year: 2026, month: 10 });
    expect(parseMonthTitle('SEPT 2026')).toMatchObject({ year: 2026, month: 9 });
    expect(parseMonthTitle('2026 Oct')).toMatchObject({ year: 2026, month: 10 });
    expect(parseMonthTitle('10-2026')).toMatchObject({ year: 2026, month: 10 });
  });

  it('does not take other tabs, or the safety copy, for a month', () => {
    for (const t of [
      'Summary',
      'Oct 2026 - before sync',
      'Oct 2026 (old)',
      'Sheet1',
      'Mon 2026',
      'Ma 2026',
      '13-2026',
      '',
    ])
      expect(parseMonthTitle(t), t).toBeNull();
  });

  it('writes a new name in the style of the existing ones', () => {
    const ym = { year: 2026, month: 10 };
    expect(formatMonthTitle(ym)).toBe('Oct 2026');
    expect(formatMonthTitle(ym, parseMonthTitle('September 2026')!.style)).toBe('October 2026');
    expect(formatMonthTitle(ym, parseMonthTitle("Sep'26")!.style)).toBe("Oct'26");
    expect(formatMonthTitle(ym, parseMonthTitle('SEP-2026')!.style)).toBe('OCT-2026');
    expect(formatMonthTitle(ym, parseMonthTitle('2026 sep')!.style)).toBe('2026 oct');
    expect(formatMonthTitle(ym, parseMonthTitle('09-2026')!.style)).toBe('10-2026');
  });

  it('lists visible month tabs oldest first and ignores hidden ones', () => {
    const tabs = monthTabs([
      tab('Summary', 0),
      tab('Oct 2026', 1),
      tab('Sep 2026', 2),
      tab('Sep 2026 - before sync', 3, true),
      tab('Aug 2026', 4),
      tab('Jul 2026', 5, true),
    ]);
    expect(tabs.map((t) => t.title)).toEqual(['Aug 2026', 'Sep 2026', 'Oct 2026']);
  });

  it('keeps the left-most tab when two are named for one month', () => {
    const tabs = monthTabs([tab('October 2026', 3), tab('Oct 2026', 1)]);
    expect(tabs.map((t) => t.title)).toEqual(['Oct 2026']);
  });

  it('finds this month and the latest earlier month to copy', () => {
    const tabs = monthTabs([tab('Sep 2026', 0), tab('Aug 2026', 1), tab('Jun 2026', 2)]);
    expect(findMonthTab(tabs, { year: 2026, month: 9 })?.title).toBe('Sep 2026');
    expect(findMonthTab(tabs, { year: 2026, month: 10 })).toBeNull();
    expect(pickTemplate(tabs, { year: 2026, month: 10 })?.title).toBe('Sep 2026');
    expect(pickTemplate(tabs, { year: 2026, month: 7 })?.title).toBe('Jun 2026');
    expect(pickTemplate(tabs, { year: 2026, month: 6 })).toBeNull();
    // across a year end
    const dec = monthTabs([tab('Dec 2025', 0), tab('Nov 2025', 1)]);
    expect(pickTemplate(dec, { year: 2026, month: 1 })?.title).toBe('Dec 2025');
  });

  it('detects which side the workbook puts its newest month', () => {
    const left = monthTabs([tab('Oct 2026', 0), tab('Sep 2026', 1), tab('Aug 2026', 2)]);
    const right = monthTabs([tab('Aug 2026', 0), tab('Sep 2026', 1), tab('Oct 2026', 2)]);
    const one = monthTabs([tab('Sep 2026', 0)]);
    expect(tabOrder(left)).toBe('newest_left');
    expect(tabOrder(right)).toBe('newest_right');
    expect(tabOrder(one)).toBe('unknown');
    // newest left: the new tab takes the template's place; newest right: it goes after it
    expect(insertIndexFor('newest_left', left[1]!)).toBe(left[1]!.index);
    expect(insertIndexFor('newest_right', right[1]!)).toBe(2);
    expect(insertIndexFor('unknown', one[0]!)).toBe(1);
  });

  it('decides the month in the household time zone, not in UTC', () => {
    // 31 October 2026, 17:30 UTC is already 1 November in Singapore
    const now = new Date('2026-10-31T17:30:00Z');
    expect(monthIn('Asia/Singapore', now)).toMatchObject({
      year: 2026,
      month: 11,
      iso: '2026-11-01',
    });
    expect(monthIn('UTC', now)).toMatchObject({ year: 2026, month: 10, iso: '2026-10-31' });
  });
});
