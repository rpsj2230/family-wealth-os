/**
 * "Keep it current": for each bank, which balances are up to date this month, which are waiting for a value, and how each
 * latest value arrived (email, a statement, you, the imported sheet or a calculation). Pure functions; the Monthly update
 * page only draws what this returns.
 */
import type { BankBlock, BankRow, SourceTag } from './accounts-view';

export type BankState = 'current' | 'waiting' | 'attention';

/** One word for where a value came from, shared by every chip: "Email", "You", "Statement"... */
export function sourceWord(s: SourceTag): string {
  if (s.kind === 'none') return 'No value yet';
  if (s.kind === 'calc') return 'Calculated';
  return s.label.split(',')[0] ?? s.label;
}

export type RowState = 'current' | 'waiting' | 'missing' | 'closed' | 'deposit';

/** Whether a line has a value dated this month. Deposits are valued from their terms and never wait for a typed value. */
export function rowState(r: BankRow, today: string): RowState {
  if (r.kind === 'fd') return 'deposit';
  if (r.status === 'closed' || r.status === 'stopped') return 'closed';
  if (r.asOf === null) return 'missing';
  return r.asOf >= `${today.slice(0, 7)}-01` ? 'current' : 'waiting';
}

export interface SourceCount {
  word: string;
  kind: SourceTag['kind'];
  count: number;
}

export interface BankStanding {
  key: string;
  name: string;
  state: BankState;
  /** balances that take a typed value (savings and money held by others; closed ones left out) */
  balances: number;
  current: number;
  waiting: number;
  missing: number;
  deposits: number;
  /** matured deposits whose outcome you have not said yet */
  depositsToConfirm: number;
  /** the codes of the lines still waiting, for a short "waiting: Cash-NRE-1100" line */
  waitingCodes: string[];
  lastUpdated: string | null;
  /** how the newest value arrived */
  lastSource: SourceTag | null;
  mix: SourceCount[];
}

export function bankStanding(b: BankBlock, today: string): BankStanding {
  const rows = b.sections.flatMap((s) => s.rows);
  let balances = 0;
  let current = 0;
  let waiting = 0;
  let missing = 0;
  let deposits = 0;
  let toConfirm = 0;
  let lastUpdated: string | null = null;
  let lastSource: SourceTag | null = null;
  const codes: string[] = [];
  const mix = new Map<string, SourceCount>();
  for (const r of rows) {
    const st = rowState(r, today);
    if (st === 'closed') continue;
    if (st === 'deposit') {
      deposits++;
      if (r.fd?.needsConfirmation) toConfirm++;
      continue;
    }
    balances++;
    if (st === 'current') current++;
    else {
      waiting++;
      codes.push(r.code);
      if (st === 'missing') missing++;
    }
    const word = sourceWord(r.source);
    const m = mix.get(word) ?? { word, kind: r.source.kind, count: 0 };
    m.count++;
    mix.set(word, m);
    if (r.asOf && (!lastUpdated || r.asOf > lastUpdated)) {
      lastUpdated = r.asOf;
      lastSource = r.source;
    }
  }
  const state: BankState =
    toConfirm > 0 || missing > 0 || b.needsYou > 0
      ? 'attention'
      : waiting > 0
        ? 'waiting'
        : 'current';
  return {
    key: b.key,
    name: b.name,
    state,
    balances,
    current,
    waiting,
    missing,
    deposits,
    depositsToConfirm: toConfirm,
    waitingCodes: codes,
    lastUpdated,
    lastSource,
    mix: [...mix.values()].sort((a, c) => c.count - a.count),
  };
}

export interface StandingSummary {
  banks: number;
  current: number;
  waiting: number;
  attention: number;
  balances: number;
  balancesCurrent: number;
  depositsToConfirm: number;
  newestUpdate: string | null;
  /** how the current balances arrived, all banks together */
  mix: SourceCount[];
}

export function summarizeStandings(list: BankStanding[]): StandingSummary {
  const mix = new Map<string, SourceCount>();
  let newest: string | null = null;
  const out: StandingSummary = {
    banks: list.length,
    current: 0,
    waiting: 0,
    attention: 0,
    balances: 0,
    balancesCurrent: 0,
    depositsToConfirm: 0,
    newestUpdate: null,
    mix: [],
  };
  for (const s of list) {
    out[s.state]++;
    out.balances += s.balances;
    out.balancesCurrent += s.current;
    out.depositsToConfirm += s.depositsToConfirm;
    if (s.lastUpdated && (!newest || s.lastUpdated > newest)) newest = s.lastUpdated;
    for (const m of s.mix) {
      const x = mix.get(m.word) ?? { ...m, count: 0 };
      x.count += m.count;
      mix.set(m.word, x);
    }
  }
  out.newestUpdate = newest;
  out.mix = [...mix.values()].sort((a, c) => c.count - a.count);
  return out;
}

export function standings(blocks: BankBlock[], today: string): BankStanding[] {
  return blocks.map((b) => bankStanding(b, today));
}

/** "2026-27" -> "2025-26": the year whose tax papers (Form 26AS, AIS) are filed now. */
export function previousFy(fy: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) return fy;
  const start = Number(m[1]) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
