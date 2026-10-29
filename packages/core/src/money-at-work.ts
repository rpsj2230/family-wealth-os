/**
 * Money at work: what each holding earns now, which money is not growing or growing slower than prices rise, what could make it grow,
 * and the corpus everything grows to, year by year, if it keeps growing at the same pace (and at a slower, faster or improved pace).
 *
 *  - The rate a holding earns now: a deposit's own rate; a savings account's rate (its own, else the rates list for its bank, kind and
 *    balance); a fund's own yearly return (XIRR); an assumed growth from Settings for property, retirement accounts and other
 *    holdings; nothing for money lent, money held by someone else and cash in another currency with no rate.
 *  - After tax: interest on NRO money loses the tax deducted at source (Settings → rates); NRE interest is tax-free. Fund gains are
 *    taxed only when sold, so they are not reduced here.
 *  - Grouped against inflation (the retirement plan's): not growing (no return), slow (below inflation after tax), growing (above
 *    it), growing well (above it by the margin in Settings).
 *  - Suggestions come from the rates list (rates.ts): a deposit or savings balance that would earn clearly more elsewhere, inside the
 *    insurance limit and keeping the savings buffer; a fund whose own return is below inflation; money that earns nothing.
 *  - The projection compounds each holding at its own after-tax rate once a year (interest added back, never taken out), adds the
 *    SIPs running today (raised each year by the plan's step-up), and shows the same in today's rupees (after inflation). The
 *    slower and faster lines move every growing holding's rate by the same points; money that earns nothing stays at nothing.
 *    "If the slow money is moved" applies the suggestions from today.
 * Pure: no I/O. Nothing here moves money.
 */

export type WorkKind = 'cash' | 'fd' | 'funds' | 'others';
export type WorkBucket = 'idle' | 'slow' | 'growing' | 'good';

export interface WorkHoldingIn {
  id: string;
  name: string;
  ownerId: string;
  owner: string;
  kind: WorkKind;
  /** a short word for the type: "Savings", "Fixed deposit", "Mutual fund", "Property", ... */
  type: string;
  bank: string | null;
  value: number;
  /** the yearly rate it earns now, before tax */
  rate: number;
  /** where the rate comes from, in words */
  rateBasis: string;
  /** the share of each year's growth lost to tax (NRO interest); 0 when none */
  taxRate: number;
  /** money added each month (a running SIP) */
  monthly: number;
}

export interface WorkHolding extends WorkHoldingIn {
  /** after tax */
  netRate: number;
  /** after tax and inflation */
  realRate: number;
  bucket: WorkBucket;
  /** rupees a year by which it falls behind prices (0 when it keeps up) */
  lostToInflation: number;
}

/** A move that would make a holding grow faster: the amount, from and to, and the rate after tax on each side. */
export interface WorkMove {
  holdingId: string;
  amount: number;
  fromRate: number;
  toRate: number;
  annualGain: number;
  text: string;
}

export interface WorkNote {
  holdingId: string;
  text: string;
}

export interface MoneyAtWork {
  inflation: number;
  rows: WorkHolding[];
  buckets: Record<WorkBucket, { value: number; count: number }>;
  total: number;
  /** after tax, weighted by value */
  paceNet: number;
  lostToInflation: number;
  moves: WorkMove[];
  notes: WorkNote[];
  movesGain: number;
}

const BUCKET_ORDER: Record<WorkBucket, number> = { idle: 0, slow: 1, growing: 2, good: 3 };
const pct = (r: number) => `${(Math.round(r * 1000) / 10).toFixed(1)}%`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function workBucketOf(netRate: number, inflation: number, goodMargin: number): WorkBucket {
  if (netRate <= 0.0005) return 'idle';
  if (netRate < inflation) return 'slow';
  if (netRate < inflation + goodMargin) return 'growing';
  return 'good';
}

export function moneyAtWork(input: {
  holdings: WorkHoldingIn[];
  inflation: number;
  goodMargin: number;
  /** better places for deposits and savings (rates.ts compareHoldings, worded for this page) */
  moves: WorkMove[];
}): MoneyAtWork {
  const { inflation } = input;
  const rows: WorkHolding[] = input.holdings
    .filter((h) => h.value > 0)
    .map((h) => {
      const netRate = h.rate * (1 - h.taxRate);
      const realRate = (1 + netRate) / (1 + inflation) - 1;
      return {
        ...h,
        netRate,
        realRate,
        bucket: workBucketOf(netRate, inflation, input.goodMargin),
        lostToInflation: Math.max(0, h.value * (inflation - netRate)),
      };
    })
    .sort(
      (a, b) =>
        BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
        a.netRate - b.netRate ||
        b.value - a.value,
    );
  const buckets: MoneyAtWork['buckets'] = {
    idle: { value: 0, count: 0 },
    slow: { value: 0, count: 0 },
    growing: { value: 0, count: 0 },
    good: { value: 0, count: 0 },
  };
  for (const r of rows) {
    buckets[r.bucket].value += r.value;
    buckets[r.bucket].count += 1;
  }
  const total = rows.reduce((a, r) => a + r.value, 0);
  const ids = new Set(rows.map((r) => r.id));
  const moves = input.moves.filter((m) => ids.has(m.holdingId) && m.amount > 0);
  const moved = new Set(moves.map((m) => m.holdingId));
  const notes: WorkNote[] = [];
  for (const r of rows) {
    if (moved.has(r.id) || (r.bucket !== 'idle' && r.bucket !== 'slow')) continue;
    if (r.kind === 'funds')
      notes.push({
        holdingId: r.id,
        text: `${r.owner}: ${r.name} has returned ${pct(r.rate)} a year, below inflation (${pct(inflation)}). Compare it with its category or an index fund before adding more; switching is a sale (tax and any exit load apply).`,
      });
    else if (r.bucket === 'idle')
      notes.push({
        holdingId: r.id,
        text: `${r.owner}: ${r.name} (${inr(r.value)}) earns nothing${r.kind === 'others' ? '' : ' at present'}. ${
          r.type === 'Money lent'
            ? 'Agree a date for it to come back, then place it.'
            : r.kind === 'cash'
              ? 'Keep only what you need to hand; place the rest where it earns interest.'
              : 'If it can be placed, it would start to grow.'
        }`,
      });
    else if (r.kind === 'cash' || r.kind === 'fd')
      notes.push({
        holdingId: r.id,
        text: `${r.owner}: ${r.name} earns ${pct(r.netRate)} after tax, below inflation (${pct(inflation)}), and no listed bank pays clearly more for it. Check the Rates page after the next refresh.`,
      });
  }
  return {
    inflation,
    rows,
    buckets,
    total,
    paceNet: total > 0 ? rows.reduce((a, r) => a + r.value * r.netRate, 0) / total : 0,
    lostToInflation: rows.reduce((a, r) => a + r.lostToInflation, 0),
    moves,
    notes,
    movesGain: moves.reduce((a, m) => a + m.annualGain, 0),
  };
}

// ------------------------------------------------------------------------------------------------
// The corpus, year by year
// ------------------------------------------------------------------------------------------------

export interface GrowthLine {
  key: string;
  label: string;
  /** the after-tax pace of today's money on this line (weighted by value), as shown in its label */
  pace: number;
  /** points moved from the same pace (0 for the same pace and for the improved line) */
  shift: number;
  values: number[];
}

export interface GrowthYear {
  /** 0 is today */
  year: number;
  calendarYear: number;
  ages: (number | null)[];
  /** the same pace: money added that year and what it grew by, and the corpus by kind at the year end */
  added: number;
  growth: number;
  byKind: Record<WorkKind, number>;
  /** the same pace in today's rupees */
  real: number;
}

export interface GrowthProjection {
  years: number;
  inflation: number;
  stepUp: number;
  lines: GrowthLine[];
  table: GrowthYear[];
  /** the SIPs running today, a month */
  monthlyNow: number;
  /** the funds' own past return (XIRR), weighted by value: what the same pace uses for them; null with no funds */
  fundsPace: number | null;
}

interface Slot {
  kind: WorkKind;
  value: number;
  rate: number;
  taxRate: number;
  monthly: number;
  /** money that earns nothing stays at nothing on the slower and faster lines */
  grows: boolean;
}

function slotsOf(rows: WorkHolding[], moves: WorkMove[] | null): Slot[] {
  const out: Slot[] = [];
  for (const r of rows) {
    const m = moves?.find((x) => x.holdingId === r.id) ?? null;
    const keep = m ? Math.max(0, r.value - m.amount) : r.value;
    out.push({
      kind: r.kind,
      value: keep,
      rate: r.rate,
      taxRate: r.taxRate,
      monthly: r.monthly,
      grows: r.rate > 0,
    });
    if (m && m.amount > 0)
      // the moved money earns the new rate (already after tax)
      out.push({
        kind: 'fd',
        value: Math.min(m.amount, r.value),
        rate: m.toRate,
        taxRate: 0,
        monthly: 0,
        grows: true,
      });
  }
  return out;
}

function runSlots(
  slots: Slot[],
  years: number,
  shift: number,
  stepUp: number,
): {
  values: number[];
  perYear: { added: number; growth: number; byKind: Record<WorkKind, number> }[];
} {
  const v = slots.map((s) => s.value);
  const values = [v.reduce((a, x) => a + x, 0)];
  const perYear: { added: number; growth: number; byKind: Record<WorkKind, number> }[] = [];
  for (let y = 1; y <= years; y++) {
    let added = 0;
    let growth = 0;
    const byKind: Record<WorkKind, number> = { cash: 0, fd: 0, funds: 0, others: 0 };
    slots.forEach((s, i) => {
      const gross = s.grows ? Math.max(0, s.rate + shift) : 0;
      const g = gross * (1 - s.taxRate);
      const add = s.monthly * 12 * Math.pow(1 + stepUp, y - 1);
      // a year's instalments go in through the year: on average half a year of growth
      const grew = v[i]! * g + add * (g / 2);
      v[i] = v[i]! + grew + add;
      added += add;
      growth += grew;
      byKind[s.kind] += v[i]!;
    });
    values.push(v.reduce((a, x) => a + x, 0));
    perYear.push({ added, growth, byKind });
  }
  return { values, perYear };
}

const paceOf = (slots: Slot[], shift: number) => {
  const total = slots.reduce((a, s) => a + s.value, 0);
  return total > 0
    ? slots.reduce(
        (a, s) => a + s.value * (s.grows ? Math.max(0, s.rate + shift) : 0) * (1 - s.taxRate),
        0,
      ) / total
    : 0;
};

const ageIn = (dob: string | null, year: number): number | null => {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  return year - Number(dob.slice(0, 4));
};

export function projectGrowth(input: {
  work: MoneyAtWork;
  years: number;
  /** the slower and faster lines, in points (Settings → growth) */
  steps: number[];
  /** SIPs are raised by this much each year (the retirement plan's step-up) */
  stepUp: number;
  today: string;
  /** dates of birth, for the age columns (primary, spouse) */
  dobs: (string | null)[];
  /** the long-run fund return of the retirement plan: a line with every fund at it instead of its own past return */
  longRunFundRate?: number;
}): GrowthProjection {
  const { work, years, stepUp } = input;
  const base = slotsOf(work.rows, null);
  const improved = slotsOf(work.rows, work.moves);
  const same = runSlots(base, years, 0, stepUp);
  const funds = work.rows.filter((r) => r.kind === 'funds');
  const fundsValue = funds.reduce((a, r) => a + r.value, 0);
  const fundsPace =
    fundsValue > 0 ? funds.reduce((a, r) => a + r.value * r.rate, 0) / fundsValue : null;
  const lines: GrowthLine[] = [
    {
      key: 'same',
      label:
        fundsPace === null
          ? 'Same pace'
          : `Same pace, funds at their actual past return (${pct(fundsPace)})`,
      pace: paceOf(base, 0),
      shift: 0,
      values: same.values,
    },
  ];
  if (fundsPace !== null) {
    // savings and deposits grown at the funds' own past return too, as if they were invested like the funds (taxed only when sold);
    // property, retirement accounts and money lent keep their own pace
    const allFunds = base.map((x) =>
      x.kind === 'cash' || x.kind === 'fd' || x.kind === 'funds'
        ? { ...x, rate: fundsPace, taxRate: 0, grows: fundsPace > 0 }
        : x,
    );
    lines.push({
      key: 'allfunds',
      label: `Savings and deposits too at the funds’ actual past return (${pct(fundsPace)})`,
      pace: paceOf(allFunds, 0),
      shift: 0,
      values: runSlots(allFunds, years, 0, stepUp).values,
    });
  }
  if (input.longRunFundRate !== undefined && fundsPace !== null) {
    // the same holdings, with every fund growing at the plan's long-run return instead of its own past one
    const longRun = base.map((x) =>
      x.kind === 'funds'
        ? { ...x, rate: input.longRunFundRate!, grows: input.longRunFundRate! > 0 }
        : x,
    );
    lines.push({
      key: 'longrun',
      label: `Funds at the long-run return (${pct(input.longRunFundRate)})`,
      pace: paceOf(longRun, 0),
      shift: 0,
      values: runSlots(longRun, years, 0, stepUp).values,
    });
  }
  for (const s of [...input.steps].sort((a, b) => b - a)) {
    lines.push({
      key: `slower-${s}`,
      label: `${Math.round(s * 1000) / 10}% slower`,
      pace: paceOf(base, -s),
      shift: -s,
      values: runSlots(base, years, -s, stepUp).values,
    });
  }
  for (const s of [...input.steps].sort((a, b) => a - b)) {
    lines.push({
      key: `faster-${s}`,
      label: `${Math.round(s * 1000) / 10}% faster`,
      pace: paceOf(base, s),
      shift: s,
      values: runSlots(base, years, s, stepUp).values,
    });
  }
  if (work.moves.length > 0)
    lines.push({
      key: 'moved',
      label: 'If the slow money is moved',
      pace: paceOf(improved, 0),
      shift: 0,
      values: runSlots(improved, years, 0, stepUp).values,
    });
  const startYear = Number(input.today.slice(0, 4));
  const table: GrowthYear[] = same.values.map((value, y) => ({
    year: y,
    calendarYear: startYear + y,
    ages: input.dobs.map((d) => ageIn(d, startYear + y)),
    added: y === 0 ? 0 : same.perYear[y - 1]!.added,
    growth: y === 0 ? 0 : same.perYear[y - 1]!.growth,
    byKind:
      y === 0
        ? base.reduce((a, s) => ({ ...a, [s.kind]: a[s.kind] + s.value }), {
            cash: 0,
            fd: 0,
            funds: 0,
            others: 0,
          } as Record<WorkKind, number>)
        : same.perYear[y - 1]!.byKind,
    real: value / Math.pow(1 + work.inflation, y),
  }));
  return {
    years,
    inflation: work.inflation,
    stepUp,
    lines,
    table,
    monthlyNow: work.rows.reduce((a, r) => a + r.monthly, 0),
    fundsPace,
  };
}

/** A rates.ts suggestion as a move on this page: the words say what to do and what it adds a year. */
export function moveFromSuggestion(s: {
  assetId: string;
  ownerName: string;
  from: string;
  to: string;
  product: 'savings' | 'fd';
  amount: number;
  currentRate: number;
  newRate: number;
  annualGain: number;
  when: 'now' | 'at_maturity' | 'matured';
  on: string | null;
  toProduct?: 'savings' | 'fd';
}): WorkMove {
  const where =
    (s.toProduct ?? s.product) === 'fd' ? `a deposit at ${s.to}` : `a savings account at ${s.to}`;
  const when =
    s.when === 'at_maturity' && s.on
      ? `When it matures on ${s.on}, move`
      : s.when === 'matured'
        ? 'It has matured: move'
        : 'Move';
  return {
    holdingId: s.assetId,
    amount: s.amount,
    fromRate: s.currentRate,
    toRate: s.newRate,
    annualGain: s.annualGain,
    text: `${s.ownerName}: ${when} ${inr(s.amount)} from ${s.from} (${pct(s.currentRate)} after tax) to ${where} (${pct(s.newRate)} after tax): about ${inr(s.annualGain)} more a year.`,
  };
}
