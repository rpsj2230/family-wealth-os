/**
 * What the detail pages show, worked out from plain rows. Pure: the loaders fetch the rows, the pages and the public sample
 * only draw what this returns, so the same figures appear everywhere and are tested without a database.
 */
import {
  describeAudit,
  fdInterestForFy,
  fdValueOn,
  fyBounds,
  formatInr,
  returnsFor,
  sourceTag,
  type FdForFiling,
} from '@fwos/core';
import { fifoLots, type CasTxn } from '@fwos/ingest';
import type { ActivityItem } from '@/components/ActivityLog';
import type { DetailTableData } from '@/components/DetailTable';
import type { Fact } from '@/components/AssetFacts';

export interface ObsIn {
  id: string;
  amount: number;
  currency: string;
  fx_rate: number | null;
  as_of: string;
  confidence: string;
  source: string;
  note: string | null;
  created_at: string;
  superseded_by: string | null;
}

export interface AssetViewInput {
  today: string;
  asset: {
    id: string;
    type: string;
    nickname: string;
    label: string | null;
    status: string;
    currency: string;
    account_kind: string | null;
    is_joint: boolean | null;
    identifier_last4: string | null;
    linked_last4: string | null;
    notes: string | null;
    holder_name: string | null;
  };
  ownerName: string;
  bankName: string | null;
  /** the code as written in the sheet (cash and deposits) */
  code: string | null;
  current: {
    amount: number | null;
    basis: string | null;
    ageDays: number | null;
    asOf: string | null;
  };
  observations: ObsIn[];
  fd: {
    principal: number;
    rate: number;
    booked_on: string;
    maturity_on: string;
    compounding: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'simple';
    bank_maturity_amount: number | null;
    fd_ref_last4: string | null;
  } | null;
  position: {
    fund_name: string;
    invested: number;
    started_on: string | null;
    sip_monthly: number | null;
    sip_stopped: boolean;
    folio_last4: string | null;
    isin: string | null;
    amfi_code: string | null;
    plan_type: string;
  } | null;
  txns: {
    id?: string;
    txn_on: string;
    kind: string;
    amount: number;
    units: number;
    nav: number | null;
    balance_units: number | null;
    description: string | null;
  }[];
  navs: { nav_date: string; nav: number }[];
  receivable: {
    counterparty: string;
    lent: number;
    lent_on: string | null;
    expected_on: string | null;
    interest_note: string | null;
  } | null;
  payments: { amount: number; paid_on: string; note: string | null }[];
  goalNames: string[];
  linked: { id: string; label: string } | null;
  /** the rate a savings account earns today and where that figure comes from */
  rateInfo?: { rate: number; tag: 'own' | 'market' | 'assumed'; note: string } | null;
  /** the best NRE fixed deposit on offer right now, from the rates on file */
  market?: { bank: string; rate: number; tenure: string; checkedOn: string } | null;
  /** the person's other accounts at the same bank */
  related?: { id: string; label: string; value: number | null }[];
}

export interface Kpi {
  label: string;
  value: string;
  note?: string | undefined;
  tone?: 'gain' | 'fail' | undefined;
}

export interface AssetView {
  title: string;
  subtitle: string;
  headline: string | null;
  headlineNote: string | null;
  facts: Fact[];
  charts: {
    title: string;
    label: string;
    money: boolean;
    points: { date: string; value: number }[];
  }[];
  tables: DetailTableData[];
  /** the few figures that matter most, shown as tiles under the heading */
  kpis: Kpi[];
  /** where a deposit is between its start and its maturity */
  progress: {
    title: string;
    from: string;
    to: string;
    pct: number;
    caption: string;
    /** the date of the pointer on the bar */
    today: string;
  } | null;
  related: { label: string; href: string; value: string }[];
}

const TYPE_LABEL: Record<string, string> = {
  bank_account: 'Savings or current account',
  fixed_deposit: 'Fixed deposit',
  mutual_fund: 'Mutual fund',
  stock: 'Shares',
  receivable: 'Money lent',
  policy: 'Policy',
  property: 'Property',
  ulip: 'ULIP or pension plan',
  nps: 'NPS',
  third_party_held: 'Held by someone else',
  other: 'Other holding',
};
const BASIS: Record<string, string> = {
  calculated: 'worked out from contract terms or units',
  estimated: 'estimated from the last recorded value',
  carried_forward: 'last recorded value, carried forward',
};
const STATUS: Record<string, string> = {
  active: 'Active',
  matured: 'Matured',
  matured_unconfirmed: 'Matured, not yet confirmed',
  renewed: 'Renewed',
  closed: 'Closed',
  stopped: 'Stopped',
};
const KIND: Record<string, string> = {
  purchase: 'Purchase',
  sip: 'SIP instalment',
  switch_in: 'Switch in',
  switch_out: 'Switch out',
  dividend_reinvest: 'Dividend reinvested',
  bonus: 'Bonus units',
  redeem: 'Sale',
  other: 'Other',
};
const CONF: Record<string, string> = {
  verified: 'Verified',
  manual_confirmed: 'Confirmed by you',
  imported_unverified: 'Imported, not verified',
  estimated: 'Estimate',
};

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '–' : formatInr(Math.round(n));
const num = (n: number | null | undefined, d = 3) =>
  n === null || n === undefined ? '–' : n.toLocaleString('en-IN', { maximumFractionDigits: d });
const pct = (r: number) => `${(r * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const daysBetween = (a: string, b: string) =>
  Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

const inrOf = (o: ObsIn) => o.amount * (o.fx_rate ?? 1);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;

/** All recorded values, newest first; replaced ones are dimmed. */
export function observationsTable(obs: ObsIn[], assetId?: string): DetailTableData {
  const sorted = [...obs].sort(
    (a, b) => b.as_of.localeCompare(a.as_of) || b.created_at.localeCompare(a.created_at),
  );
  // the change from the value before it (counting only values still in use)
  const used = sorted.filter((o) => !o.superseded_by);
  const before = new Map<string, number>();
  used.forEach((o, i) => {
    const prev = used[i + 1];
    if (prev) before.set(o.id, inrOf(o) - inrOf(prev));
  });
  return {
    title: 'Recorded values',
    hint: 'Every balance recorded for this item. A value that was later replaced is shown dimmed and is not used.',
    columns: ['Date', 'Amount', 'In rupees', 'Change', 'Source', 'Confidence', 'Note', 'Used'],
    numeric: [1, 2, 3],
    rows: sorted.map((o) => ({
      dim: !!o.superseded_by,
      ...(assetId ? { href: `/asset/${assetId}/reading/${o.id}` } : {}),
      cells: [
        o.as_of,
        o.currency === 'INR' ? inr(o.amount) : `${o.currency} ${num(o.amount, 2)}`,
        inr(inrOf(o)),
        before.has(o.id) ? signed(before.get(o.id)!) : '–',
        sourceTag(o.source, o.as_of, false).label,
        CONF[o.confidence] ?? o.confidence.replace(/_/g, ' '),
        o.note ?? '',
        o.superseded_by ? 'Replaced' : 'Yes',
      ],
    })),
    empty: 'No values have been recorded for this item yet.',
  };
}

function monthPoints(from: string, to: string, cap = 150): string[] {
  const out: string[] = [];
  const d = utc(from);
  const end = utc(to);
  while (d <= end && out.length < cap) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  if (out[out.length - 1] !== to) out.push(to);
  return out;
}

function fdTable(i: AssetViewInput): DetailTableData | null {
  const fd = i.fd;
  if (!fd) return null;
  const k = i.asset.account_kind;
  const filing: FdForFiling = {
    id: i.asset.id,
    ownerId: 'x',
    bank: i.bankName ?? '',
    nickname: i.asset.nickname,
    kind: k === 'NRE' || k === 'NRO' ? k : k === 'joint' ? 'joint' : 'unknown',
    principal: fd.principal,
    rate: fd.rate,
    bookedOn: fd.booked_on,
    maturityOn: fd.maturity_on,
    compounding: fd.compounding,
  };
  const rows: DetailTableData['rows'] = [];
  const startYear =
    Number(fd.booked_on.slice(5, 7)) >= 4
      ? Number(fd.booked_on.slice(0, 4))
      : Number(fd.booked_on.slice(0, 4)) - 1;
  const endYear =
    Number(fd.maturity_on.slice(5, 7)) >= 4
      ? Number(fd.maturity_on.slice(0, 4))
      : Number(fd.maturity_on.slice(0, 4)) - 1;
  for (let y = startYear; y <= Math.min(endYear, startYear + 30); y++) {
    const fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    try {
      fyBounds(fy);
    } catch {
      continue;
    }
    const l = fdInterestForFy(filing, fy);
    if (!l) continue;
    const future = l.to > i.today;
    rows.push({
      dim: future,
      cells: [
        `FY ${fy}${future ? ' (to come)' : ''}`,
        l.from,
        l.to,
        inr(l.interest),
        l.taxable === 'yes'
          ? 'Taxable in India'
          : l.taxable === 'exempt_nre'
            ? 'Exempt (NRE)'
            : 'Check account type',
      ],
    });
  }
  return {
    title: 'Interest by financial year',
    hint: 'Worked out from the rate, dates and quarterly compounding; your bank certificate can differ slightly.',
    columns: ['Year', 'From', 'To', 'Interest', 'Treatment'],
    numeric: [3],
    rows,
  };
}

function fundTables(i: AssetViewInput, value: number | null) {
  const tables: DetailTableData[] = [];
  const txns = [...i.txns].sort((a, b) => a.txn_on.localeCompare(b.txn_on));
  tables.push({
    title: 'Transactions',
    hint: 'From the fund statements you imported. Newest first.',
    columns: ['Date', 'Kind', 'Amount', 'Units', 'Price (NAV)', 'Units held after'],
    numeric: [2, 3, 4, 5],
    rows: [...txns].reverse().map((t) => ({
      ...(t.id ? { href: `/asset/${i.asset.id}/txn/${t.id}` } : {}),
      cells: [
        t.txn_on,
        KIND[t.kind] ?? t.kind,
        inr(Math.abs(t.amount)),
        num(t.units),
        num(t.nav, 4),
        num(t.balance_units),
      ],
    })),
    empty:
      'No fund statement has been imported for this fund yet. Import one under Import to see every purchase and sale here.',
  });
  if (txns.length > 0) {
    const first = txns[0]!;
    const last = txns[txns.length - 1]!;
    const prior = first.balance_units !== null ? Math.max(0, first.balance_units - first.units) : 0;
    const casTx: CasTxn[] = txns.map((t) => ({
      date: t.txn_on,
      kind: t.kind as CasTxn['kind'],
      description: t.description ?? '',
      amount: t.amount,
      units: t.units,
      nav: t.nav,
      balance: t.balance_units,
    }));
    const res = fifoLots({
      transactions: casTx,
      openingUnits: prior,
      closingUnits: last.balance_units,
      costValue: i.position?.invested || null,
    });
    const held = res.lots.reduce((a, l) => a + l.units, 0);
    const unit = value !== null && held > 0 ? value / held : null;
    tables.push({
      title: 'Units still held (oldest first)',
      hint: res.reconciled
        ? 'Each purchase that still has units. Sales use the oldest units first.'
        : 'The statement history does not add up to the units held, so these lots may be incomplete.',
      columns: ['Bought', 'Units', 'Cost', 'Value today', 'Gain'],
      numeric: [1, 2, 3, 4],
      rows: res.lots.map((l) => {
        const v = unit === null ? null : l.units * unit;
        return {
          cells: [
            l.acquiredOn === '1900-01-01' ? 'Before the statement' : l.acquiredOn,
            num(l.units),
            l.cost === null ? '–' : inr(l.cost),
            inr(v),
            v === null || l.cost === null ? '–' : inr(v - l.cost),
          ],
        };
      }),
      empty: 'No units are held.',
    });
    tables.push({
      title: 'Sales and the purchases they used',
      columns: ['Sold', 'Bought', 'Units', 'Sale value', 'Cost', 'Gain'],
      numeric: [2, 3, 4, 5],
      rows: [...res.realised].reverse().map((r) => ({
        cells: [
          r.soldOn,
          r.acquiredOn === '1900-01-01' ? 'Before the statement' : r.acquiredOn,
          num(r.units),
          inr(r.proceeds),
          r.cost === null ? '–' : inr(r.cost),
          r.cost === null ? '–' : inr(r.proceeds - r.cost),
        ],
      })),
      empty: 'No units have been sold.',
    });
  }
  return tables;
}

export function buildAssetView(i: AssetViewInput): AssetView {
  const a = i.asset;
  const title = i.position?.fund_name ?? i.receivable?.counterparty ?? (a.label || a.nickname);
  const subtitle = [
    TYPE_LABEL[a.type] ?? a.type,
    i.bankName,
    i.ownerName ? `held by ${i.ownerName}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const facts: Fact[] = [];
  const cur = i.current;
  facts.push({
    label: 'Value today',
    value: inr(cur.amount),
    note: cur.basis
      ? `${BASIS[cur.basis] ?? cur.basis}${cur.ageDays !== null ? `, ${cur.ageDays} day${cur.ageDays === 1 ? '' : 's'} since the last recorded value` : ''}`
      : undefined,
  });
  if (i.code) facts.push({ label: 'Sheet code', value: i.code });
  facts.push({ label: 'Person', value: i.ownerName });
  if (i.bankName) facts.push({ label: 'Bank or institution', value: i.bankName });
  facts.push({ label: 'Kind', value: TYPE_LABEL[a.type] ?? a.type });
  if (a.account_kind) facts.push({ label: 'Account type', value: a.account_kind });
  if (a.is_joint) facts.push({ label: 'Joint account', value: 'Yes' });
  if (a.identifier_last4) facts.push({ label: 'Last 4 digits', value: `…${a.identifier_last4}` });
  facts.push({ label: 'Status', value: STATUS[a.status] ?? a.status });
  if (a.currency !== 'INR') facts.push({ label: 'Currency', value: a.currency });
  if (a.holder_name) facts.push({ label: 'Held in the name of', value: a.holder_name });
  if (a.notes) facts.push({ label: 'Notes', value: a.notes });

  const charts: AssetView['charts'] = [];
  const tables: DetailTableData[] = [];
  const kpis: Kpi[] = [];
  let progress: AssetView['progress'] = null;
  const obsPoints = i.observations
    .filter((o) => !o.superseded_by)
    .sort((x, y) => x.as_of.localeCompare(y.as_of))
    .map((o) => ({ date: o.as_of, value: inrOf(o) }));

  if (i.fd) {
    const fd = i.fd;
    const accrued = fdValueOn({
      principal: fd.principal,
      annualRate: fd.rate,
      bookedOn: utc(fd.booked_on),
      asOf: utc(i.today),
      maturityOn: utc(fd.maturity_on),
      compounding: fd.compounding,
    });
    const atMaturity =
      fd.bank_maturity_amount ??
      fdValueOn({
        principal: fd.principal,
        annualRate: fd.rate,
        bookedOn: utc(fd.booked_on),
        asOf: utc(fd.maturity_on),
        maturityOn: utc(fd.maturity_on),
        compounding: fd.compounding,
      });
    const left = daysBetween(i.today, fd.maturity_on);
    facts.push(
      {
        label: 'Rate',
        value: pct(fd.rate),
        note: `compounded ${fd.compounding.replace('_', '-')}`,
      },
      { label: 'Start date', value: fd.booked_on },
      {
        label: 'Maturity date',
        value: fd.maturity_on,
        note: left >= 0 ? `${left} day${left === 1 ? '' : 's'} left` : `${-left} days ago`,
      },
      { label: 'Invested', value: inr(fd.principal) },
      {
        label: 'At maturity',
        value: inr(atMaturity),
        note: fd.bank_maturity_amount
          ? 'as stated by the bank'
          : 'worked out from the rate and dates',
      },
      {
        label: 'Accrued today',
        value: inr(accrued),
        note: `${inr(accrued - fd.principal)} of interest so far`,
      },
    );
    if (fd.fd_ref_last4) facts.push({ label: 'Deposit number', value: `…${fd.fd_ref_last4}` });
    if (i.linked)
      facts.push({
        label: 'Linked savings account',
        value: i.linked.label,
        href: `/asset/${i.linked.id}`,
      });
    else if (a.linked_last4)
      facts.push({ label: 'Linked savings (last 4)', value: `…${a.linked_last4}` });
    const end = fd.maturity_on < i.today ? fd.maturity_on : i.today;
    if (end > fd.booked_on)
      charts.push({
        title: 'Value of the deposit over time',
        label: 'Value',
        money: true,
        points: monthPoints(fd.booked_on, end).map((d) => ({
          date: d,
          value: fdValueOn({
            principal: fd.principal,
            annualRate: fd.rate,
            bookedOn: utc(fd.booked_on),
            asOf: utc(d),
            maturityOn: utc(fd.maturity_on),
            compounding: fd.compounding,
          }),
        })),
      });
    const total = Math.max(1, daysBetween(fd.booked_on, fd.maturity_on));
    const done = Math.min(total, Math.max(0, daysBetween(fd.booked_on, i.today)));
    progress = {
      title: 'Where this deposit is in its term',
      from: fd.booked_on,
      to: fd.maturity_on,
      pct: done / total,
      today: i.today,
      caption:
        left >= 0
          ? `Day ${done} of ${total}: ${left} day${left === 1 ? '' : 's'} to go`
          : `Matured ${-left} day${left === -1 ? '' : 's'} ago`,
    };
    const yieldYr = Math.pow(atMaturity / fd.principal, 365.25 / total) - 1;
    kpis.push(
      {
        label: 'Worth today',
        value: inr(accrued),
        note: `${inr(accrued - fd.principal)} earned so far`,
        tone: 'gain',
      },
      {
        label: 'Interest still to come',
        value: inr(Math.max(0, atMaturity - accrued)),
        note: `until ${fd.maturity_on}`,
      },
      {
        label: 'Total interest at maturity',
        value: inr(atMaturity - fd.principal),
        note: `${pct(fd.rate)} a year on ${inr(fd.principal)}`,
      },
      { label: 'Effective yield', value: pct(yieldYr), note: 'a year, including compounding' },
    );
    if (i.market)
      kpis.push({
        label: 'Best NRE deposit now',
        value: pct(i.market.rate),
        note: `${i.market.bank}, ${i.market.tenure} (checked ${i.market.checkedOn}); this one earns ${pct(fd.rate)}`,
        tone: i.market.rate > fd.rate + 0.0005 ? 'fail' : 'gain',
      });
    const t = fdTable(i);
    if (t) tables.push(t);
  } else if (obsPoints.length > 0) {
    charts.push({ title: 'Balance over time', label: 'Balance', money: true, points: obsPoints });
    if (a.type === 'bank_account') {
      const last = obsPoints[obsPoints.length - 1]!;
      const yearAgo = new Date(utc(i.today));
      yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
      const lastYear = obsPoints.filter((p) => p.date >= yearAgo.toISOString().slice(0, 10));
      const vals = (lastYear.length ? lastYear : obsPoints).map((p) => p.value);
      const avg = vals.reduce((x, y) => x + y, 0) / vals.length;
      const cutoff = new Date(utc(last.date).getTime() - 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const base = [...obsPoints].reverse().find((p) => p.date <= cutoff);
      kpis.push({
        label: 'Balance',
        value: inr(cur.amount ?? last.value),
        note: cur.asOf ? `as of ${cur.asOf}` : undefined,
      });
      if (base)
        kpis.push({
          label: 'Change in 30 days',
          value: signed(last.value - base.value),
          note: `since ${base.date}`,
          tone: last.value - base.value >= 0 ? 'gain' : 'fail',
        });
      kpis.push(
        {
          label: 'Lowest, last year',
          value: inr(Math.min(...vals)),
          note: `${vals.length} readings`,
        },
        { label: 'Highest, last year', value: inr(Math.max(...vals)) },
      );
      if (i.rateInfo)
        kpis.push({
          label: 'Interest rate',
          value: `${i.rateInfo.tag === 'assumed' ? '~' : ''}${pct(i.rateInfo.rate)}`,
          note: i.rateInfo.note,
        });
      if (i.rateInfo)
        kpis.push({
          label: 'Interest a year, about',
          value: inr(avg * i.rateInfo.rate),
          note: 'average balance × rate; the bank statement is exact',
        });
    }
  }

  if (i.position) {
    const p = i.position;
    const value = cur.amount;
    const fundFlows = i.txns.map((t) => ({
      date: t.txn_on,
      units: t.units,
      amount: Math.abs(t.amount),
    }));
    const r = returnsFor(
      [
        {
          assetId: a.id,
          ownerId: 'x',
          name: p.fund_name,
          value: value ?? 0,
          txns: fundFlows,
          plan: {
            invested: p.invested,
            startedOn: p.started_on,
            sipMonthly: p.sip_monthly,
            sipStopped: p.sip_stopped,
          },
        },
      ],
      i.today,
    );
    facts.push(
      { label: 'Invested', value: inr(p.invested) },
      { label: 'Gain', value: value === null ? '–' : inr(value - p.invested) },
      {
        label: 'Return a year (XIRR)',
        value: r.xirr === null ? '–' : pct(r.xirr),
        note:
          r.xirr === null
            ? undefined
            : r.estimatedFunds > 0
              ? 'estimated from the start date and SIP; exact once a fund statement is imported'
              : 'from the fund statement transactions',
      },
    );
    if (p.started_on) facts.push({ label: 'Started', value: p.started_on });
    facts.push({
      label: 'SIP',
      value: p.sip_monthly
        ? `${inr(p.sip_monthly)} a month${p.sip_stopped ? ' (stopped)' : ''}`
        : 'None',
    });
    if (p.folio_last4) facts.push({ label: 'Folio', value: `…${p.folio_last4}` });
    if (p.isin) facts.push({ label: 'ISIN', value: p.isin });
    if (p.amfi_code) facts.push({ label: 'Fund code (AMFI)', value: p.amfi_code });
    facts.push({ label: 'Plan', value: p.plan_type.replace(/_/g, ' ') });
    facts.push({
      label: 'Goal',
      value: i.goalNames.length ? i.goalNames.join(', ') : 'Not tagged',
      href: '/investments',
    });
    if (i.navs.length >= 2)
      charts.push({
        title: 'Price (NAV) over the last year',
        label: 'NAV',
        money: false,
        points: i.navs.map((n) => ({ date: n.nav_date, value: n.nav })),
      });
    tables.push(...fundTables(i, value));
  }

  if (i.receivable) {
    const r = i.receivable;
    const paid = i.payments.reduce((s, p) => s + p.amount, 0);
    facts.push(
      { label: 'Lent', value: inr(r.lent), note: r.lent_on ? `on ${r.lent_on}` : undefined },
      { label: 'Repaid so far', value: inr(paid) },
      { label: 'Still owed', value: inr(Math.max(0, r.lent - paid)) },
    );
    if (r.expected_on) facts.push({ label: 'Expected back', value: r.expected_on });
    if (r.interest_note) facts.push({ label: 'Interest', value: r.interest_note });
    tables.push({
      title: 'Repayments',
      columns: ['Date', 'Amount', 'Note'],
      numeric: [1],
      rows: [...i.payments]
        .sort((x, y) => y.paid_on.localeCompare(x.paid_on))
        .map((p) => ({ cells: [p.paid_on, inr(p.amount), p.note ?? ''] })),
      empty: 'Nothing has been repaid yet.',
    });
  }

  tables.unshift(observationsTable(i.observations, a.id));
  return {
    title,
    subtitle,
    headline: cur.amount === null ? null : inr(cur.amount),
    headlineNote: cur.asOf ? `as of ${cur.asOf}` : null,
    facts,
    charts,
    tables,
    kpis,
    progress,
    related: (i.related ?? []).map((r) => ({
      label: r.label,
      href: `/asset/${r.id}`,
      value: r.value === null ? '–' : inr(r.value),
    })),
  };
}

// ------------------------------------------------------------------------------------------------
// Activity
// ------------------------------------------------------------------------------------------------
export interface AuditIn {
  actor: string | null;
  table_name: string;
  row_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}
export interface InboxIn {
  received_on: string | null;
  created_at: string;
  from_domain: string | null;
  subject: string | null;
  outcome: string;
  reason: string | null;
}
export interface ImportIn {
  created_at: string;
  outcome: string;
  schemes: number;
  transactions: number;
  detail: string | null;
}

export function buildActivity(i: {
  audit: AuditIn[];
  inbox?: InboxIn[];
  imports?: ImportIn[];
  viewerId: string;
  names?: Record<string, string>;
}): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const r of i.audit) {
    const d = describeAudit(r, { names: i.names ?? {} });
    items.push({
      at: r.at,
      who: r.actor === null ? 'Automatic job' : r.actor === i.viewerId ? 'You' : 'A family member',
      title: d.title,
      changes: d.changes,
      kind: 'change',
    });
  }
  for (const m of i.inbox ?? [])
    items.push({
      at: m.created_at,
      who: 'Bank e-mail reader',
      title: `E-mail ${m.outcome === 'applied' ? 'read and applied' : m.outcome === 'needs_review' ? 'needs your review' : m.outcome === 'ignored' ? 'ignored' : 'could not be read'}${m.subject ? `: ${m.subject}` : ''}`,
      changes: m.reason ? [{ label: 'Why', before: null, after: m.reason }] : [],
      kind: 'mail',
    });
  for (const m of i.imports ?? [])
    items.push({
      at: m.created_at,
      who: 'Fund statement import',
      title: `Fund statement ${m.outcome === 'imported' ? 'imported' : m.outcome === 'partial' ? 'imported in part' : 'could not be imported'}: ${m.schemes} funds, ${m.transactions} transactions`,
      changes: m.detail
        ? [{ label: 'Details', before: null, after: m.detail.split('\n')[0]!.slice(0, 200) }]
        : [],
      kind: 'import',
    });
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
}

// ------------------------------------------------------------------------------------------------
// Bank history: the bank's accounts added together over time
// ------------------------------------------------------------------------------------------------
export interface BankHistoryInput {
  today: string;
  /** recorded values of each savings-type account (rupees), any order */
  cash: { assetId: string; as_of: string; value: number }[];
  deposits: {
    principal: number;
    rate: number;
    booked_on: string;
    maturity_on: string;
    compounding: NonNullable<AssetViewInput['fd']>['compounding'];
    counted: boolean;
  }[];
}

/** Month by month: each account's last known balance carried forward, plus each deposit's accrued value while it runs. */
export function bankHistory(i: BankHistoryInput): { date: string; value: number }[] {
  const dates = [...i.cash.map((c) => c.as_of), ...i.deposits.map((d) => d.booked_on)].sort();
  if (dates.length === 0) return [];
  const pts = monthPoints(dates[0]!, i.today, 120);
  const byAsset = new Map<string, { as_of: string; value: number }[]>();
  for (const c of i.cash)
    byAsset.set(c.assetId, [...(byAsset.get(c.assetId) ?? []), { as_of: c.as_of, value: c.value }]);
  for (const v of byAsset.values()) v.sort((a, b) => a.as_of.localeCompare(b.as_of));
  return pts
    .map((d) => {
      let total = 0;
      for (const series of byAsset.values()) {
        let last: number | null = null;
        for (const p of series) if (p.as_of <= d) last = p.value;
        if (last !== null) total += last;
      }
      for (const dep of i.deposits) {
        if (!dep.counted || d < dep.booked_on || d > dep.maturity_on) continue;
        total += fdValueOn({
          principal: dep.principal,
          annualRate: dep.rate,
          bookedOn: utc(dep.booked_on),
          asOf: utc(d),
          maturityOn: utc(dep.maturity_on),
          compounding: dep.compounding,
        });
      }
      return { date: d, value: total };
    })
    .filter((p) => p.value > 0);
}
