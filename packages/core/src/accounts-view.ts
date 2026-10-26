/**
 * What the Accounts and Monthly-update screens show: one group per bank, each with its savings accounts and fixed
 * deposits side by side, every line tagged with whose it is, how current it is and where the figure came from.
 * Pure functions; the pages only draw what this returns.
 */
import { fdValueOn, type Compounding } from './fd';
import type { AssetRow, FdRow, ObservationRow, Portfolio } from './portfolio';
import { latestObservations } from './portfolio';

/** Okabe-Ito colours: distinguishable with every common kind of colour blindness. People always also show an initial. */
export const PERSON_COLOURS = [
  '#0072B2',
  '#D55E00',
  '#009E73',
  '#CC79A7',
  '#E69F00',
  '#56B4E9',
] as const;

export interface PersonStyle {
  id: string;
  name: string;
  initial: string;
  colour: string;
}

/** Stable colours: people keep their colour as long as their order of creation does not change. */
export function personStyles(owners: { id: string; name: string }[]): Record<string, PersonStyle> {
  const out: Record<string, PersonStyle> = {};
  owners.forEach((o, i) => {
    out[o.id] = {
      id: o.id,
      name: o.name,
      initial: (o.name.trim()[0] ?? '?').toUpperCase(),
      colour: PERSON_COLOURS[i % PERSON_COLOURS.length]!,
    };
  });
  return out;
}

export interface BankStyle {
  /** the bank's colour: well known banks keep their own, others get a stable one from their name */
  colour: string;
  /** two letters for a badge: "YB", "ID" */
  abbr: string;
}

// Brand colours, darkened a little so white text stays readable. First match wins.
const BANK_BRANDS: [RegExp, string][] = [
  [/hdfc/i, '#004c8f'],
  [/icici/i, '#b3441f'],
  [/axis/i, '#97144d'],
  [/\bsbi\b|state bank/i, '#1c4f9c'],
  [/kotak/i, '#c8102e'],
  [/yes/i, '#0b62a8'],
  [/idfc/i, '#9c1d26'],
  [/indus/i, '#7a1f3d'],
  [/\brbl\b/i, '#233a8c'],
  [/\bau\b|small finance/i, '#c2540a'],
  [/federal/i, '#0a5ea8'],
  [/equitas/i, '#b5252b'],
  [/jana/i, '#00798f'],
  [/esaf/i, '#2b7a33'],
  [/standard chartered|scb/i, '#0a7a5a'],
  [/dbs/i, '#d62b2b'],
  [/ocbc/i, '#c1272d'],
  [/uob/i, '#1b3d8f'],
];
const BANK_PALETTE = [
  '#0b6e4f',
  '#7a3e9d',
  '#b5651d',
  '#1d6fa5',
  '#a3263f',
  '#2e7d32',
  '#5b5fc7',
  '#c2410c',
  '#00838f',
  '#8a6d00',
  '#ad1457',
  '#455a64',
  '#6a1b9a',
  '#00695c',
  '#9a3412',
  '#3f6212',
];

/** The same bank always gets the same colour and letters, on every screen. */
export function bankStyle(name: string): BankStyle {
  const brand = BANK_BRANDS.find(([re]) => re.test(name));
  let h = 2166136261;
  for (const ch of name.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const words = name
    .replace(/\b(bank|ltd|limited|of|the|and)\b/gi, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const abbr =
    (words.length >= 2
      ? words[0]![0]! + words[1]![0]!
      : (words[0] ?? name).replace(/[^A-Za-z0-9]/g, '').slice(0, 2)
    ).toUpperCase() || '??';
  return { colour: brand ? brand[1] : BANK_PALETTE[h % BANK_PALETTE.length]!, abbr };
}

export type SourceTag = { label: string; kind: 'auto' | 'manual' | 'calc' | 'import' | 'none' };

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDate = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/** "Email, 25 Oct" / "You, 12 Oct" / "Calculated" so the reader sees what is automatic and what is typed. */
export function sourceTag(source: string | null, asOf: string | null, isFd: boolean): SourceTag {
  if (isFd) return { label: 'Calculated from the deposit terms', kind: 'calc' };
  if (!source || !asOf) return { label: 'No value yet', kind: 'none' };
  const d = shortDate(asOf);
  if (source === 'email') return { label: `Email, ${d}`, kind: 'auto' };
  if (source === 'statement') return { label: `Statement, ${d}`, kind: 'auto' };
  if (source === 'cas') return { label: `Fund statement, ${d}`, kind: 'auto' };
  if (source === 'api') return { label: `Automatic, ${d}`, kind: 'auto' };
  if (source === 'workbook') return { label: `Imported sheet, ${d}`, kind: 'import' };
  if (source === 'calculated') return { label: 'Calculated', kind: 'calc' };
  return { label: `You, ${d}`, kind: 'manual' };
}

export type AccountKind = 'NRE' | 'NRO';

/** The key of the block that holds everything with no bank: money held by others and accounts without a bank. */
export const OTHER_HOLDINGS_KEY = '__none';

/** One row of the sheet: a savings account, a fixed deposit, or money held by someone else. */
export interface BankRow {
  assetId: string;
  kind: 'cash' | 'fd' | 'held';
  ownerId: string;
  /** your sheet order (row number); rows you add later sit after the row they belong to */
  order: number;
  /** the code as you write it in the sheet, e.g. "FD-NRE JO-0278", "Cash-NRO JO-0266 (NRO SIP)" */
  code: string;
  accountKind: AccountKind | null;
  /** the kind was not written on the row; taken from the savings account in the same section */
  kindInferred: boolean;
  joint: boolean;
  last4: string | null;
  currency: string;
  notes: string | null;
  status: string;
  /** today's value in INR: for a deposit calculated from its terms (the full amount at maturity), for savings the estimate */
  current: number | null;
  /** savings: last recorded balance and where it came from */
  recorded: number | null;
  asOf: string | null;
  source: SourceTag;
  stale: boolean;
  holderName: string | null;
  fd: {
    principal: number;
    rate: number;
    bookedOn: string;
    maturityOn: string;
    daysLeft: number;
    maturityAmount: number;
    /** how interest is added to the deposit: needed to work out what it earns in a day */
    compounding: Compounding;
    maturityAmountFromBank: boolean;
    refLast4: string | null;
    /** the full deposit number, when it has been entered */
    ref: string | null;
    /** code of the savings account it is linked to, found by the last four digits */
    linkedTo: string | null;
    needsConfirmation: boolean;
  } | null;
}

export interface Totals {
  fdInvested: number;
  fdMaturity: number;
  fdCurrent: number;
  cash: number;
  current: number;
}

export interface OwnerSection {
  ownerId: string;
  rows: BankRow[];
  totals: Totals;
}

export interface BankBlock {
  key: string;
  name: string;
  order: number;
  sections: OwnerSection[];
  totals: Totals;
  /** things only you can settle: stale balances and unconfirmed matured deposits */
  needsYou: number;
  /** every balance carries a value dated this month and no deposit awaits confirmation */
  doneThisMonth: boolean;
  lastUpdated: string | null;
  owners: string[];
}

export interface BuildInput {
  assets: AssetRow[];
  observations: ObservationRow[];
  fds: FdRow[];
  portfolio: Portfolio;
  institutionNames: Record<string, string>;
  today: Date;
}

const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
const emptyTotals = (): Totals => ({
  fdInvested: 0,
  fdMaturity: 0,
  fdCurrent: 0,
  cash: 0,
  current: 0,
});

/** Same code you would type in the sheet; a note in brackets such as "(NRO SIP)" is kept. */
export function rowCode(args: {
  type: string;
  label: string | null;
  kind: AccountKind | null;
  joint: boolean;
  last4: string | null;
  currency: string;
}): string {
  const base =
    args.type === 'fixed_deposit'
      ? 'FD'
      : args.currency !== 'INR'
        ? `Cash ${args.currency}`
        : 'Cash';
  const bracket = /\(([^)]*)\)/.exec(args.label ?? '')?.[1];
  return (
    base +
    (args.kind ? `-${args.kind}` : '') +
    (args.joint ? ' JO' : '') +
    (args.last4 ? `-${args.last4}` : '') +
    (bracket ? ` (${bracket})` : '')
  );
}

function addTotals(t: Totals, r: BankRow) {
  const v = r.current ?? 0;
  const counted = r.status === 'active';
  if (r.kind === 'fd' && r.fd) {
    if (counted && !r.fd.needsConfirmation) {
      t.fdInvested += r.fd.principal;
      t.fdMaturity += r.fd.maturityAmount;
      t.fdCurrent += v;
      t.current += v;
    }
  } else if (r.status !== 'closed' && r.status !== 'stopped') {
    t.cash += v;
    t.current += v;
  }
}

export function buildBankBlocks(i: BuildInput): BankBlock[] {
  const latest = latestObservations(i.observations);
  const fdBy = new Map(i.fds.map((f) => [f.asset_id, f]));
  const valued = new Map(i.portfolio.valued.map((v) => [v.assetId, v]));
  const monthStart = `${i.today.toISOString().slice(0, 7)}-01`;
  const NONE = OTHER_HOLDINGS_KEY;
  let seq = 0;

  const rowsByBank = new Map<string, BankRow[]>();
  const nameOf = new Map<string, string>();
  for (const a of i.assets) {
    if (a.type !== 'bank_account' && a.type !== 'fixed_deposit' && a.type !== 'third_party_held')
      continue;
    // money held by another person is not in any bank: it sits under "Other holdings" with the rest that has no bank
    const bankKey = a.type === 'third_party_held' ? NONE : (a.institution_id ?? NONE);
    nameOf.set(
      bankKey,
      bankKey === NONE ? 'Other holdings' : (i.institutionNames[bankKey] ?? 'Other'),
    );
    const v = valued.get(a.id);
    const est = v?.estimate?.estimatedAmount ?? null;
    const kind: AccountKind | null =
      a.account_kind === 'NRE' || a.account_kind === 'NRO' ? a.account_kind : null;
    const fd = fdBy.get(a.id);
    const obs = latest.get(a.id) ?? null;
    const line = i.portfolio.lines[a.id];
    const last4 =
      a.type === 'fixed_deposit'
        ? (a.linked_last4 ?? a.identifier_last4 ?? null)
        : (a.identifier_last4 ?? null);
    const row: BankRow = {
      assetId: a.id,
      kind: a.type === 'fixed_deposit' ? 'fd' : a.type === 'third_party_held' ? 'held' : 'cash',
      ownerId: a.owner_id,
      order: a.sort_order ?? 1_000_000 + seq++,
      code: '',
      accountKind: kind,
      kindInferred: false,
      joint: !!a.is_joint,
      last4,
      currency: a.currency,
      notes: a.notes ?? null,
      status: a.status,
      current: est,
      recorded: obs ? obs.amount : null,
      asOf: obs?.as_of ?? null,
      source: sourceTag(obs?.source ?? null, obs?.as_of ?? null, a.type === 'fixed_deposit'),
      stale: line?.freshness === 'stale' || line?.freshness === 'missing',
      holderName: a.holder_name ?? null,
      fd: null,
    };
    if (a.type === 'fixed_deposit' && fd) {
      const maturityAmount =
        fd.bank_maturity_amount ??
        fdValueOn({
          principal: fd.principal,
          annualRate: fd.rate,
          bookedOn: new Date(`${fd.booked_on}T00:00:00Z`),
          asOf: new Date(`${fd.maturity_on}T00:00:00Z`),
          maturityOn: new Date(`${fd.maturity_on}T00:00:00Z`),
          compounding: fd.compounding,
        });
      const daysLeft = daysBetween(i.today, new Date(`${fd.maturity_on}T00:00:00Z`));
      row.fd = {
        principal: fd.principal,
        rate: fd.rate,
        bookedOn: fd.booked_on,
        maturityOn: fd.maturity_on,
        daysLeft,
        maturityAmount,
        compounding: fd.compounding,
        maturityAmountFromBank: fd.bank_maturity_amount !== null,
        refLast4: fd.fd_ref_last4 ?? null,
        ref: fd.fd_ref ?? null,
        linkedTo: null,
        needsConfirmation:
          a.status === 'matured_unconfirmed' || (a.status === 'active' && daysLeft < 0),
      };
    }
    (rowsByBank.get(bankKey) ?? rowsByBank.set(bankKey, []).get(bankKey)!).push(row);
  }

  const blocks: BankBlock[] = [];
  for (const [bankKey, rows] of rowsByBank) {
    rows.sort((x, y) => x.order - y.order);
    // a deposit that does not say NRE or NRO takes the kind of the savings account in the same person's section
    for (const r of rows) {
      if (r.kind === 'fd' && !r.accountKind) {
        const kinds = new Set(
          rows
            .filter((x) => x.ownerId === r.ownerId && x.kind === 'cash' && x.accountKind)
            .map((x) => x.accountKind),
        );
        if (kinds.size === 1) {
          r.accountKind = [...kinds][0]!;
          r.kindInferred = true;
        }
      }
    }
    for (const r of rows) {
      const asset = i.assets.find((a) => a.id === r.assetId)!;
      r.code = rowCode({
        type: asset.type,
        label: asset.label ?? null,
        kind: r.accountKind,
        joint: r.joint,
        last4: r.last4,
        currency: r.currency,
      });
    }
    for (const r of rows) {
      if (r.kind === 'fd' && r.fd && r.last4) {
        const target = rows.find((x) => x.kind === 'cash' && x.last4 === r.last4);
        r.fd.linkedTo = target ? target.code : null;
      }
    }
    const sectionOrder = new Map<string, number>();
    for (const r of rows)
      sectionOrder.set(r.ownerId, Math.min(sectionOrder.get(r.ownerId) ?? Infinity, r.order));
    const sections: OwnerSection[] = [...sectionOrder.entries()]
      .sort((x, y) => x[1] - y[1])
      .map(([ownerId]) => {
        const rs = rows.filter((r) => r.ownerId === ownerId);
        const totals = emptyTotals();
        rs.forEach((r) => addTotals(totals, r));
        return { ownerId, rows: rs, totals };
      });
    const totals = emptyTotals();
    sections.forEach((sct) => {
      for (const k of Object.keys(totals) as (keyof Totals)[]) totals[k] += sct.totals[k];
    });
    let needsYou = 0;
    let done = rows.length > 0;
    let lastUpdated: string | null = null;
    for (const r of rows) {
      if (r.kind === 'fd') {
        if (r.fd?.needsConfirmation) {
          needsYou++;
          done = false;
        }
        continue;
      }
      if (r.status === 'closed' || r.status === 'stopped') continue;
      if (r.stale) needsYou++;
      if (r.kind === 'cash' && !(r.asOf && r.asOf >= monthStart)) done = false;
      if (r.asOf && (!lastUpdated || r.asOf > lastUpdated)) lastUpdated = r.asOf;
    }
    blocks.push({
      key: bankKey,
      name: nameOf.get(bankKey) ?? 'Other',
      order: Math.min(...rows.map((r) => r.order)),
      sections,
      totals,
      needsYou,
      doneThisMonth: done,
      lastUpdated,
      owners: sections.map((sct) => sct.ownerId),
    });
  }
  // the block of holdings with no bank comes after every bank
  return blocks.sort(
    (a, b) => Number(a.key === NONE) - Number(b.key === NONE) || a.order - b.order,
  );
}

/** Only one person's rows, with every total worked out again. */
export function filterBlocksByOwner(blocks: BankBlock[], ownerId: string): BankBlock[] {
  return blocks
    .map((b) => {
      const sections = b.sections
        .filter((sct) => sct.ownerId === ownerId)
        .map((sct) => ({ ...sct }));
      const totals = emptyTotals();
      sections.forEach((sct) => {
        for (const k of Object.keys(totals) as (keyof Totals)[]) totals[k] += sct.totals[k];
      });
      return { ...b, sections, totals, owners: [ownerId] };
    })
    .filter((b) => b.sections.length > 0);
}

/** Per-person totals for the strip at the top of Home. */
export function personTotals(portfolio: Portfolio): Record<string, number> {
  return portfolio.netWorth.byOwner;
}
