/**
 * Applies a parsed fund statement to the household in two steps that can be told apart: `planCasImport` reads what is on file and
 * compares it with the statement (nothing is written, `diffFundImport` in core decides what is new, changed, sold or stopped), and
 * `applyFundDiff` writes only the items that were chosen. `runCasImport` does both, for the mailbox job. All side effects go through
 * `CasIo`, so the rules are tested without a database.
 *
 * Safety rules: a statement only changes funds of the person it belongs to; a scheme is matched by ISIN or AMFI code, or by folio and
 * name together, and an ambiguous match is never guessed: it becomes a question with the answer I think most likely and the reason
 * (see core's fund-review), which the person approves, changes or leaves; an approved answer is written as a link between the
 * statement's folio and the fund, so the same question is not asked again, and nothing is ever deleted; lots are only trusted when they add up to the
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
  schemeLinkKey,
  sipIsChange,
  sipKey,
  statementLineKeys,
  storedChanges,
  summariseChanges,
  type FolioLink,
  type ForeignGroup,
  type FundChangeItem,
  type FundImportDiff,
  type IgnorableVerdict,
  type FundWrite,
  type OnFileState,
  type SipChange,
  type StatementFund,
} from '@fwos/core';
import { coreTokens } from './amfi';
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
  /** the statement folios this person has already said belong to one of their funds */
  links?(ownerId: string): Promise<(FolioLink & { assetId: string })[]>;
  /** remembers that these statement folios belong to this fund (once: saying it again changes nothing) */
  linkFolios?(args: { ownerId: string; assetId: string; links: FolioLink[] }): Promise<void>;
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

/** What the person chose for a question: the option, and what they typed for it (a date, say). */
export interface Decision {
  option: string;
  input: string | null;
}

/**
 * The items to apply: those whose key is in `take`. An item that was shown (`seen`) and not taken is remembered as overruled.
 * `choices` are the answers to the questions the preview asked, by the key of the item (or of its SIP, `sipKey`).
 */
export interface Selection {
  take: ReadonlySet<string>;
  seen: ReadonlySet<string>;
  choices?: ReadonlyMap<string, Decision>;
}

export { sipKey };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sharedShare = (a: string[], b: string[]) => {
  const B = new Set(b);
  const hit = a.filter((t) => B.has(t)).length;
  return a.length === 0 ? 0 : hit / Math.max(a.length, b.length);
};

export type Match =
  | { status: 'one'; fund: CasFund }
  | { status: 'none' }
  | { status: 'ambiguous'; candidates: CasFund[] };

/** ISIN or AMFI code first; then folio and name together; then a clearly best name. Never a guess between equals. */
export function matchScheme(scheme: CasScheme, amfi: string | null, funds: CasFund[]): Match {
  const byId = funds.filter(
    (f) => (scheme.isin && f.isin && same(f.isin, scheme.isin)) || (amfi && f.amfiCode === amfi),
  );
  if (byId.length === 1) return { status: 'one', fund: byId[0]! };
  if (byId.length > 1) return { status: 'ambiguous', candidates: byId };
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
    return { status: 'ambiguous', candidates: scored.filter((x) => scored[0]!.score - x.score < 0.15).map((x) => x.f) };
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
    ...(a.links || b.links ? { links: [...(a.links ?? []), ...(b.links ?? [])] } : {}),
    ...(a.chosen || b.chosen ? { chosen: [...(a.chosen ?? []), ...(b.chosen ?? [])] } : {}),
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
  /** who the folios on a statement keyed on an e-mail address may belong to: this person's PAN, and the rest of the family */
  people?: {
    own: string | null;
    family: { ownerId: string; name: string; panLast4: string | null }[];
  };
}

/** The key a question about a statement folio is filed under (the same as its review item's key). */
export const reviewKey = (ownerId: string, s: Pick<CasScheme, 'folioLast4' | 'isin' | 'name'>) =>
  `${ownerId}|review:${s.folioLast4}|${schemeLinkKey(s)}`;

const last4 = (pan: string | null | undefined) => (pan ? pan.slice(-4).toUpperCase() : null);
const isLink = (o: string) => o.startsWith('link:');

/**
 * Whether a folio on a statement keyed on an e-mail address belongs to someone else (that statement lists every folio registered
 * under the address, whoever holds it). Only a folio whose PAN is printed and differs from this person's saved PAN is another
 * person's; a statement keyed on the person's own PAN, or one that prints no folio PAN, is taken as theirs throughout.
 */
function foreignKeyOf(
  s: CasScheme,
  stmt: CasStatement,
  cfg: PlanConfig,
): { key: string; panLast4: string } | null {
  const own = last4(cfg.people?.own);
  const pan = last4(s.folioPan);
  if (stmt.basis !== 'email' || !own || !pan || pan === own) return null;
  return { key: `foreign:${pan}`, panLast4: pan };
}

/**
 * Reads what is on file and compares it with the statement. Writes nothing. A scheme that could be more than one of the person's
 * funds becomes a question with a suggested answer; `decisions` (the answers, by the key of the question) settle those questions
 * before the comparison is made, so a chosen fund is compared and applied like any other. With no decisions every question also
 * says what the fund would look like after each answer.
 */
export async function planCasImport(
  ownerId: string,
  stmt: CasStatement,
  io: CasIo,
  cfg: PlanConfig,
  decisions: ReadonlyMap<string, Decision> = new Map(),
): Promise<FundImportDiff> {
  const end = stmt.periodTo ?? cfg.today;
  const fyStart = `${Number(end.slice(5, 7)) >= 4 ? end.slice(0, 4) : String(Number(end.slice(0, 4)) - 1)}-04-01`;
  const dates = [
    ...new Set(stmt.schemes.map((s) => s.navDate ?? stmt.periodTo).filter((d): d is string => !!d)),
  ];
  const funds = await io.funds(ownerId, { dates });
  const remembered = (await io.links?.(ownerId)) ?? [];
  const amfiOf = new Map<string, string | null>();
  for (const s of stmt.schemes)
    if (s.isin && !amfiOf.has(s.isin)) amfiOf.set(s.isin, await io.isinToAmfi(s.isin));
  const d = DEFAULT_CONFIG;
  const rules = {
    sipMinInstalments: cfg.sipMinInstalments ?? d.estimates.sipMinInstalments,
    unitTolerance: cfg.unitTolerance ?? d.funds.unitTolerance,
    moneyTolerance: cfg.moneyTolerance ?? d.funds.moneyTolerance,
  };
  const onFile = funds.map((f) => ({
    assetId: f.assetId,
    name: f.name,
    isin: f.isin,
    amfiCode: f.amfiCode,
    folioLast4: f.folioLast4,
    status: f.status ?? 'active',
    unitsAsOf: f.unitsAsOf ?? null,
    startedOn: f.startedOn ?? null,
    state: f.state ?? null,
  }));

  /** The comparison with these answers applied. */
  const build = (answers: ReadonlyMap<string, Decision>): FundImportDiff => {
    const groups = new Map<string, StatementFund>();
    const foreign = new Map<string, ForeignGroup>();
    let n = 0;
    for (const s of stmt.schemes) {
      const rk = reviewKey(ownerId, s);
      const amfi = s.isin ? (amfiOf.get(s.isin) ?? null) : null;
      const sk = schemeLinkKey(s);
      const other = foreignKeyOf(s, stmt, cfg);
      let chosen: string[] | undefined;
      if (other) {
        const fk = `${ownerId}|review:${other.key}`;
        if (answers.get(fk)?.option !== 'mine') {
          const g = foreign.get(other.key) ?? {
            key: other.key,
            holder: s.holder ?? null,
            panLast4: other.panLast4,
            member:
              cfg.people?.family.find((m) => last4(m.panLast4) === other.panLast4)?.name ?? null,
            folios: [],
          };
          g.folios.push({
            name: s.name,
            folioLast4: s.folioLast4,
            units: s.closingUnits,
            invested: s.costValue,
          });
          foreign.set(other.key, g);
          continue;
        }
        chosen = [fk];
      }
      let m: Match;
      let links: FolioLink[] | undefined;
      const known = remembered.find(
        (l) =>
          l.folioLast4 === s.folioLast4 &&
          l.schemeKey === sk &&
          funds.some((f) => f.assetId === l.assetId),
      );
      if (known) m = { status: 'one', fund: funds.find((f) => f.assetId === known.assetId)! };
      else m = matchScheme(s, amfi, funds);
      const answer = m.status === 'ambiguous' ? answers.get(rk) : undefined;
      if (m.status === 'ambiguous' && answer && isLink(answer.option)) {
        const f = m.candidates.find((c) => `link:${c.assetId}` === answer.option);
        if (f) {
          m = { status: 'one', fund: f };
          links = [{ folioLast4: s.folioLast4, schemeKey: sk }];
          chosen = [...(chosen ?? []), rk];
        }
      } else if (answer?.option === 'new') {
        m = { status: 'none' };
        links = [{ folioLast4: s.folioLast4, schemeKey: sk }];
        chosen = [...(chosen ?? []), rk];
      }
      const match: StatementFund['match'] =
        m.status === 'one'
          ? { status: 'one', assetId: m.fund.assetId }
          : m.status === 'ambiguous'
            ? { status: 'ambiguous', candidates: m.candidates.map((c) => c.assetId) }
            : { status: 'none' };
      const sf: StatementFund = {
        ...statementFund(s, match, amfi, stmt, fyStart),
        ...(links ? { links } : {}),
        ...(chosen ? { chosen } : {}),
      };
      const key =
        m.status === 'one'
          ? `one:${m.fund.assetId}`
          : m.status === 'none'
            ? `none:${(s.isin ?? s.name).toLowerCase()}`
            : `amb:${n++}`;
      const have = groups.get(key);
      groups.set(key, have ? combine(have, sf) : sf);
    }
    return diffFundImport({
      ownerId,
      source: cfg.source ?? 'statement',
      complete: cfg.complete ?? false,
      periodFrom: stmt.periodFrom,
      periodTo: stmt.periodTo ?? (cfg.source === 'file' ? cfg.today : null),
      today: cfg.today,
      funds: [...groups.values()],
      onFile,
      rules,
      ...(stmt.basis ? { basis: stmt.basis } : {}),
      foreign: [...foreign.values()],
    });
  };

  const base = build(new Map());
  if (decisions.size > 0) {
    // only an answer the question offered is taken: the browser is not trusted to name any fund
    const valid = new Map<string, Decision>();
    for (const i of base.items) {
      const dec = decisions.get(i.key);
      if (dec && i.prompt && i.prompt.suggestion.options.some((o) => o.id === dec.option))
        valid.set(i.key, dec);
    }
    return valid.size > 0 ? build(valid) : base;
  }
  // what each answer would make of the fund: the others stay on the answer I suggest, so folios that are one holding combine
  const suggested = new Map<string, Decision>();
  for (const i of base.items) {
    const r = i.prompt?.suggestion.recommended;
    if (r && (isLink(r) || r === 'new' || r === 'mine'))
      suggested.set(i.key, { option: r, input: null });
  }
  for (const i of base.items) {
    const p = i.prompt;
    if (!p || (p.kind !== 'ambiguous' && p.kind !== 'foreign')) continue;
    for (const o of p.suggestion.options) {
      if (!(isLink(o.id) || o.id === 'new' || o.id === 'mine')) continue;
      const answers = new Map(suggested);
      answers.set(i.key, { option: o.id, input: null });
      const after = build(answers);
      p.outcomes[o.id] = after.items
        .filter((x) => x.chosen?.includes(i.key))
        .map((x) => {
          const { write, ...rest } = x;
          void write;
          // the SIP, if any, is judged on the next preview, so it is not promised here
          return { ...rest, sip: null, sipPrompt: null, prompt: null };
        });
    }
  }
  return base;
}

/** A date typed by the person: a real calendar day, not in the future. */
export function validDay(x: string | null | undefined, today: string | null): x is string {
  if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== x) return false;
  return x >= '1990-01-01' && (today === null || x <= today);
}

/**
 * Writes the items that were chosen (all of them when there is no selection), and nothing else. The answers to the preview's
 * questions come with the selection: a statement folio the person linked to a fund (or added as a new one) is compared and applied
 * with the answer and the link is written once; a fund the statement does not list is sold on the date typed; a SIP the statement
 * could not judge is stopped from the date typed. Nothing is ever deleted, and applying the same answers again changes nothing.
 */
export async function applyFundDiff(
  diff: FundImportDiff,
  io: CasIo,
  selection: Selection | null = null,
  opts: { today?: string } = {},
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
  const today = opts.today ?? null;
  const shown = (k: string) => !!selection && selection.seen.has(k);
  /** the person's answer to a question, only when it is one of the answers the question offered */
  const answerOf = (k: string, prompt: FundChangeItem['prompt']) => {
    const a = selection?.choices?.get(k) ?? null;
    return a && prompt?.suggestion.options.some((o) => o.id === a.option) ? a : null;
  };
  /** a fund the statement does not list is only called sold without a selection when the suggestion is to call it sold */
  const askedKeep = (i: FundChangeItem) => i.prompt?.kind === 'absent' && i.prompt.start === 'keep';
  const taken = (i: FundChangeItem, k: string) =>
    !selection ? !(k === i.key && askedKeep(i)) : selection.take.has(k);
  const applied = { funds: new Set<string>(), sips: new Set<string>() };
  let linked = 0;
  let sipStops = 0;

  r.matched = diff.items.filter(
    (i) => i.assetId && i.kind !== 'review' && !i.write?.markSoldAsOf && i.kind !== 'new',
  ).length;
  for (const item of diff.items) {
    try {
      if (item.kind === 'review') {
        if (answerOf(item.key, item.prompt)) {
          r.lines.push(`left alone as you chose: ${item.name}`);
        } else {
          r.needsReview.push(item.name);
          r.lines.push(
            `waiting for your decision: ${item.name}${item.prompt ? ` (${item.prompt.suggestion.suggest})` : ''}`,
          );
        }
        continue;
      }
      // the folios this answer linked to the fund are remembered, once, whatever else happens to the fund
      const forced = !!item.chosen?.length && !(shown(item.key) && !taken(item, item.key));
      const writeLinks = async (assetId: string) => {
        if (!forced || !item.links?.length || !io.linkFolios) return;
        await io.linkFolios({ ownerId: diff.ownerId, assetId, links: item.links });
        linked += item.links.length;
        r.lines.push(
          `linked: ${item.links.map((l) => `folio …${l.folioLast4}`).join(', ')} to ${item.name}`,
        );
      };
      // a SIP the statement could not judge, stopped from the date the person typed
      const stop = answerOf(sipKey(item.key), item.sipPrompt);
      if (item.sipPrompt && item.assetId && stop?.option === 'stop' && validDay(stop.input, today)) {
        await io.save({
          assetId: item.assetId,
          transactions: [],
          position: {},
          valuation: null,
          closed: false,
          sip: [{ monthly: 0, effectiveOn: stop.input }],
        });
        sipStops++;
        r.lines.push(`SIP stopped from ${stop.input} as you chose: ${item.name}`);
      } else if (item.sipPrompt && item.sip) {
        // the suggestion stands: the SIP is kept as recorded
        r.lines.push(`SIP kept as recorded: ${item.name}: ${item.sip.why}`);
      }
      if (item.kind === 'unchanged' && !sipIsChange(item.sip)) {
        if (item.assetId) {
          r.unchanged++;
          await writeLinks(item.assetId);
        }
        continue;
      }
      const fundOn = (item.changed && taken(item, item.key)) || (forced && item.changed);
      const dependent = item.kind === 'new' || item.kind === 'sold';
      const sipOn =
        sipIsChange(item.sip) && taken(item, sipKey(item.key)) && (!dependent || fundOn);

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
      if (!fundOn && !sipOn) {
        if (item.assetId) await writeLinks(item.assetId);
        continue;
      }

      const w = item.write;
      if (fundOn && w?.markSoldAsOf) {
        if (!io.markSold) throw new Error('this importer cannot close a fund');
        // sold on the date the person typed, else the statement's date
        const typed = answerOf(item.key, item.prompt);
        const on = typed?.option === 'sold' && validDay(typed.input, today) ? typed.input : w.markSoldAsOf;
        await io.markSold({ assetId: item.assetId!, asOf: on });
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
      const res = await io.save({
        assetId,
        transactions: fundOn && w ? w.lines : [],
        position: fundOn && w ? w.position : {},
        valuation: fundOn && w ? w.valuation : null,
        closed: fundOn && w ? w.close : false,
        sip: sip ? sip.write : [],
      });
      r.transactionsAdded += res.added;
      if (fundOn) applied.funds.add(item.key);
      if (sipOn) applied.sips.add(item.key);
      if (fundOn && w?.close && !w.create) r.assumedSold.push(item.name);
      await writeLinks(assetId);
      const bits = [
        fundOn ? `${res.added} new transactions` : null,
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
  const extra = [
    linked > 0 ? `${linked} folio${linked === 1 ? '' : 's'} linked to a fund` : '',
    sipStops > 0 ? `${sipStops} SIP stopped` : '',
  ].filter((x) => x);
  if (extra.length > 0)
    r.summary =
      r.summary === 'Nothing changed' ? extra.join('; ') : `${r.summary}; ${extra.join('; ')}`;
  if (r.summary === 'Nothing changed' && r.unchanged > 0)
    r.summary = `Nothing changed: ${r.unchanged} fund${r.unchanged === 1 ? '' : 's'} already up to date`;
  return r;
}

export type { FundChangeItem };

/** Plans and applies everything (the mailbox job); `select` limits it to the items chosen. */
export async function runCasImport(
  ownerId: string,
  stmt: CasStatement,
  io: CasIo,
  cfg: PlanConfig & { select?: Selection },
): Promise<CasReport & { diff: FundImportDiff }> {
  const diff = await planCasImport(ownerId, stmt, io, cfg, cfg.select?.choices);
  const report = await applyFundDiff(diff, io, cfg.select ?? null, { today: cfg.today });
  return { ...report, diff };
}
