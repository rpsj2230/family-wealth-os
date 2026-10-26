/**
 * What the Accounts and Monthly-update screens show: one group per bank, each with its savings accounts and fixed
 * deposits side by side, every line tagged with whose it is, how current it is and where the figure came from.
 * Pure functions; the pages only draw what this returns.
 */
import { fdValueOn } from './fd';
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
    maturityAmountFromBank: boolean;
    refLast4: string | null;
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
  const NONE = '__none';
  let seq = 0;

  const rowsByBank = new Map<string, BankRow[]>();
  const nameOf = new Map<string, string>();
  for (const a of i.assets) {
    if (a.type !== 'bank_account' && a.type !== 'fixed_deposit' && a.type !== 'third_party_held')
      continue;
    const bankKey = a.institution_id ?? NONE;
    nameOf.set(
      bankKey,
      a.institution_id ? (i.institutionNames[a.institution_id] ?? 'Other') : 'Other holdings',
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
        maturityAmountFromBank: fd.bank_maturity_amount !== null,
        refLast4: fd.fd_ref_last4 ?? null,
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
  return blocks.sort((a, b) => a.order - b.order);
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
