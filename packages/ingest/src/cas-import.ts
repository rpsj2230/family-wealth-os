/**
 * Applies a parsed fund statement to the household in two steps that can be told apart: `planCasImport` reads what is on file and
 * compares it with the statement (nothing is written, `diffFundImport` in core decides what is new, changed, sold or stopped), and
 * `applyFundDiff` writes only the items that were chosen. `runCasImport` does both, for the mailbox job. All side effects go through
 * `CasIo`, so the rules are tested without a database.
 *
 * Safety rules: a statement only changes funds of the person it belongs to; a scheme is matched by ISIN or AMFI code, or by folio and
 * name together, and an ambiguous match is left for review instead of guessed; lots are only trusted when they add up to the
 * statement's closing balance, otherwise the statement's own cost value is used. Nothing already on file is deleted or replaced by
 * the comparison: only lines that are not stored yet, and values that are new or changed, are written.
 *
 * A fund the person holds that is missing from a COMPLETE statement (a full-portfolio fund statement, not a file of some
 * transactions) is treated as sold, and listed so it can be put right. This is skipped when any scheme on the statement could not
 * be matched (the missing fund might be that one), for a depository-only statement, and for a fund started or counted after the
 * statement ended.
 */
import {
  DEFAULT_CONFIG,
  diffFundImport,
  replaceIsChange,
  replaceKey,
  sipIsChange,
  sipKey,
  statementLineKeys,
  storedChanges,
  summariseChanges,
  type FundChangeItem,
  type FundImportDiff,
  type IgnorableVerdict,
  type FundWrite,
  type OnFileState,
  type SipChange,
  type StatementFund,
} from '@fwos/core';
import { schemeKey, schemeKeysCompatible } from './amfi';
import { fifoLots, type CasScheme, type CasStatement } from './cas';

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
  /** what is stored for the fund (units, amount invested, SIP and its history, lines, values); absent when not known, and every value is then taken as changed */
  state?: OnFileState;
}

export interface CasSave {
  assetId: string;
  /** only the lines that are not stored yet, each with the reference it is stored under */
  transactions: FundWrite['lines'];
  /** where the new lines are stored from ('cas' for a statement, 'csv' for an app export) */
  lineSource: 'cas' | 'csv';
  /** stored lines the statement replaces: set aside (never deleted) under the statement that replaced them */
  replace: {
    keys: string[];
    reason: string;
    statementRef: string;
    statementOn: string;
  } | null;
  /** only the fields that are new or changed */
  position: FundWrite['position'];
  valuation: FundWrite['valuation'];
  /** nothing is held any more */
  closed: boolean;
  /** dated changes of the SIP to record, oldest first (0 = stopped from that date) */
  sip: { monthly: number; effectiveOn: string }[];
}

export interface CasIo {
  /** the person's funds with what is stored for each; `dates` are the statement dates whose stored values are wanted */
  funds(ownerId: string, ctx?: { dates: string[] }): Promise<CasFund[]>;
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
  /** remembers an overruled verdict so it is not proposed again for the same statement */
  rememberIgnored?(args: {
    assetId: string;
    verdict: IgnorableVerdict;
    basis: string;
  }): Promise<void>;
}

export interface CasReport {
  /** funds on the statement that are among yours */
  matched: number;
  created: number;
  skipped: number;
  /** funds with nothing new */
  unchanged: number;
  transactionsAdded: number;
  needsReview: string[];
  /** funds closed because a complete statement did not list them, or because they were sold in full */
  assumedSold: string[];
  lines: string[];
  /** "2 funds updated: +5 transactions; 1 SIP stopped; 1 fund sold" */
  summary: string;
  /** everything proposed, with what was applied */
  changes: ReturnType<typeof storedChanges>;
  /** funds on the statement (several folios of one fund count once) */
  statementFunds: number;
}

/** The items to apply: those whose key is in `take`. An item that was shown (`seen`) and not taken is remembered as overruled. */
export interface Selection {
  take: ReadonlySet<string>;
  seen: ReadonlySet<string>;
}

export { sipKey };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sharedShare = (a: string[], b: string[]) => {
  const B = new Set(b);
  const hit = a.filter((t) => B.has(t)).length;
  return a.length === 0 ? 0 : hit / Math.max(a.length, b.length);
};

export type Match = { status: 'one'; fund: CasFund } | { status: 'none' } | { status: 'ambiguous' };

/**
 * ISIN or AMFI code first; then the scheme's name by a tolerant key (the same words in any order, with the plan and option agreeing);
 * then a clearly best partial name. A fund whose ISIN differs from the scheme's is a different fund whatever its name. Folio breaks a
 * tie between two of your funds that are the same scheme. Never a guess between equals.
 */
export function matchScheme(scheme: CasScheme, amfi: string | null, funds: CasFund[]): Match {
  const sameFolio = (f: CasFund) => !!f.folioLast4 && f.folioLast4 === scheme.folioLast4;
  const pick = (found: CasFund[]): Match => {
    if (found.length === 1) return { status: 'one', fund: found[0]! };
    if (found.length === 0) return { status: 'none' };
    const byFolio = found.filter(sameFolio);
    return byFolio.length === 1 ? { status: 'one', fund: byFolio[0]! } : { status: 'ambiguous' };
  };
  const byId = funds.filter(
    (f) => (scheme.isin && f.isin && same(f.isin, scheme.isin)) || (amfi && f.amfiCode === amfi),
  );
  if (byId.length > 0) return pick(byId);

  const want = schemeKey(scheme.name);
  const pool = funds.filter(
    (f) =>
      !(scheme.isin && f.isin && !same(f.isin, scheme.isin)) &&
      schemeKeysCompatible(want, schemeKey(f.name)),
  );
  const exact = pool.filter((f) => want.tokens.length > 0 && schemeKey(f.name).key === want.key);
  if (exact.length > 0) return pick(exact);

  const scored = pool
    .map((f) => ({
      f,
      score: sharedShare(want.tokens, schemeKey(f.name).tokens),
      folio: sameFolio(f),
    }))
    .filter((x) => x.score >= 0.75 || (x.folio && x.score >= 0.5))
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { status: 'none' };
  if (scored.length > 1 && scored[0]!.score - scored[1]!.score < 0.15)
    return { status: 'ambiguous' };
  return { status: 'one', fund: scored[0]!.f };
}

const money = (n: number) => Math.round(n * 100) / 100;

/** One scheme of the statement as the comparison wants it: lines with their references, units, amount invested, first purchase, value. */
function statementFund(
  s: CasScheme,
  match: StatementFund['match'],
  amfi: string | null,
  stmt: CasStatement,
  fyStart: string,
): StatementFund {
  const known = s.closingUnits !== null;
  const held = known ? s.closingUnits! > 0.0005 : false;
  const lots = fifoLots(s);
  const trusted = lots.reconciled && lots.priorUnits === 0;
  const remainingCost = lots.lots.reduce((a, l) => a + (l.cost ?? 0), 0);
  const invested = !known
    ? s.costValue
    : !held
      ? 0
      : s.costValue !== null && !trusted
        ? s.costValue
        : trusted
          ? money(remainingCost)
          : (s.costValue ?? remainingCost);
  const firstBuy = lots.lots.find((l) => l.acquiredOn !== '1900-01-01')?.acquiredOn ?? null;
  const started =
    s.transactions
      .filter((t) => t.units > 0)
      .map((t) => t.date)
      .sort()[0] ?? firstBuy;
  const asOf = s.navDate ?? stmt.periodTo;
  const amount =
    s.marketValue ?? (s.nav !== null && s.closingUnits !== null ? s.nav * s.closingUnits : null);
  const keys = statementLineKeys(s.folio, s.transactions);
  return {
    name: s.name,
    isin: s.isin,
    amfiCode: amfi,
    folioLast4: s.folioLast4,
    lines: s.transactions.map((t, i) => ({
      key: keys[i]!,
      date: t.date,
      kind: t.kind,
      description: t.description,
      amount: t.amount,
      units: t.units,
      nav: t.nav,
      balance: t.balance,
    })),
    closingUnits: s.closingUnits === null ? null : held ? s.closingUnits : 0,
    openingUnits: s.openingUnits,
    // a closing balance the statement does not give is not read as "sold"
    held: known ? held : true,
    invested: invested === null ? null : money(invested),
    // units from before the statement mean the first purchase is not on it
    startedOn: lots.priorUnits > 0 ? null : started,
    value: !asOf
      ? null
      : !known
        ? null
        : !held
          ? { amount: 0, asOf, nav: s.nav && s.nav > 0 ? s.nav : null }
          : amount !== null
            ? { amount: money(amount), asOf, nav: s.nav && s.nav > 0 ? s.nav : null }
            : null,
    holdingsOnly: s.holdingsOnly,
    soldThisYear: s.transactions.some((t) => t.units < 0 && t.date >= fyStart),
    sipCancelled: s.sipCancelled ?? null,
    unclear: s.unclear ?? null,
    match,
  };
}

/** Two folios of one fund are one holding: units, amounts and values add up; a figure either folio cannot give stays unknown. */
function combine(a: StatementFund, b: StatementFund): StatementFund {
  const both = <T>(x: T | null, y: T | null, f: (x: T, y: T) => T): T | null =>
    x !== null && y !== null ? f(x, y) : null;
  return {
    ...a,
    lines: [...a.lines, ...b.lines],
    closingUnits: both(a.closingUnits, b.closingUnits, (x, y) => x + y),
    openingUnits: both(a.openingUnits, b.openingUnits, (x, y) => x + y),
    held: a.held || b.held,
    invested: both(a.invested, b.invested, (x, y) => money(x + y)),
    startedOn: both(a.startedOn, b.startedOn, (x, y) => (x < y ? x : y)),
    value: both(a.value, b.value, (x, y) => ({
      amount: money(x.amount + y.amount),
      asOf: x.asOf > y.asOf ? x.asOf : y.asOf,
      nav: null,
    })),
    holdingsOnly: a.holdingsOnly && b.holdingsOnly,
    soldThisYear: a.soldThisYear || b.soldThisYear,
    sipCancelled: a.sipCancelled ?? b.sipCancelled ?? null,
    unclear: a.unclear ?? b.unclear ?? null,
  };
}

export interface PlanConfig {
  today: string;
  /** the statement lists everything the person holds, so a fund missing from it has been sold */
  complete?: boolean;
  /** 'file' for a transactions file from an investment app */
  source?: 'statement' | 'file';
  /** instalments in a row that make a SIP (Settings: estimates.sipMinInstalments) */
  sipMinInstalments?: number;
  unitTolerance?: number;
  moneyTolerance?: number;
}

/** A person of the household, by the last four characters of the PAN saved for them. */
export interface PanOwner {
  ownerId: string;
  panLast4: string | null;
}

export interface SkippedFolios {
  /** the PAN printed on the folios, last four characters only */
  panLast4: string | null;
  holder: string | null;
  schemes: string[];
}

/**
 * A statement keyed on an email address can hold the folios of several people. Each scheme belongs to the person whose PAN is
 * printed on its folio (never to whoever opened the file); a scheme with no PAN printed goes to `fallbackOwner`. Folios of someone
 * who is not in the list are returned apart, so they are named and skipped, not guessed.
 */
export function splitByOwner(
  stmt: CasStatement,
  owners: PanOwner[],
  fallbackOwner: string | null,
): { groups: { ownerId: string; stmt: CasStatement }[]; skipped: SkippedFolios[] } {
  const by = new Map<string, CasScheme[]>();
  const skipped = new Map<string, SkippedFolios>();
  for (const sc of stmt.schemes) {
    const last4 = sc.folioPan ? sc.folioPan.slice(-4) : null;
    const hit = last4
      ? owners.filter((o) => o.panLast4 && o.panLast4.toUpperCase() === last4.toUpperCase())
      : [];
    const owner: string | null = last4
      ? hit.length === 1
        ? hit[0]!.ownerId
        : null
      : fallbackOwner;
    if (owner) by.set(owner, [...(by.get(owner) ?? []), sc]);
    else {
      const k = last4 ?? 'none';
      const cur = skipped.get(k) ?? { panLast4: last4, holder: sc.holder ?? null, schemes: [] };
      cur.schemes.push(sc.name);
      skipped.set(k, cur);
    }
  }
  return {
    groups: [...by.entries()].map(([ownerId, schemes]) => ({
      ownerId,
      stmt: { ...stmt, schemes },
    })),
    skipped: [...skipped.values()],
  };
}

/** Reads what is on file and compares it with the statement. Writes nothing. */
export async function planCasImport(
  ownerId: string,
  stmt: CasStatement,
  io: CasIo,
  cfg: PlanConfig,
): Promise<FundImportDiff> {
  const end = stmt.periodTo ?? cfg.today;
  const fyStart = `${Number(end.slice(5, 7)) >= 4 ? end.slice(0, 4) : String(Number(end.slice(0, 4)) - 1)}-04-01`;
  const dates = [
    ...new Set(stmt.schemes.map((s) => s.navDate ?? stmt.periodTo).filter((d): d is string => !!d)),
  ];
  const funds = await io.funds(ownerId, { dates });
  const groups = new Map<string, StatementFund>();
  let n = 0;
  for (const s of stmt.schemes) {
    const amfi = s.isin ? await io.isinToAmfi(s.isin) : null;
    const m = matchScheme(s, amfi, funds);
    const match: StatementFund['match'] =
      m.status === 'one' ? { status: 'one', assetId: m.fund.assetId } : { status: m.status };
    const sf = statementFund(s, match, amfi, stmt, fyStart);
    const key =
      m.status === 'one'
        ? `one:${m.fund.assetId}`
        : m.status === 'none'
          ? `none:${(s.isin ?? s.name).toLowerCase()}`
          : `amb:${n++}`;
    const have = groups.get(key);
    groups.set(key, have ? combine(have, sf) : sf);
  }
  const d = DEFAULT_CONFIG;
  return diffFundImport({
    ownerId,
    source: cfg.source ?? 'statement',
    complete: cfg.complete ?? false,
    ...(stmt.basis ? { basis: stmt.basis } : {}),
    periodFrom: stmt.periodFrom,
    periodTo: stmt.periodTo ?? (cfg.source === 'file' ? cfg.today : null),
    today: cfg.today,
    funds: [...groups.values()],
    onFile: funds.map((f) => ({
      assetId: f.assetId,
      name: f.name,
      isin: f.isin,
      amfiCode: f.amfiCode,
      folioLast4: f.folioLast4,
      status: f.status ?? 'active',
      unitsAsOf: f.unitsAsOf ?? null,
      startedOn: f.startedOn ?? null,
      state: f.state ?? null,
    })),
    rules: {
      sipMinInstalments: cfg.sipMinInstalments ?? d.estimates.sipMinInstalments,
      unitTolerance: cfg.unitTolerance ?? d.funds.unitTolerance,
      moneyTolerance: cfg.moneyTolerance ?? d.funds.moneyTolerance,
    },
  });
}

/** Writes the items that were chosen (all of them when there is no selection), and nothing else. */
export async function applyFundDiff(
  diff: FundImportDiff,
  io: CasIo,
  selection: Selection | null = null,
  ctx: { statementRef?: string } = {},
): Promise<CasReport> {
  const r: CasReport = {
    matched: 0,
    created: 0,
    skipped: diff.skipped,
    unchanged: 0,
    transactionsAdded: 0,
    needsReview: [],
    assumedSold: [],
    lines: [],
    summary: '',
    changes: [],
    statementFunds: diff.statementFunds,
  };
  const taken = (k: string) => !selection || selection.take.has(k);
  const shown = (k: string) => !!selection && selection.seen.has(k);
  const applied = {
    funds: new Set<string>(),
    sips: new Set<string>(),
    replaces: new Set<string>(),
  };

  r.matched = diff.items.filter(
    (i) => i.assetId && i.kind !== 'review' && !i.write?.markSoldAsOf && i.kind !== 'new',
  ).length;
  for (const item of diff.items) {
    try {
      if (item.kind === 'review') {
        r.needsReview.push(item.name);
        r.lines.push(
          item.reviewKind === 'absent'
            ? `not on this statement, not marked as sold: ${item.name} (check it)`
            : `needs review: ${item.name} (more than one of your funds could be this)`,
        );
        continue;
      }
      if (item.kind === 'unchanged' && !sipIsChange(item.sip)) {
        // the period the statement decided is recorded quietly, so an older statement cannot override it later
        if (item.write && item.assetId && !item.changed) {
          await io.save({
            assetId: item.assetId,
            transactions: [],
            lineSource: item.write.lineSource ?? 'cas',
            replace: null,
            position: item.write.position,
            valuation: null,
            closed: false,
            sip: [],
          });
        }
        if (item.assetId) r.unchanged++;
        continue;
      }
      const fundOn = item.changed && taken(item.key);
      const dependent = item.kind === 'new' || item.kind === 'sold';
      const sipOn = sipIsChange(item.sip) && taken(sipKey(item.key)) && (!dependent || fundOn);

      if (item.changed && !fundOn && shown(item.key) && item.ignore && item.assetId)
        await io.rememberIgnored?.({ assetId: item.assetId, ...item.ignore });
      if (
        sipIsChange(item.sip) &&
        !sipOn &&
        shown(sipKey(item.key)) &&
        item.sip.verdict &&
        item.sip.basis &&
        item.assetId
      )
        await io.rememberIgnored?.({
          assetId: item.assetId,
          verdict: item.sip.verdict,
          basis: item.sip.basis,
        });
      if (!fundOn && !sipOn) continue;

      const w = item.write;
      if (fundOn && w?.markSoldAsOf) {
        if (!io.markSold) throw new Error('this importer cannot close a fund');
        await io.markSold({ assetId: item.assetId!, asOf: w.markSoldAsOf });
        r.assumedSold.push(item.name);
        r.lines.push(`assumed sold: ${item.name} (${item.why ?? 'not on the statement'})`);
        applied.funds.add(item.key);
        continue;
      }
      let assetId = item.assetId;
      if (fundOn && w?.create) {
        assetId = await io.createFund({ ownerId: diff.ownerId, ...w.create });
        r.created++;
      }
      if (!assetId) continue;
      const sip: SipChange | null = sipOn ? item.sip : null;
      // the statement replaces the lines on file unless that part was unticked
      const replaceOn = fundOn && !!w?.replace && taken(replaceKey(item.key));
      const res = await io.save({
        assetId,
        transactions: fundOn && w ? w.lines : [],
        lineSource: w?.lineSource ?? 'cas',
        replace:
          replaceOn && w?.replace
            ? {
                keys: w.replace.keys,
                reason: w.replace.reason,
                statementRef: ctx.statementRef ?? `statement:${diff.periodTo ?? ''}`,
                statementOn: diff.periodTo ?? '',
              }
            : null,
        position: fundOn && w ? w.position : {},
        valuation: fundOn && w ? w.valuation : null,
        closed: fundOn && w ? w.close : false,
        sip: sip ? sip.write : [],
      });
      r.transactionsAdded += res.added;
      if (fundOn) applied.funds.add(item.key);
      if (sipOn) applied.sips.add(item.key);
      if (replaceOn) applied.replaces.add(item.key);
      if (fundOn && w?.close && !w.create) r.assumedSold.push(item.name);
      const bits = [
        fundOn ? `${res.added} new transactions` : null,
        replaceOn && replaceIsChange(item)
          ? `${item.lines.replace!.count} on file replaced by the statement`
          : null,
        sip ? (sip.kind === 'changed' ? 'SIP amount changed' : `SIP ${sip.kind}`) : null,
      ].filter(Boolean);
      r.lines.push(
        `${item.kind === 'new' ? 'added' : item.kind === 'sold' ? 'sold' : 'updated'}: ${item.name} (${bits.join(', ')})`,
      );
    } catch (e) {
      r.needsReview.push(item.name);
      r.lines.push(`error: ${item.name}: ${(e as Error).message}`);
    }
  }
  for (const note of diff.notes) r.lines.push(note);
  r.changes = storedChanges(diff.items, applied);
  r.summary = summariseChanges(diff.items, applied);
  if (r.summary === 'Nothing changed' && r.unchanged > 0)
    r.summary = `Nothing changed: ${r.unchanged} fund${r.unchanged === 1 ? '' : 's'} already up to date`;
  return r;
}

export type { FundChangeItem };

/** One report for several people's statements read from one file. */
export function mergeReports(reports: CasReport[]): CasReport {
  const sum = (f: (r: CasReport) => number) => reports.reduce((a, r) => a + f(r), 0);
  const summaries = reports.map((r) => r.summary).filter((x) => x && x !== 'Nothing changed');
  return {
    matched: sum((r) => r.matched),
    created: sum((r) => r.created),
    skipped: sum((r) => r.skipped),
    unchanged: sum((r) => r.unchanged),
    transactionsAdded: sum((r) => r.transactionsAdded),
    needsReview: reports.flatMap((r) => r.needsReview),
    assumedSold: reports.flatMap((r) => r.assumedSold),
    lines: reports.flatMap((r) => r.lines),
    summary:
      reports.length === 1
        ? reports[0]!.summary
        : summaries.length > 0
          ? summaries.join(' | ')
          : (reports[0]?.summary ?? 'Nothing changed'),
    changes: reports.flatMap((r) => r.changes),
    statementFunds: sum((r) => r.statementFunds),
  };
}

/** Plans and applies everything (the mailbox job); `select` limits it to the items chosen. */
export async function runCasImport(
  ownerId: string,
  stmt: CasStatement,
  io: CasIo,
  cfg: PlanConfig & { select?: Selection; statementRef?: string },
): Promise<CasReport & { diff: FundImportDiff }> {
  const diff = await planCasImport(ownerId, stmt, io, cfg);
  const report = await applyFundDiff(diff, io, cfg.select ?? null, {
    ...(cfg.statementRef ? { statementRef: cfg.statementRef } : {}),
  });
  return { ...report, diff };
}
