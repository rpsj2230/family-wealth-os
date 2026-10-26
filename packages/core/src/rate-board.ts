/**
 * What the Rates page shows for each bank: its best savings and deposit rates, how they moved last, and a history of the best rates
 * replayed from the change log. Pure.
 */
import { sameBank, type RateOffer } from './rates';

export interface BoardOffer extends RateOffer {
  /** what the reader had read, when you replaced it with your own figure */
  aiRate?: number | null;
  correctionReason?: string | null;
  /** what the bank's page says now, when it differs from the stored rate */
  pageRate?: number | null;
  pageSeenOn?: string | null;
  misreadCount?: number;
}

export interface RateEventRow {
  at: string;
  bank: string;
  product: 'savings' | 'fd';
  accountKind: string;
  tenureFrom: number;
  tenureTo: number;
  balanceFrom: number | null;
  balanceTo: number | null;
  kind: 'added' | 'changed' | 'corrected' | 'confirmed' | 'removed';
  oldRate: number | null;
  newRate: number | null;
  source: 'manual' | 'ai';
  reason: string | null;
}

const isNreFd = (o: { product: string; accountKind: string }) =>
  o.product === 'fd' && o.accountKind !== 'NRO' && o.accountKind !== 'resident';

export interface BankSummary {
  bank: string;
  savings: BoardOffer[];
  deposits: BoardOffer[];
  bestSaving: BoardOffer | null;
  bestFd: BoardOffer | null;
  /** most recent check of any rate for this bank */
  checkedOn: string | null;
  /** typed or corrected rates the bank's page disagrees with */
  differs: number;
  /** corrections the reader keeps getting wrong */
  misread: number;
  /** the latest change to the best rates, if the log has one */
  lastMove: { product: 'savings' | 'fd'; from: number; to: number; at: string } | null;
}

export function bankSummary(
  offers: BoardOffer[],
  events: RateEventRow[],
  bank: string,
): BankSummary {
  const mine = offers.filter((o) => sameBank(o.bank, bank));
  const savings = mine
    .filter((o) => o.product === 'savings')
    .sort((a, b) => (a.balanceFrom ?? 0) - (b.balanceFrom ?? 0));
  const deposits = mine
    .filter((o) => o.product === 'fd')
    .sort((a, b) => a.tenureFrom - b.tenureFrom || a.accountKind.localeCompare(b.accountKind));
  const best = (xs: BoardOffer[]) =>
    xs.reduce<BoardOffer | null>((m, o) => (!m || o.rate > m.rate ? o : m), null);
  const moves = events
    .filter(
      (e) =>
        sameBank(e.bank, bank) &&
        (e.kind === 'changed' || e.kind === 'corrected') &&
        e.oldRate !== null &&
        e.newRate !== null,
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const move = moves[0];
  return {
    bank,
    savings,
    deposits,
    bestSaving: best(savings),
    bestFd: best(deposits.filter(isNreFd)),
    checkedOn: mine.reduce<string | null>(
      (m, o) => (!m || o.checkedOn > m ? o.checkedOn : m),
      null,
    ),
    differs: mine.filter((o) => o.pageRate !== null && o.pageRate !== undefined).length,
    misread: mine.filter((o) => (o.misreadCount ?? 0) > 0).length,
    lastMove: move
      ? { product: move.product, from: move.oldRate!, to: move.newRate!, at: move.at }
      : null,
  };
}

const slot = (
  e: Pick<
    RateEventRow,
    'bank' | 'product' | 'accountKind' | 'tenureFrom' | 'tenureTo' | 'balanceFrom' | 'balanceTo'
  >,
) =>
  [
    e.bank.toLowerCase().replace(/[^a-z0-9]/g, ''),
    e.product,
    e.accountKind,
    e.tenureFrom,
    e.tenureTo,
    e.balanceFrom ?? 0,
    e.balanceTo ?? -1,
  ].join('|');

export interface TopRatePoint {
  date: string;
  fd: number | null;
  savings: number | null;
}

/** The best deposit and savings rate at a bank over time, replayed from its change log (one point per day on which either moved). */
export function topRateHistory(events: RateEventRow[], bank: string): TopRatePoint[] {
  const mine = events
    .filter((e) => sameBank(e.bank, bank))
    .sort((a, b) => a.at.localeCompare(b.at));
  const state = new Map<string, { product: string; accountKind: string; rate: number }>();
  const out: TopRatePoint[] = [];
  for (const e of mine) {
    const k = slot(e);
    if (e.kind === 'removed' || e.newRate === null) state.delete(k);
    else state.set(k, { product: e.product, accountKind: e.accountKind, rate: e.newRate });
    let fd: number | null = null;
    let sv: number | null = null;
    for (const s of state.values()) {
      if (s.product === 'savings') sv = sv === null ? s.rate : Math.max(sv, s.rate);
      else if (isNreFd(s)) fd = fd === null ? s.rate : Math.max(fd, s.rate);
    }
    const date = e.at.slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.date === date) {
      last.fd = fd;
      last.savings = sv;
    } else if (!last || last.fd !== fd || last.savings !== sv) out.push({ date, fd, savings: sv });
  }
  return out;
}
