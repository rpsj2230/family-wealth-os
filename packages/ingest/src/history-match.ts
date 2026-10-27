/**
 * Which account on file is a line on an old tab? Pure rules, no guessing between equals: a line that two accounts could be is
 * reported as ambiguous, never written to either.
 *
 * The facts on a tab differ from year to year. A deposit is recognised by what never changes (whose it is, which bank, the day it
 * matures, how much was put in); a savings balance by its last four digits or its label when the tab has them, else by bank, person
 * and NRE/NRO when only one account fits; a fund by the words of its name.
 */
import { coreTokens } from './amfi';

export type RowKind = 'fd' | 'cash' | 'cash_sg' | 'held' | 'fund' | 'ulip' | 'loan' | 'third_party';

/** A line of a monthly tab, reduced to what matching needs. */
export interface HistRow {
  tab: string;
  /** sheet row */
  row: number;
  /** the cell the amount was read from, e.g. "F12" */
  cell: string;
  kind: RowKind;
  /** the plan's key for the line ("cash:7") */
  key: string;
  label: string;
  ownerName: string;
  /** the owner is the household default because the tab does not say */
  ownerAssumed: boolean;
  bank: string | null;
  holderName: string | null;
  last4: string | null;
  accountKind: 'NRE' | 'NRO' | null;
  joint: boolean;
  currency: 'INR' | 'SGD';
  /** the amount in the line's own currency (a deposit: its principal) */
  amount: number;
  fxRate: number | null;
  /** the line is a fund's name (funds) or the counterparty (loans) */
  name: string;
  /** a fund's start date and goal tag, as the tab writes them */
  startedOn?: string | null;
  goal?: string | null;
  /** a loan's date, when the tab gives one */
  dated: string | null;
  fd: {
    principal: number;
    rate: number;
    bookedOn: string | null;
    maturityOn: string;
    maturityAmount: number | null;
    ref: string | null;
  } | null;
}

/** An account, deposit or fund already on file. */
export interface ExistingAsset {
  id: string;
  type: string;
  status: string;
  nickname: string;
  label: string | null;
  last4: string | null;
  accountKind: string | null;
  joint: boolean;
  holderName: string | null;
  currency: string;
  ownerName: string;
  bank: string | null;
  fd: {
    principal: number;
    rate: number;
    bookedOn: string;
    maturityOn: string;
    ref: string | null;
    refLast4: string | null;
  } | null;
  /** a fund's registered name and the last four digits of its folio */
  fundName?: string | null;
  folioLast4?: string | null;
  /** a fund's first purchase and the goal it is allocated to, to tell apart two funds of one name */
  startedOn?: string | null;
  goal?: string | null;
}

export type Match =
  | {
      status: 'matched';
      assetId: string;
      /** the account was chosen only because the line does not say "joint": the accounts it could have been (including joint ones) */
      assumedFrom?: string[];
    }
  | { status: 'none' }
  | { status: 'ambiguous'; reason: string; candidates?: string[] };

/** "Yes Bank", "YES BANK Ltd." and "Yes" are one bank. */
export function bankKey(name: string | null | undefined): string {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(ltd|limited|pvt|private)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = s.replace(/\bbank\b/g, '').replace(/\s+/g, '');
  return stripped.length >= 2 ? stripped : s.replace(/\s+/g, '');
}

export const personKey = (n: string | null | undefined): string => (n ?? '').trim().toLowerCase();
const labelKey = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const money = (n: number): string => String(Math.round(n * 100) / 100);

/** What a deposit is, whatever else is edited on it. */
export function fdKey(o: {
  ownerName: string;
  bank: string | null;
  maturityOn: string;
  principal: number;
}): string {
  return [personKey(o.ownerName), bankKey(o.bank), o.maturityOn, money(o.principal)].join('|');
}

const refKey = (r: string | null | undefined): string =>
  (r ?? '').replace(/\s+/g, '').toLowerCase();

/**
 * Deposits of one tab against deposits on file. Several deposits can have the same key (two equal deposits in one bank); they are
 * interchangeable, so the first lines take the first deposits on file, those with the same deposit number first. Returns, per line,
 * the matched deposit or the number of that line among its equals (to name the historical deposit if it is not on file).
 */
export function matchDeposits(
  rows: HistRow[],
  existing: ExistingAsset[],
): Map<string, { match: Match; ordinal: number }> {
  const out = new Map<string, { match: Match; ordinal: number }>();
  const byKey = new Map<string, HistRow[]>();
  for (const r of rows) {
    if (r.kind !== 'fd' || !r.fd) continue;
    const k = fdKey({ ownerName: r.ownerName, bank: r.bank, ...r.fd });
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const deposits = existing.filter((a) => a.fd);
  const used = new Set<string>();
  for (const [k, lines] of byKey) {
    const pool = deposits.filter(
      (a) => fdKey({ ownerName: a.ownerName, bank: a.bank, ...a.fd! }) === k,
    );
    lines.forEach((line, i) => {
      const want = refKey(line.fd!.ref);
      const pick =
        (want ? pool.find((a) => !used.has(a.id) && refKey(a.fd!.ref) === want) : undefined) ??
        pool.find((a) => !used.has(a.id));
      if (pick) {
        used.add(pick.id);
        out.set(line.key, { match: { status: 'matched', assetId: pick.id }, ordinal: i + 1 });
      } else out.set(line.key, { match: { status: 'none' }, ordinal: i + 1 });
    });
  }
  // the same deposit number as a deposit on file whose terms differ: not the same deposit, not a new one either
  for (const r of rows) {
    const hit = out.get(r.key);
    if (r.kind !== 'fd' || !r.fd || !hit || hit.match.status !== 'none') continue;
    const want = refKey(r.fd.ref);
    if (!want) continue;
    const clash = deposits.find(
      (a) =>
        refKey(a.fd!.ref) === want &&
        personKey(a.ownerName) === personKey(r.ownerName) &&
        bankKey(a.bank) === bankKey(r.bank),
    );
    if (clash)
      out.set(r.key, {
        ordinal: hit.ordinal,
        match: {
          status: 'ambiguous',
          reason: `Its deposit number is the same as a deposit on file whose amount or maturity date is different; it may have been renewed or mistyped.`,
        },
      });
  }
  return out;
}

/** Accounts, shares, loans and funds. Deposits go through `matchDeposits`. */
export function matchOther(row: HistRow, existing: ExistingAsset[]): Match {
  switch (row.kind) {
    case 'cash':
    case 'cash_sg':
    case 'held':
      return matchCash(row, existing);
    case 'fund':
    case 'ulip':
      return matchFund(row, existing);
    case 'loan':
      return matchLoan(row, existing);
    case 'third_party':
      return matchHeld(row, existing);
    default:
      return { status: 'none' };
  }
}

function pickOne(c: ExistingAsset[], what: string): Match {
  if (c.length === 1) return { status: 'matched', assetId: c[0]!.id };
  if (c.length === 0) return { status: 'none' };
  return {
    status: 'ambiguous',
    reason: `${c.length} ${what} fit this line (${c
      .slice(0, 4)
      .map((a) => a.label ?? a.nickname)
      .join('; ')}${c.length > 4 ? '; …' : ''}), so it was not guessed.`,
    candidates: c.map((a) => a.id),
  };
}

/**
 * The accounts on file a savings or cash line could be, before anything is narrowed down: same bank, person and currency, and not an
 * account whose last four digits or NRE/NRO kind differ from what the line states. Order is the order on file.
 */
export function cashPool(row: HistRow, existing: ExistingAsset[]): ExistingAsset[] {
  const wantType = row.kind === 'held' ? 'third_party_held' : 'bank_account';
  return existing.filter(
    (a) =>
      a.type === wantType &&
      a.currency === row.currency &&
      bankKey(a.bank) === bankKey(row.bank) &&
      (row.kind === 'held'
        ? personKey(a.holderName) === personKey(row.holderName)
        : row.ownerAssumed || personKey(a.ownerName) === personKey(row.ownerName)) &&
      // an account whose last four digits or NRE/NRO kind differ from the line's is a different account, even when it is the only one
      !(row.last4 && a.last4 && a.last4 !== row.last4) &&
      !(row.accountKind && a.accountKind && a.accountKind !== row.accountKind),
  );
}

function matchCash(row: HistRow, existing: ExistingAsset[]): Match {
  let c = cashPool(row, existing);
  if (c.length <= 1) return pickOne(c, 'accounts');
  // narrow by what the line says about itself, keeping the narrowing only while something is left
  if (row.last4) {
    const n = c.filter((a) => a.last4 === row.last4 || (a.label ?? '').includes(row.last4!));
    if (n.length > 0) c = n;
    else return { status: 'none' };
  } else {
    const lk = labelKey(row.label);
    if (lk && lk !== 'cash') {
      const n = c.filter((a) => labelKey(a.label) === lk);
      if (n.length > 0) c = n;
    }
  }
  if (c.length > 1 && row.accountKind) {
    const n = c.filter((a) => !a.accountKind || a.accountKind === row.accountKind);
    if (n.length > 0) c = n;
  }
  if (c.length > 1 && row.joint !== undefined) {
    const n = c.filter((a) => a.joint === row.joint);
    if (n.length > 0) {
      // a line that does not say "joint" is taken to be an account that is not; that is an assumption, and is reported as one
      const assumed = !row.joint && n.length < c.length ? c.map((a) => a.id) : null;
      c = n;
      const m = pickOne(c, 'accounts');
      return assumed && m.status === 'matched' ? { ...m, assumedFrom: assumed } : m;
    }
  }
  return pickOne(c, 'accounts');
}

function matchHeld(row: HistRow, existing: ExistingAsset[]): Match {
  const nick = labelKey(`${row.label} (${row.holderName ?? ''})`);
  const c = existing.filter(
    (a) =>
      a.type === 'third_party_held' &&
      (labelKey(a.nickname) === nick || labelKey(a.nickname).startsWith(labelKey(row.name))) &&
      (!row.holderName || personKey(a.holderName) === personKey(row.holderName)),
  );
  return pickOne(c, 'holdings');
}

function matchLoan(row: HistRow, existing: ExistingAsset[]): Match {
  const first = (s: string) => personKey(s).split(/\s+/)[0] ?? '';
  const want = first(row.name);
  if (!want) return { status: 'none' };
  let c = existing.filter(
    (a) => a.type === 'receivable' && first(a.nickname.replace(/\(.*$/, '')) === want,
  );
  if (c.length > 1 && row.dated) {
    const n = c.filter((a) => a.nickname.includes(row.dated!));
    if (n.length > 0) c = n;
  } else if (c.length > 1) {
    // a line with no date is the one whose record has none either
    const n = c.filter((a) => !/\d{4}-\d{2}-\d{2}/.test(a.nickname));
    if (n.length > 0) c = n;
  }
  if (c.length > 1) {
    // the name as written ("Sam Roe") against a shorter older spelling ("Sam")
    const full = labelKey(row.name);
    const n = c.filter((a) => labelKey(a.nickname.replace(/\(.*$/, '')) === full);
    if (n.length > 0) c = n;
  }
  return pickOne(c, 'loans');
}

function matchFund(row: HistRow, existing: ExistingAsset[]): Match {
  const want = coreTokens(row.name);
  if (want.length === 0) return { status: 'none' };
  const kind = row.kind === 'ulip' ? 'ulip' : 'mutual_fund';
  const share = (a: string[], b: string[]) => {
    const B = new Set(b);
    return a.length === 0 ? 0 : a.filter((t) => B.has(t)).length / Math.max(a.length, b.length);
  };
  const scored = existing
    .filter((a) => a.type === kind)
    .map((a) => ({
      a,
      score: share(want, coreTokens(a.fundName ?? a.nickname)),
      owner: row.ownerAssumed || personKey(a.ownerName) === personKey(row.ownerName),
    }))
    .filter((x) => x.score >= 0.75 && x.owner)
    .sort((x, y) => y.score - x.score);
  if (scored.length === 0) return { status: 'none' };
  let top = scored.filter((x) => scored[0]!.score - x.score < 0.15).map((x) => x.a);
  if (top.length > 1 && row.startedOn) {
    const n = top.filter((a) => a.startedOn === row.startedOn);
    if (n.length > 0) top = n;
  }
  if (top.length > 1 && row.goal) {
    const n = top.filter((a) => labelKey(a.goal) === labelKey(row.goal));
    if (n.length > 0) top = n;
  }
  if (top.length > 1)
    return {
      status: 'ambiguous',
      reason: `${top.length} funds on file have a name like "${row.name}" (same person), so it was not guessed.`,
    };
  return { status: 'matched', assetId: top[0]!.id };
}
