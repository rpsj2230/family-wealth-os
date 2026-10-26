/**
 * Applies a parsed fund statement to the household: finds (or creates) each fund, stores its transactions, and brings
 * the fund's invested amount, first purchase, SIP and value up to date. All side effects go through `CasIo`, so the rules
 * are tested without a database.
 *
 * Safety rules: a statement only changes funds of the person it belongs to; a scheme is matched by ISIN or AMFI code, or
 * by folio and name together, and an ambiguous match is left for review instead of guessed; lots are only trusted when they
 * add up to the statement's closing balance, otherwise the statement's own cost value is used.
 *
 * A fund the person holds that is missing from a COMPLETE statement (a full-portfolio fund statement, not a file of some
 * transactions) is treated as sold: the fund is closed, its units are zero and its SIP is stopped. It is listed in the report so
 * it can be put right. This is skipped when any scheme on the statement could not be matched (the missing fund might be that
 * one), and for a fund started after the statement ended or updated after it.
 */
import { coreTokens } from './amfi';
import { fifoLots, type CasScheme, type CasStatement, type CasTxn } from './cas';

export interface CasFund {
  assetId: string;
  name: string;
  amfiCode: string | null;
  isin: string | null;
  folioLast4: string | null;
  /** asset status ('active', 'closed', …); a fund with no status is taken as active */
  status?: string;
  /** when the fund's units were last counted, and when it started (YYYY-MM-DD) */
  unitsAsOf?: string | null;
  startedOn?: string | null;
}

export interface CasSave {
  assetId: string;
  scheme: CasScheme;
  transactions: CasTxn[];
  position: {
    invested: number;
    startedOn: string | null;
    sipMonthly: number | null;
    sipStopped: boolean | null;
    folioLast4: string;
    isin: string | null;
    amfiCode: string | null;
    casAsOf: string | null;
    /** units held on the statement date (0 when sold in full); null when the statement does not say */
    units: number | null;
  };
  /** value on the statement date, when it can be stated (0 for a fund that has been sold in full) */
  valuation: { amount: number; asOf: string } | null;
  /** nothing is held any more */
  closed: boolean;
}

export interface CasIo {
  funds(ownerId: string): Promise<CasFund[]>;
  isinToAmfi(isin: string): Promise<string | null>;
  createFund(args: {
    ownerId: string;
    name: string;
    isin: string | null;
    amfiCode: string | null;
    folioLast4: string;
    closed: boolean;
  }): Promise<string>;
  save(args: CasSave): Promise<{ added: number }>;
  /** closes a fund that is missing from a complete statement: zero units, SIP stopped, value zero on that date */
  markSold?(args: { assetId: string; asOf: string }): Promise<void>;
}

export interface CasReport {
  matched: number;
  created: number;
  skipped: number;
  transactionsAdded: number;
  needsReview: string[];
  /** funds closed because a complete statement did not list them */
  assumedSold: string[];
  lines: string[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sharedShare = (a: string[], b: string[]) => {
  const B = new Set(b);
  const hit = a.filter((t) => B.has(t)).length;
  return a.length === 0 ? 0 : hit / Math.max(a.length, b.length);
};

export type Match = { status: 'one'; fund: CasFund } | { status: 'none' } | { status: 'ambiguous' };

/** ISIN or AMFI code first; then folio and name together; then a clearly best name. Never a guess between equals. */
export function matchScheme(scheme: CasScheme, amfi: string | null, funds: CasFund[]): Match {
  const byId = funds.filter(
    (f) => (scheme.isin && f.isin && same(f.isin, scheme.isin)) || (amfi && f.amfiCode === amfi),
  );
  if (byId.length === 1) return { status: 'one', fund: byId[0]! };
  if (byId.length > 1) return { status: 'ambiguous' };
  const want = coreTokens(scheme.name);
  const scored = funds
    .map((f) => ({
      f,
      score: sharedShare(want, coreTokens(f.name)),
      folio: !!f.folioLast4 && f.folioLast4 === scheme.folioLast4,
    }))
    .filter((x) => x.score >= 0.75 || (x.folio && x.score >= 0.5))
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { status: 'none' };
  if (scored.length > 1 && scored[0]!.score - scored[1]!.score < 0.15)
    return { status: 'ambiguous' };
  return { status: 'one', fund: scored[0]!.f };
}

function sip(txns: CasTxn[], end: string): { monthly: number; stopped: boolean } | null {
  const s = txns
    .filter((t) => t.kind === 'sip' && t.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (s.length < 2) return null;
  const recent = s.slice(-6).map((t) => Math.round(t.amount));
  const counts = new Map<number, number>();
  for (const a of recent) counts.set(a, (counts.get(a) ?? 0) + 1);
  const monthly = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
  const last = s[s.length - 1]!.date;
  const gap = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000;
  return { monthly, stopped: gap > 45 };
}

export async function runCasImport(
  ownerId: string,
  stmt: CasStatement,
  io: CasIo,
  cfg: {
    today: string;
    /** the statement lists everything the person holds, so a fund missing from it has been sold */
    complete?: boolean;
  },
): Promise<CasReport> {
  const r: CasReport = {
    matched: 0,
    created: 0,
    skipped: 0,
    transactionsAdded: 0,
    needsReview: [],
    assumedSold: [],
    lines: [],
  };
  const touched = new Set<string>();
  const end = stmt.periodTo ?? cfg.today;
  const fyStart = `${Number(end.slice(5, 7)) >= 4 ? end.slice(0, 4) : String(Number(end.slice(0, 4)) - 1)}-04-01`;
  let funds = await io.funds(ownerId);

  for (const s of stmt.schemes) {
    try {
      const amfi = s.isin ? await io.isinToAmfi(s.isin) : null;
      const held = (s.closingUnits ?? 0) > 0.0005;
      const soldThisYear = s.transactions.some((t) => t.units < 0 && t.date >= fyStart);
      const m = matchScheme(s, amfi, funds);
      let assetId: string;
      if (m.status === 'ambiguous') {
        r.needsReview.push(s.name);
        r.lines.push(`needs review: ${s.name} (more than one of your funds could be this)`);
        continue;
      }
      if (m.status === 'one') {
        assetId = m.fund.assetId;
        touched.add(assetId);
        r.matched++;
      } else if (held || soldThisYear) {
        assetId = await io.createFund({
          ownerId,
          name: s.name,
          isin: s.isin,
          amfiCode: amfi,
          folioLast4: s.folioLast4,
          closed: !held,
        });
        touched.add(assetId);
        funds = [
          ...funds,
          { assetId, name: s.name, amfiCode: amfi, isin: s.isin, folioLast4: s.folioLast4 },
        ];
        r.created++;
      } else {
        r.skipped++;
        continue;
      }

      const lots = fifoLots(s);
      const trusted = lots.reconciled && lots.priorUnits === 0;
      const remainingCost = lots.lots.reduce((a, l) => a + (l.cost ?? 0), 0);
      const invested = !held
        ? 0
        : s.costValue !== null && !trusted
          ? s.costValue
          : trusted
            ? Math.round(remainingCost * 100) / 100
            : (s.costValue ?? remainingCost);
      const firstBuy = lots.lots.find((l) => l.acquiredOn !== '1900-01-01')?.acquiredOn ?? null;
      const started =
        s.transactions
          .filter((t) => t.units > 0)
          .map((t) => t.date)
          .sort()[0] ?? firstBuy;
      const sp = held ? sip(s.transactions, end) : null;
      const asOf = s.navDate ?? stmt.periodTo;
      const amount =
        s.marketValue ??
        (s.nav !== null && s.closingUnits !== null ? s.nav * s.closingUnits : null);
      const res = await io.save({
        assetId,
        scheme: s,
        transactions: s.transactions,
        position: {
          invested,
          // units from before the statement mean the first purchase is not on it
          startedOn: lots.priorUnits > 0 ? null : started,
          sipMonthly: sp?.monthly ?? null,
          sipStopped: sp ? sp.stopped : null,
          folioLast4: s.folioLast4,
          isin: s.isin,
          amfiCode: amfi,
          casAsOf: asOf,
          units: s.closingUnits === null ? null : held ? s.closingUnits : 0,
        },
        valuation: !asOf
          ? null
          : !held
            ? { amount: 0, asOf }
            : amount !== null
              ? { amount: Math.round(amount * 100) / 100, asOf }
              : null,
        closed: !held,
      });
      r.transactionsAdded += res.added;
      r.lines.push(
        `${m.status === 'one' ? 'updated' : 'added'}: ${s.name} (${res.added} new transactions${trusted ? '' : lots.priorUnits > 0 ? ', earlier history not on this statement' : ', lots do not match the closing balance'})`,
      );
    } catch (e) {
      r.needsReview.push(s.name);
      r.lines.push(`error: ${s.name}: ${(e as Error).message}`);
    }
  }
  const asOf = stmt.periodTo;
  if (cfg.complete && io.markSold && asOf && stmt.schemes.length > 0) {
    if (r.needsReview.length > 0) {
      r.lines.push(
        'Funds missing from the statement were not closed: some funds on it could not be matched, and a missing one might be among them.',
      );
    } else {
      for (const f of funds) {
        if (touched.has(f.assetId) || (f.status ?? 'active') !== 'active') continue;
        // started after the statement ended, or updated after it: the statement could not know about it
        if (f.startedOn && f.startedOn > asOf) continue;
        if (f.unitsAsOf && f.unitsAsOf > asOf) continue;
        try {
          await io.markSold({ assetId: f.assetId, asOf });
          r.assumedSold.push(f.name);
          r.lines.push(`assumed sold: ${f.name} (not on the statement dated ${asOf})`);
        } catch (e) {
          r.needsReview.push(f.name);
          r.lines.push(`error: ${f.name}: ${(e as Error).message}`);
        }
      }
    }
  }
  return r;
}
