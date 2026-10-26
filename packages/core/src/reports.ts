/**
 * Sheet-style summaries of deposits and mutual funds: one row per date, month, year, bank, person and so on, with a grand total,
 * the way a pivot table in a workbook shows them. Pure: every figure comes from the rows passed in. A report is a plain table
 * (`ReportTable`), so one screen can show any of them and one function can export any of them.
 */
import { fdValueOn, type Compounding } from './fd';
import { fyBoundsOf, fyOf } from './tax';

export type ColKind = 'text' | 'date' | 'int' | 'money' | 'pct' | 'rate';
export type Cell = string | number | null;

export interface Col {
  key: string;
  label: string;
  kind: ColKind;
}

export interface ReportTable {
  id: string;
  title: string;
  /** one line under the title: what the rows are and what to keep in mind */
  note?: string;
  columns: Col[];
  rows: Record<string, Cell>[];
  total?: Record<string, Cell>;
  /** bars to draw above the table: label and amount */
  chart?: { label: string; value: number }[];
}

/** How dates are bunched together in a summary. */
export type Period = 'date' | 'month' | 'quarter' | 'fy' | 'year';
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'date', label: 'Each date' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'fy', label: 'Financial year' },
  { key: 'year', label: 'Calendar year' },
];
export const parsePeriod = (v: string | undefined, fallback: Period = 'date'): Period =>
  PERIODS.some((p) => p.key === v) ? (v as Period) : fallback;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-23" -> "23 Sep 2026" */
export const dayLabel = (d: string) =>
  `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** The group a date falls in: a sortable key and the words for it. */
export function periodOf(date: string, period: Period): { key: string; label: string } {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  switch (period) {
    case 'date':
      return { key: date, label: dayLabel(date) };
    case 'month':
      return { key: date.slice(0, 7), label: `${MONTHS[m - 1]} ${y}` };
    case 'quarter': {
      const q = Math.floor((m - 1) / 3);
      return {
        key: `${y}-Q${q + 1}`,
        label: `${MONTHS[q * 3]}–${MONTHS[q * 3 + 2]} ${y}`,
      };
    }
    case 'fy': {
      const fy = fyOf(date);
      return { key: fy, label: `FY ${fy}` };
    }
    case 'year':
      return { key: y, label: y };
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------------------------------------
// Deposits
// ------------------------------------------------------------------------------------------------
export interface ReportFd {
  id: string;
  bank: string;
  owner: string;
  kind: string;
  principal: number;
  /** annual rate as a decimal */
  rate: number;
  bookedOn: string;
  maturityOn: string;
  /** what the deposit pays at maturity (the bank's figure when known, else worked out) */
  maturityAmount: number;
  compounding: Compounding;
}

const FD_MONEY: Col[] = [
  { key: 'count', label: 'Deposits', kind: 'int' },
  { key: 'principal', label: 'Amount', kind: 'money' },
  { key: 'maturity', label: 'Maturity', kind: 'money' },
  { key: 'interest', label: 'Interest', kind: 'money' },
];

interface FdAgg {
  count: number;
  principal: number;
  maturity: number;
  interest: number;
}
const aggFds = (list: ReportFd[]): FdAgg => ({
  count: list.length,
  principal: r2(sum(list.map((f) => f.principal))),
  maturity: r2(sum(list.map((f) => f.maturityAmount))),
  interest: r2(sum(list.map((f) => f.maturityAmount - f.principal))),
});

/**
 * "Maturity summary" (by the date each deposit matures) and "Start summary" (by the date it was booked): the amount put in, the
 * amount it pays at maturity and the interest, for each date, month, quarter, financial year or year, with a grand total.
 */
export function fdSummary(
  fds: ReportFd[],
  opts: { basis: 'maturity' | 'start'; period: Period },
): ReportTable {
  const groups = new Map<string, { label: string; list: ReportFd[] }>();
  for (const f of fds) {
    const p = periodOf(opts.basis === 'maturity' ? f.maturityOn : f.bookedOn, opts.period);
    const g = groups.get(p.key) ?? { label: p.label, list: [] };
    g.list.push(f);
    groups.set(p.key, g);
  }
  const keys = [...groups.keys()].sort();
  let running = 0;
  const rows = keys.map((k) => {
    const g = groups.get(k)!;
    const a = aggFds(g.list);
    running = r2(running + (opts.basis === 'maturity' ? a.maturity : a.principal));
    return { period: g.label, ...a, running } as Record<string, Cell>;
  });
  const total = aggFds(fds);
  const what = opts.basis === 'maturity' ? 'Maturity date' : 'Start date';
  return {
    id: opts.basis === 'maturity' ? 'fd-maturity' : 'fd-start',
    title: opts.basis === 'maturity' ? 'Maturity summary' : 'Start summary',
    note:
      opts.basis === 'maturity'
        ? 'What matures when: the amount put in and what it pays at maturity.'
        : 'What was booked when: the amount put in and what it will pay at maturity.',
    columns: [
      { key: 'period', label: what, kind: 'text' },
      ...FD_MONEY,
      {
        key: 'running',
        label: opts.basis === 'maturity' ? 'Maturity so far' : 'Amount so far',
        kind: 'money',
      },
    ],
    rows,
    total: { period: 'Grand total', ...total, running: null },
    ...(opts.basis === 'maturity'
      ? { chart: rows.map((r) => ({ label: String(r.period), value: Number(r.maturity) })) }
      : {}),
  };
}

export type FdBy = 'bank' | 'owner' | 'kind' | 'rate' | 'tenure';
export const FD_BY: { key: FdBy; label: string }[] = [
  { key: 'bank', label: 'Bank' },
  { key: 'owner', label: 'Person' },
  { key: 'kind', label: 'NRE / NRO' },
  { key: 'rate', label: 'Interest rate' },
  { key: 'tenure', label: 'Term' },
];
export const parseFdBy = (v: string | undefined): FdBy =>
  FD_BY.some((b) => b.key === v) ? (v as FdBy) : 'bank';

const daysBetweenIso = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The term in half-years: 400 days is 1 year, 800 days 2 years. */
const termYears = (f: ReportFd) =>
  Math.round((daysBetweenIso(f.bookedOn, f.maturityOn) / 365.25) * 2) / 2;

/** Deposits grouped by bank, person, NRE/NRO, rate or term: the amount, what it pays, the average rate and the share. */
export function fdBreakdown(fds: ReportFd[], by: FdBy): ReportTable {
  const label = (f: ReportFd): string =>
    by === 'bank'
      ? f.bank
      : by === 'owner'
        ? f.owner
        : by === 'kind'
          ? f.kind
          : by === 'rate'
            ? `${(f.rate * 100).toFixed(2)}%`
            : `${termYears(f) === 1 ? '1 year' : `${termYears(f)} years`}`;
  const groups = new Map<string, ReportFd[]>();
  for (const f of fds) groups.set(label(f), [...(groups.get(label(f)) ?? []), f]);
  const totalPrincipal = sum(fds.map((f) => f.principal));
  const avgRate = (list: ReportFd[]) => {
    const p = sum(list.map((f) => f.principal));
    return p > 0 ? sum(list.map((f) => f.principal * f.rate)) / p : null;
  };
  const rows = [...groups.entries()]
    .map(([name, list]) => ({
      group: name,
      ...aggFds(list),
      rate: avgRate(list),
      share: totalPrincipal > 0 ? sum(list.map((f) => f.principal)) / totalPrincipal : null,
      first: list.map((f) => f.maturityOn).sort()[0] ?? null,
      last:
        list
          .map((f) => f.maturityOn)
          .sort()
          .reverse()[0] ?? null,
    }))
    .sort((a, b) =>
      by === 'rate'
        ? parseFloat(b.group) - parseFloat(a.group)
        : by === 'tenure'
          ? parseFloat(a.group) - parseFloat(b.group)
          : b.principal - a.principal,
    ) as Record<string, Cell>[];
  const t = aggFds(fds);
  return {
    id: `fd-by-${by}`,
    title: `Deposits by ${FD_BY.find((b) => b.key === by)!.label.toLowerCase()}`,
    note: 'The average rate is weighted by the amount of each deposit.',
    columns: [
      { key: 'group', label: FD_BY.find((b) => b.key === by)!.label, kind: 'text' },
      ...FD_MONEY,
      { key: 'rate', label: 'Avg rate', kind: 'rate' },
      { key: 'share', label: 'Share', kind: 'pct' },
      { key: 'first', label: 'First maturity', kind: 'date' },
      { key: 'last', label: 'Last maturity', kind: 'date' },
    ],
    rows,
    total: {
      group: 'Grand total',
      ...t,
      rate: avgRate(fds),
      share: fds.length ? 1 : null,
      first: fds.map((f) => f.maturityOn).sort()[0] ?? null,
      last:
        fds
          .map((f) => f.maturityOn)
          .sort()
          .reverse()[0] ?? null,
    },
  };
}

/**
 * Interest by financial year, per person: what each deposit earns inside each year it is running (worked out from its rate and
 * dates, so a figure for a year not yet over is a projection). The tax on it is a separate matter: see the Tax page.
 */
export function fdInterestByFy(fds: ReportFd[], today: string): ReportTable {
  const owners = [...new Set(fds.map((f) => f.owner))].sort();
  const years = new Map<string, Map<string, number>>();
  const bounds = (fy: string) => fyBoundsOf(fy)!;
  const addDays = (d: string, n: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  for (const f of fds) {
    const startFy = fyOf(f.bookedOn);
    const endFy = fyOf(f.maturityOn);
    for (let y = Number(startFy.slice(0, 4)); y <= Number(endFy.slice(0, 4)); y++) {
      const fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
      const b = bounds(fy);
      const from = f.bookedOn > b.from ? f.bookedOn : b.from;
      const to = f.maturityOn < addDays(b.to, 1) ? f.maturityOn : addDays(b.to, 1);
      if (to <= from) continue;
      const value = (d: string) =>
        fdValueOn({
          principal: f.principal,
          annualRate: f.rate,
          bookedOn: new Date(`${f.bookedOn}T00:00:00Z`),
          asOf: new Date(`${d}T00:00:00Z`),
          maturityOn: new Date(`${f.maturityOn}T00:00:00Z`),
          compounding: f.compounding,
        });
      const interest = value(to) - value(from);
      const m = years.get(fy) ?? new Map<string, number>();
      m.set(f.owner, (m.get(f.owner) ?? 0) + interest);
      years.set(fy, m);
    }
  }
  const todayFy = fyOf(today);
  const rows = [...years.keys()].sort().map((fy) => {
    const m = years.get(fy)!;
    const row: Record<string, Cell> = {
      fy: `FY ${fy}`,
      basis: fy < todayFy ? 'earned' : fy === todayFy ? 'part earned, part to come' : 'projected',
    };
    for (const o of owners) row[`o:${o}`] = r2(m.get(o) ?? 0);
    row.total = r2(sum([...m.values()]));
    return row;
  });
  const total: Record<string, Cell> = { fy: 'Grand total', basis: null };
  for (const o of owners) total[`o:${o}`] = r2(sum(rows.map((r) => Number(r[`o:${o}`]))));
  total.total = r2(sum(rows.map((r) => Number(r.total))));
  return {
    id: 'fd-interest-fy',
    title: 'Interest by financial year',
    note: 'Worked out from each deposit’s rate and dates, so it can differ slightly from the bank’s certificate. The current and later years include interest still to come.',
    columns: [
      { key: 'fy', label: 'Financial year', kind: 'text' },
      { key: 'basis', label: 'Status', kind: 'text' },
      ...owners.map((o): Col => ({ key: `o:${o}`, label: o, kind: 'money' })),
      { key: 'total', label: 'Total', kind: 'money' },
    ],
    rows,
    total,
    chart: rows.map((r) => ({ label: String(r.fy), value: Number(r.total) })),
  };
}

// ------------------------------------------------------------------------------------------------
// Mutual funds
// ------------------------------------------------------------------------------------------------
export interface ReportTxn {
  date: string;
  kind: string;
  units: number;
  amount: number;
}

export interface ReportLot {
  acquiredOn: string;
  units: number;
  cost: number | null;
}

export interface ReportFund {
  id: string;
  name: string;
  owner: string;
  category: string;
  amc: string | null;
  value: number;
  invested: number;
  units: number | null;
  startedOn: string | null;
  xirr: number | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  txns: ReportTxn[];
  lots: ReportLot[];
  /** a statement or an export with transactions is on file for this fund */
  hasStatement: boolean;
}

export type FundBy = 'fund' | 'owner' | 'category' | 'amc' | 'start';
export const FUND_BY: { key: FundBy; label: string }[] = [
  { key: 'fund', label: 'Fund' },
  { key: 'owner', label: 'Person' },
  { key: 'category', label: 'Kind of fund' },
  { key: 'amc', label: 'Fund house' },
  { key: 'start', label: 'Start date' },
];
export const parseFundBy = (v: string | undefined): FundBy =>
  FUND_BY.some((b) => b.key === v) ? (v as FundBy) : 'fund';

const weightedXirr = (list: ReportFund[]) => {
  const w = list.filter((f) => f.xirr !== null && f.value > 0);
  const v = sum(w.map((f) => f.value));
  return v > 0 ? sum(w.map((f) => f.value * (f.xirr as number))) / v : null;
};

/**
 * Funds grouped by fund, person, kind of fund, fund house or the month/year they were started: money in, value, gain, return and
 * share, with a grand total. Start dates are bunched with `period`.
 */
export function fundSummary(
  funds: ReportFund[],
  by: FundBy,
  period: Period = 'month',
): ReportTable {
  const totalValue = sum(funds.map((f) => f.value));
  const key = (f: ReportFund): { key: string; label: string } =>
    by === 'fund'
      ? { key: f.id, label: f.name }
      : by === 'owner'
        ? { key: f.owner, label: f.owner }
        : by === 'category'
          ? { key: f.category, label: f.category }
          : by === 'amc'
            ? { key: f.amc ?? '~', label: f.amc ?? 'Not known' }
            : f.startedOn
              ? periodOf(f.startedOn, period === 'date' ? 'month' : period)
              : { key: '~', label: 'Start not known' };
  const groups = new Map<string, { label: string; list: ReportFund[] }>();
  for (const f of funds) {
    const k = key(f);
    const g = groups.get(k.key) ?? { label: k.label, list: [] };
    g.list.push(f);
    groups.set(k.key, g);
  }
  const order = [...groups.keys()].sort((a, b) =>
    by === 'start'
      ? a.localeCompare(b)
      : sum(groups.get(b)!.list.map((f) => f.value)) - sum(groups.get(a)!.list.map((f) => f.value)),
  );
  const line = (label: string, list: ReportFund[]): Record<string, Cell> => {
    const invested = r2(sum(list.map((f) => f.invested)));
    const value = r2(sum(list.map((f) => f.value)));
    return {
      group: label,
      count: list.length,
      invested,
      value,
      gain: r2(value - invested),
      gainPct: invested > 0 ? (value - invested) / invested : null,
      xirr: weightedXirr(list),
      share: totalValue > 0 ? value / totalValue : null,
    };
  };
  const rows = order.map((k) => {
    const g = groups.get(k)!;
    const row = line(g.label, g.list);
    if (by === 'fund') {
      const f = g.list[0]!;
      row.owner = f.owner;
      row.started = f.startedOn;
      row.units = f.units;
      row.category = f.category;
    }
    return row;
  });
  const cols: Col[] =
    by === 'fund'
      ? [
          { key: 'group', label: 'Fund', kind: 'text' },
          { key: 'owner', label: 'Person', kind: 'text' },
          { key: 'category', label: 'Kind', kind: 'text' },
          { key: 'started', label: 'Started', kind: 'date' },
        ]
      : [
          { key: 'group', label: FUND_BY.find((b) => b.key === by)!.label, kind: 'text' },
          { key: 'count', label: 'Funds', kind: 'int' },
        ];
  return {
    id: `mf-by-${by}`,
    title: `Funds by ${FUND_BY.find((b) => b.key === by)!.label.toLowerCase()}`,
    note: 'Invested is the money still in the fund (sold units take their share of cost with them). XIRR is the average of the funds, weighted by value.',
    columns: [
      ...cols,
      { key: 'invested', label: 'Invested', kind: 'money' },
      { key: 'value', label: 'Value now', kind: 'money' },
      { key: 'gain', label: 'Gain', kind: 'money' },
      { key: 'gainPct', label: 'Gain %', kind: 'pct' },
      { key: 'xirr', label: 'XIRR', kind: 'pct' },
      { key: 'share', label: 'Share', kind: 'pct' },
    ],
    rows,
    total: { ...line('Grand total', funds), ...(by === 'fund' ? { count: funds.length } : {}) },
    ...(by === 'start'
      ? { chart: rows.map((r) => ({ label: String(r.group), value: Number(r.invested) })) }
      : {}),
  };
}

/** SIPs: the monthly amount, when it started, how long it has run and what has been paid in instalments. */
export function sipTable(funds: ReportFund[], today: string): ReportTable {
  const monthsBetween = (from: string, to: string) => {
    let m =
      (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
    if (to.slice(8, 10) < from.slice(8, 10)) m -= 1;
    return Math.max(0, m);
  };
  const rows = funds
    .filter((f) => (f.sipMonthly ?? 0) > 0 || f.txns.some((t) => t.kind === 'sip'))
    .map((f) => {
      const sips = f.txns
        .filter((t) => t.kind === 'sip' && t.units > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      const first = sips[0]?.date ?? f.startedOn;
      const last = sips[sips.length - 1]?.date ?? null;
      const running = (f.sipMonthly ?? 0) > 0 && !f.sipStopped;
      const end = running ? today : (last ?? today);
      return {
        fund: f.name,
        owner: f.owner,
        monthly: f.sipMonthly,
        status: running ? 'Running' : f.sipStopped ? 'Stopped' : 'Not set',
        first,
        last,
        months: first && first <= end ? monthsBetween(first, end) : null,
        instalments: sips.length > 0 ? sips.length : null,
        paid: sips.length > 0 ? r2(sum(sips.map((t) => Math.abs(t.amount)))) : null,
        value: f.value,
      } as Record<string, Cell>;
    })
    .sort(
      (a, b) =>
        String(a.status).localeCompare(String(b.status)) ||
        Number(b.monthly ?? 0) - Number(a.monthly ?? 0),
    );
  const running = rows.filter((r) => r.status === 'Running');
  return {
    id: 'mf-sip',
    title: 'SIP summary',
    note: 'Paid and instalments come from fund statements or exports; a fund without them shows a dash.',
    columns: [
      { key: 'fund', label: 'Fund', kind: 'text' },
      { key: 'owner', label: 'Person', kind: 'text' },
      { key: 'monthly', label: 'Per month', kind: 'money' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'first', label: 'First instalment', kind: 'date' },
      { key: 'last', label: 'Latest instalment', kind: 'date' },
      { key: 'months', label: 'Months', kind: 'int' },
      { key: 'instalments', label: 'Instalments', kind: 'int' },
      { key: 'paid', label: 'Paid so far', kind: 'money' },
      { key: 'value', label: 'Value now', kind: 'money' },
    ],
    rows,
    total: {
      fund: `Grand total (${running.length} running)`,
      owner: null,
      monthly: r2(sum(running.map((r) => Number(r.monthly ?? 0)))),
      status: null,
      first: null,
      last: null,
      months: null,
      instalments: null,
      paid: r2(sum(rows.map((r) => Number(r.paid ?? 0)))),
      value: r2(sum(rows.map((r) => Number(r.value)))),
    },
  };
}

/** Money in and out by month or year, from the transactions on file. */
export function fundFlow(funds: ReportFund[], period: Period): ReportTable {
  const p = period === 'date' ? 'month' : period;
  const groups = new Map<
    string,
    { label: string; sip: number; lump: number; out: number; withTxns: Set<string> }
  >();
  for (const f of funds)
    for (const t of f.txns) {
      if (t.units === 0 || t.amount === 0) continue;
      const k = periodOf(t.date, p);
      const g = groups.get(k.key) ?? {
        label: k.label,
        sip: 0,
        lump: 0,
        out: 0,
        withTxns: new Set<string>(),
      };
      const a = Math.abs(t.amount);
      if (t.units < 0) g.out += a;
      else if (t.kind === 'sip') g.sip += a;
      else g.lump += a;
      g.withTxns.add(f.id);
      groups.set(k.key, g);
    }
  const rows = [...groups.keys()].sort().map((k) => {
    const g = groups.get(k)!;
    return {
      period: g.label,
      sip: r2(g.sip),
      lump: r2(g.lump),
      out: r2(g.out),
      net: r2(g.sip + g.lump - g.out),
      funds: g.withTxns.size,
    } as Record<string, Cell>;
  });
  const missing = funds.filter((f) => !f.hasStatement).length;
  return {
    id: 'mf-flow',
    title: 'Money in and out',
    note: `From the transactions on file${missing > 0 ? `; ${missing} fund${missing === 1 ? ' has' : 's have'} none yet, so ${missing === 1 ? 'it is' : 'they are'} not counted` : ''}. Import a statement or export on the Import page to complete it.`,
    columns: [
      {
        key: 'period',
        label:
          p === 'month'
            ? 'Month'
            : p === 'fy'
              ? 'Financial year'
              : p === 'quarter'
                ? 'Quarter'
                : 'Year',
        kind: 'text',
      },
      { key: 'sip', label: 'SIP', kind: 'money' },
      { key: 'lump', label: 'One-time buys', kind: 'money' },
      { key: 'out', label: 'Sold', kind: 'money' },
      { key: 'net', label: 'Net invested', kind: 'money' },
      { key: 'funds', label: 'Funds', kind: 'int' },
    ],
    rows,
    total: {
      period: 'Grand total',
      sip: r2(sum(rows.map((r) => Number(r.sip)))),
      lump: r2(sum(rows.map((r) => Number(r.lump)))),
      out: r2(sum(rows.map((r) => Number(r.out)))),
      net: r2(sum(rows.map((r) => Number(r.net)))),
      funds: null,
    },
    chart: rows.map((r) => ({ label: String(r.period), value: Number(r.net) })),
  };
}

/**
 * How long the units held have been held: value of the units bought in each age band, per fund. `longMonths` is the period after
 * which equity-fund units are long-term (from the tax rules); the bands are one year each up to that and "longer" after.
 */
export function fundAge(
  funds: ReportFund[],
  today: string,
  longMonths: number | null,
): ReportTable {
  const monthsOld = (d: string) => {
    let m =
      (Number(today.slice(0, 4)) - Number(d.slice(0, 4))) * 12 +
      (Number(today.slice(5, 7)) - Number(d.slice(5, 7)));
    if (today.slice(8, 10) < d.slice(8, 10)) m -= 1;
    return Math.max(0, m);
  };
  const step = 12;
  const edge = Math.max(step, Math.ceil((longMonths ?? 12) / step) * step);
  const bands: { key: string; label: string; lo: number; hi: number }[] = [];
  for (let lo = 0; lo < edge; lo += step)
    bands.push({
      key: `b${lo}`,
      label: lo === 0 ? `Under ${step / 12} year` : `${lo / 12}–${(lo + step) / 12} years`,
      lo,
      hi: lo + step,
    });
  bands.push({
    key: 'bl',
    label: `${edge / 12} ${edge === 12 ? 'year' : 'years'} or more`,
    lo: edge,
    hi: Infinity,
  });
  const rows: Record<string, Cell>[] = [];
  for (const f of funds) {
    const lots = f.lots.filter((l) => l.units > 0 && l.acquiredOn > '1900-01-01');
    const units = sum(f.lots.filter((l) => l.units > 0).map((l) => l.units));
    const unit = units > 0 ? f.value / units : 0;
    if (unit === 0) continue;
    const row: Record<string, Cell> = { fund: f.name, owner: f.owner };
    let known = 0;
    for (const b of bands) {
      const v = sum(
        lots
          .filter((l) => monthsOld(l.acquiredOn) >= b.lo && monthsOld(l.acquiredOn) < b.hi)
          .map((l) => l.units * unit),
      );
      row[b.key] = r2(v);
      known += v;
    }
    row.before = r2(Math.max(0, f.value - known));
    row.total = r2(f.value);
    rows.push(row);
  }
  const total: Record<string, Cell> = { fund: 'Grand total', owner: null };
  for (const k of [...bands.map((b) => b.key), 'before', 'total'])
    total[k] = r2(sum(rows.map((r) => Number(r[k] ?? 0))));
  return {
    id: 'mf-age',
    title: 'How long the units have been held',
    note: 'Value today of the units bought in each age band. “Before the statement” are units whose purchase date is not on file. Lots are from statements or, where marked on the Breakdown tab, estimated.',
    columns: [
      { key: 'fund', label: 'Fund', kind: 'text' },
      { key: 'owner', label: 'Person', kind: 'text' },
      ...bands.map((b): Col => ({ key: b.key, label: b.label, kind: 'money' })),
      { key: 'before', label: 'Date not known', kind: 'money' },
      { key: 'total', label: 'Value now', kind: 'money' },
    ],
    rows,
    total,
  };
}

// ------------------------------------------------------------------------------------------------
// Export
// ------------------------------------------------------------------------------------------------
/** The table as CSV text: numbers as plain numbers, rates and shares as percentages with two decimals. */
export function tableToCsv(t: ReportTable): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cell = (c: Col, v: Cell) =>
    v === null || v === undefined
      ? ''
      : c.kind === 'pct' || c.kind === 'rate'
        ? (Number(v) * 100).toFixed(2)
        : String(v);
  const head = t.columns
    .map((c) => esc(c.kind === 'pct' || c.kind === 'rate' ? `${c.label} (%)` : c.label))
    .join(',');
  const body = [...t.rows, ...(t.total ? [t.total] : [])].map((r) =>
    t.columns.map((c) => esc(cell(c, r[c.key] ?? null))).join(','),
  );
  return [head, ...body].join('\n');
}
