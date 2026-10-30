import type { SipSeen } from '@fwos/core';
import { parseExitLoad } from './match-funds';

/**
 * The side panel for a fund: what the person typed against what is stored, turned into the few changes to save and the problems to
 * fix first. Pure: the panel only shows the result and the server action stores it. The same functions serve the "Add a fund" and
 * "Add a transaction" panels.
 */
export interface FundEditRow {
  id: string;
  /** the fund's name as on its statement */
  name: string;
  /** the name the household gave it ('' when none) */
  label: string;
  ownerId: string;
  ownerName: string;
  units: number | null;
  /** the latest price per unit, when the fund follows a live price */
  nav: number | null;
  value: number;
  invested: number;
  sipMonthly: number | null;
  sipStopped: boolean;
  /** for a fund with no SIP amount saved: the SIP its purchases show, if any */
  sipSeen?: SipSeen | null;
  /** YYYY-MM-DD or '' */
  startedOn: string;
  plan: 'direct' | 'regular' | 'unknown';
  goalIds: string[];
  /** sold or closed */
  closed: boolean;
  exitLoadPct: number | null;
  exitLoadDays: number | null;
  amfiCode: string | null;
  hasStatement: boolean;
}

/** What the panel's boxes hold: text, as typed. */
export interface FundDraft {
  label: string;
  units: string;
  /** only asked for when the units change and the fund has no live price */
  value: string;
  invested: string;
  sip: string;
  sipStopped: boolean;
  startedOn: string;
  goalId: string;
  closed: boolean;
  plan: string;
  exitPct: string;
  exitDays: string;
}

const plain = (n: number, digits = 4) => String(Number(n.toFixed(digits)));

export function draftOf(r: FundEditRow): FundDraft {
  return {
    label: r.label,
    units: r.units === null ? '' : plain(r.units),
    value: '',
    invested: plain(r.invested, 2),
    sip: r.sipMonthly === null ? '' : plain(r.sipMonthly, 2),
    sipStopped: r.sipStopped,
    startedOn: r.startedOn,
    goalId: r.goalIds[0] ?? '',
    closed: r.closed,
    plan: r.plan,
    exitPct: r.exitLoadPct === null ? '' : plain(r.exitLoadPct * 100, 3),
    exitDays: r.exitLoadDays === null ? '' : String(r.exitLoadDays),
  };
}

export interface FundSavePayload {
  assetId: string;
  label?: string | null;
  status?: 'active' | 'closed';
  /** units with the price and value they were worked out at, and the day */
  units?: number;
  nav?: number | null;
  value?: number;
  asOf?: string;
  invested?: number;
  sipMonthly?: number | null;
  sipStopped?: boolean;
  startedOn?: string | null;
  planType?: 'direct' | 'regular' | 'regular_or_unknown';
  exitLoadPct?: number | null;
  exitLoadDays?: number | null;
  goalId?: string;
}

export interface FundSave {
  changes: string[];
  problems: string[];
  payload: FundSavePayload | null;
}

/** A number typed with commas, rupee signs or spaces; null when empty, NaN when it is not a number. */
export function typed(v: string): number | null {
  const t = v.replace(/[,\s₹]/g, '');
  if (t === '') return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const sameNum = (a: number | null, b: number | null, tol: number) =>
  a === b || (a !== null && b !== null && Math.abs(a - b) <= tol);

export function buildFundSave(was: FundEditRow, d: FundDraft, today: string): FundSave {
  const problems: string[] = [];
  const changes: string[] = [];
  const p: FundSavePayload = { assetId: was.id };

  if (d.label.trim() !== was.label.trim()) {
    if (d.label.trim().length > 120) problems.push('the name is longer than 120 characters');
    else {
      p.label = d.label.trim() === '' ? null : d.label.trim();
      changes.push('name');
    }
  }

  const units = typed(d.units);
  if (Number.isNaN(units) || (units !== null && units < 0)) problems.push('units held');
  else if (units !== null && !sameNum(units, was.units, 0.00005)) {
    p.units = units;
    p.asOf = today;
    const typedValue = typed(d.value);
    if (was.nav !== null) {
      p.nav = was.nav;
      p.value = Math.round(units * was.nav * 100) / 100;
    } else if (typedValue === null || Number.isNaN(typedValue) || typedValue < 0) {
      problems.push(
        'the value now (this fund has no live price, so the value cannot be worked out)',
      );
    } else {
      p.nav = null;
      p.value = typedValue;
    }
    changes.push('units');
  }

  const invested = typed(d.invested);
  if (invested === null || Number.isNaN(invested) || invested < 0) problems.push('amount invested');
  else if (!sameNum(invested, was.invested, 0.005)) {
    p.invested = invested;
    changes.push('amount invested');
  }

  const sip = typed(d.sip);
  if (Number.isNaN(sip) || (sip !== null && sip <= 0)) problems.push('SIP amount');
  else {
    if (!sameNum(sip, was.sipMonthly, 0.005)) {
      p.sipMonthly = sip;
      changes.push('SIP');
    }
    // a fund with no SIP amount saved can still be marked stopped (its SIP ran, by its statement, and has ended)
    const stopped = d.sipStopped;
    if (stopped !== was.sipStopped) {
      p.sipStopped = stopped;
      if (!changes.includes('SIP')) changes.push(stopped ? 'SIP stopped' : 'SIP running');
    }
  }

  if (d.startedOn !== was.startedOn) {
    if (d.startedOn !== '' && (!ISO.test(d.startedOn) || d.startedOn > today))
      problems.push('start date (today or earlier)');
    else {
      p.startedOn = d.startedOn === '' ? null : d.startedOn;
      changes.push('start date');
    }
  }

  if (was.goalIds.length <= 1 && d.goalId !== (was.goalIds[0] ?? '')) {
    p.goalId = d.goalId;
    changes.push('goal');
  }

  if (d.closed !== was.closed) {
    p.status = d.closed ? 'closed' : 'active';
    changes.push(d.closed ? 'marked sold or closed' : 'marked active');
  }

  if (d.plan !== was.plan) {
    p.planType =
      d.plan === 'direct' ? 'direct' : d.plan === 'regular' ? 'regular' : 'regular_or_unknown';
    changes.push('plan');
  }

  const load = parseExitLoad(d.exitPct, d.exitDays);
  if (load === null) problems.push('exit load (a percentage up to 10 and whole days up to 1095)');
  else {
    const frac = load.clear ? null : load.fraction;
    const days = load.clear ? null : load.days;
    if (!sameNum(frac, was.exitLoadPct, 0.000005) || days !== was.exitLoadDays) {
      p.exitLoadPct = frac;
      p.exitLoadDays = days;
      changes.push('exit load');
    }
  }

  return { changes, problems, payload: changes.length > 0 && problems.length === 0 ? p : null };
}

export const savedMessage = (changes: string[]) =>
  changes.length === 0 ? 'Nothing was changed.' : `Saved: ${changes.join(', ')}.`;

// ------------------------------------------------------------------------------------------------
// Add a fund
// ------------------------------------------------------------------------------------------------
export interface AddFundDraft {
  ownerId: string;
  name: string;
  invested: string;
  value: string;
  units: string;
  startedOn: string;
  sip: string;
  plan: string;
  goalId: string;
}

export const EMPTY_FUND: AddFundDraft = {
  ownerId: '',
  name: '',
  invested: '',
  value: '',
  units: '',
  startedOn: '',
  sip: '',
  plan: 'unknown',
  goalId: '',
};

export interface AddFundPayload {
  ownerId: string;
  name: string;
  invested: number;
  value: number;
  units: number | null;
  startedOn: string | null;
  sipMonthly: number | null;
  planType: 'direct' | 'regular' | 'regular_or_unknown';
  goalId: string;
}

export function buildAddFund(
  d: AddFundDraft,
  today: string,
): { problems: string[]; payload: AddFundPayload | null } {
  const problems: string[] = [];
  const name = d.name.trim();
  if (name.length < 2 || name.length > 120) problems.push('the fund name (2 to 120 characters)');
  if (!d.ownerId) problems.push('whose fund it is');
  const invested = typed(d.invested);
  if (invested === null || Number.isNaN(invested) || invested < 0)
    problems.push('the amount invested');
  const value = typed(d.value);
  if (value === null || Number.isNaN(value) || value <= 0) problems.push('the value now');
  const units = typed(d.units);
  if (Number.isNaN(units) || (units !== null && units < 0)) problems.push('units held');
  const sip = typed(d.sip);
  if (Number.isNaN(sip) || (sip !== null && sip <= 0)) problems.push('SIP amount');
  if (d.startedOn !== '' && (!ISO.test(d.startedOn) || d.startedOn > today))
    problems.push('start date (today or earlier)');
  if (problems.length > 0) return { problems, payload: null };
  return {
    problems,
    payload: {
      ownerId: d.ownerId,
      name,
      invested: invested as number,
      value: value as number,
      units,
      startedOn: d.startedOn === '' ? null : d.startedOn,
      sipMonthly: sip,
      planType:
        d.plan === 'direct' ? 'direct' : d.plan === 'regular' ? 'regular' : 'regular_or_unknown',
      goalId: d.goalId,
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Add a transaction
// ------------------------------------------------------------------------------------------------
export interface TxnDraft {
  asset: string;
  date: string;
  kind: string;
  amount: string;
  units: string;
  nav: string;
  /** a sale of every unit held on the date: the fund is closed and its SIP stopped from that day */
  all?: boolean;
}

/** Kinds that take units out of a fund. */
export const SELL_KINDS = new Set(['redeem', 'switch_out']);

export const TXN_KINDS: { value: string; label: string }[] = [
  { value: 'purchase', label: 'Purchase (one-off)' },
  { value: 'sip', label: 'SIP instalment' },
  { value: 'redeem', label: 'Sale' },
  { value: 'switch_in', label: 'Switch in' },
  { value: 'switch_out', label: 'Switch out' },
  { value: 'dividend_reinvest', label: 'Dividend reinvested' },
  { value: 'bonus', label: 'Bonus units' },
];

export function buildTxn(
  d: TxnDraft,
  today: string,
): { problems: string[]; values: Record<string, string> | null } {
  const problems: string[] = [];
  if (!d.asset) problems.push('the fund');
  if (!ISO.test(d.date) || d.date > today) problems.push('the date (today or earlier)');
  if (!TXN_KINDS.some((k) => k.value === d.kind)) problems.push('the type');
  const amount = typed(d.amount);
  if (amount === null || Number.isNaN(amount) || amount <= 0) problems.push('the amount');
  const all = !!d.all && SELL_KINDS.has(d.kind);
  if (d.all && !SELL_KINDS.has(d.kind))
    problems.push('a sale or switch out (only those can be for every unit)');
  // every unit sold: the units are what is held on the date, so neither units nor a price is needed
  const units = all ? null : typed(d.units);
  const nav = typed(d.nav);
  if (Number.isNaN(units) || (units !== null && units <= 0)) problems.push('units');
  if (Number.isNaN(nav) || (nav !== null && nav <= 0)) problems.push('the price per unit');
  if (!all && units === null && nav === null) problems.push('units or the price per unit');
  if (problems.length > 0) return { problems, values: null };
  return {
    problems,
    values: {
      asset: d.asset,
      date: d.date,
      kind: d.kind,
      amount: String(amount),
      units: units === null ? '' : String(units),
      nav: nav === null ? '' : String(nav),
      ...(all ? { all: '1' } : {}),
    },
  };
}
