/**
 * What a fund statement (CAS) or a fund-transactions file would change, compared with what is already on file. Pure: the caller
 * supplies what the statement says for each fund and what is stored, and gets back, per fund, a typed list of changes together with
 * the smallest set of writes that carries them out. Nothing is ever deleted or replaced: a line on file that the new statement does
 * not have is reported and kept, and a value that did not change is not written at all.
 *
 * The verdicts and the rules behind them:
 *  - new fund: not on file, and held (or sold this financial year, so its sale counts for tax);
 *  - sold: on file and active, and either the statement shows it fully redeemed (zero units after a redemption), or a COMPLETE
 *    statement does not list it at all. The second needs: every fund held on the statement matched to one of yours, the fund not started
 *    or counted after the statement date, and the statement not a depository-only (holdings) one;
 *  - new transactions: lines whose key is not on file and that match no stored line on date, units and amount (the same line from
 *    another file or app is the same line); stored lines the statement lacks are only counted;
 *  - SIP: judged from the instalments themselves (lines of kind "sip" on the statement and already stored), never from a fixed number of
 *    days. The SIP's own cadence is the median gap between its instalments; how far an instalment normally strays from its due date
 *    is the largest such difference in its own history. New: no SIP on file and at least `sipMinInstalments` similar instalments in a
 *    row at one cadence. Stopped: an active SIP on file whose next due date (last instalment plus the cadence) has passed, plus its
 *    own usual lateness, with no instalment, on a statement that covers that due date (the stop is dated from the first missed due
 *    date); too early to say is "cannot tell yet", and a statement that says the SIP was cancelled is an explicit stop. Resumed:
 *    stopped on file, instalments again after the stop. Amount changed: the latest instalments settle on another amount than the one
 *    in force on file on that date (read from the dated history). Unchanged. A fund with no instalments to read is not judged: its
 *    SIP stays as recorded, "not verified by a statement".
 * Every tolerance and threshold is passed in (Settings); nothing here is a fixed number.
 *
 * Which record wins (fund-precedence.ts, docs/USER-GUIDE.md "Which record wins"): a DETAILED statement is the most accurate record. For a
 * fund on it that adds up (the lines lead from its opening units to its closing units), a stored line inside the statement's period that
 * came from a lower source (app export, workbook, estimated, typed) and that the statement does not have is REPLACED: set aside, never
 * deleted. A line outside the period, a line from an earlier statement, and everything when the statement does not add up, are kept.
 * A statement older than the one already applied replaces and changes nothing in the period the newer one covers, and a later app
 * export does not overwrite what a statement dated on or after it decided.
 */
import { sipAmountOn } from './estimate';
import { fromInception, olderThanApplied, statementOutranks } from './fund-precedence';
import { formatInr } from './money';
import { longDate } from './inbox-view';
import {
  absentPrompt,
  ambiguousPrompt,
  schemeLinkKey,
  sipPrompt,
  type FolioLink,
  type FundPrompt,
} from './fund-review';

const DAY = 86_400_000;
const dayGap = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** a number is on file (null and undefined both mean it is not) */
const has = (x: number | null | undefined): x is number => x !== null && x !== undefined;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ------------------------------------------------------------------------------------------------
// Input
// ------------------------------------------------------------------------------------------------
export type LineKind =
  | 'purchase'
  | 'sip'
  | 'switch_in'
  | 'dividend_reinvest'
  | 'dividend_payout'
  | 'bonus'
  | 'redeem'
  | 'switch_out'
  | 'other';

/** One transaction line on a statement, with the reference the importer stores it under. */
export interface StatementLine {
  key: string;
  date: string;
  kind: LineKind | string;
  description: string;
  amount: number;
  units: number;
  nav: number | null;
  balance: number | null;
}

/** One transaction line already stored. */
export interface OnFileLine {
  key: string;
  date: string;
  kind: string;
  amount: number;
  units: number;
  /** 'cas', 'manual', 'estimate', a file import … */
  source: string;
}

/** What the statement says about one fund (several folios of one fund already combined). */
export interface StatementFund {
  name: string;
  isin: string | null;
  amfiCode: string | null;
  folioLast4: string;
  lines: StatementLine[];
  /** units held on the statement date; null when it does not say */
  closingUnits: number | null;
  /** units held before the first line */
  openingUnits: number | null;
  held: boolean;
  /** the amount invested (cost of the units held) the statement leads to; null when it cannot be told */
  invested: number | null;
  /** the first purchase; null when units from before the statement were held */
  startedOn: string | null;
  value: { amount: number; asOf: string; nav: number | null } | null;
  /** only balances (a depository statement): no transactions to learn from */
  holdingsOnly: boolean;
  /** units were sold in the current financial year */
  soldThisYear: boolean;
  /** the statement says this fund's SIP was cancelled, and when if it says */
  sipCancelled?: { on: string | null } | null;
  /** why this scheme could not be read cleanly (a name that is statement text, no closing balance); null/absent when it was */
  unclear?: string | null;
  match:
    | { status: 'one'; assetId: string }
    | { status: 'none' }
    /** `candidates`: the funds it could be (their asset ids); when absent every fund with the same ISIN or name is a candidate */
    | { status: 'ambiguous'; candidates?: string[] };
  /** statement folios that the person's choice (or a remembered one) linked to the fund this was matched to */
  links?: FolioLink[];
  /** the questions (by the key of their review item) whose answer matched or added this fund: it is applied with the answer, not by a tick */
  chosen?: string[];
}

/** The period of the latest detailed statement that was applied to a fund. */
export interface StatementCover {
  from: string | null;
  to: string;
}

export interface OnFileState {
  units: number | null;
  invested: number | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  /** dated changes of the SIP amount, oldest first; 0 = stopped from that date */
  sipChanges: { from: string; monthly: number }[];
  lines: OnFileLine[];
  latestValue: { asOf: string; amount: number } | null;
  /** stored fund values (snapshots) on the dates of the statement */
  snapshots: { asOf: string; value: number; units: number | null }[];
  /** verdicts the person has overruled, so they are not proposed again */
  ignored: { verdict: IgnorableVerdict; basis: string }[];
  /** the period of the latest detailed statement applied to this fund (null: none, or applied before this was recorded) */
  cover?: StatementCover | null;
}

export interface OnFileFund {
  assetId: string;
  name: string;
  isin: string | null;
  amfiCode: string | null;
  folioLast4: string | null;
  status: string;
  unitsAsOf: string | null;
  startedOn: string | null;
  /** null: nothing is known of what is stored for this fund (every value is then taken as changed) */
  state: OnFileState | null;
}

export interface ImportRules {
  /** instalments in a row at one cadence that make a SIP (Settings: estimates.sipMinInstalments) */
  sipMinInstalments: number;
  /** units a count may be out by (Settings: funds.unitTolerance) */
  unitTolerance: number;
  /** rupees an amount may be out by (Settings: funds.moneyTolerance) */
  moneyTolerance: number;
}

export interface FundImportInput {
  ownerId: string;
  /** 'statement' is a registrar statement (CAS); 'file' is a transactions file from an investment app */
  source: 'statement' | 'file';
  /** the statement lists everything the person holds, so a fund missing from it has been sold */
  complete: boolean;
  periodFrom: string | null;
  /** the date the statement ends (the day it was read, for a file with no end) */
  periodTo: string | null;
  today: string;
  funds: StatementFund[];
  onFile: OnFileFund[];
  rules: ImportRules;
  /**
   * What the statement's folios are keyed on. 'pan': one person's PAN, so it lists everything that person holds and a fund missing
   * from it can be sold. 'email' or 'unknown': it lists the folios registered with one email address (it can hold several people's
   * folios and miss some registered under another email), so a missing fund proves nothing. Absent: taken as 'pan'.
   */
  basis?: 'email' | 'pan' | 'unknown';
}

// ------------------------------------------------------------------------------------------------
// Output
// ------------------------------------------------------------------------------------------------
export type IgnorableVerdict = 'sold' | 'sip_stopped' | 'sip_new' | 'sip_resumed' | 'sip_changed';
export type SipKind =
  'new' | 'stopped' | 'resumed' | 'changed' | 'unchanged' | 'cannot_tell' | 'ignored';

export interface SipChange {
  kind: SipKind;
  /** the monthly amount in force on file before, and the one the statement shows */
  before: number | null;
  after: number | null;
  /** the date the change takes effect, as recorded in the dated history */
  effectiveOn: string | null;
  lastInstalmentOn: string | null;
  /** plain words: what was found and why it is called this */
  why: string;
  /** dated changes to record, oldest first (0 = stopped); empty when nothing is to be written */
  write: { monthly: number; effectiveOn: string }[];
  /** what an overruling is remembered under */
  verdict: IgnorableVerdict | null;
  basis: string | null;
}

export interface ValueChange<T> {
  before: T | null;
  after: T;
}

export interface LineView {
  date: string;
  kind: string;
  amount: number;
  units: number;
}

export interface FundWrite {
  create: {
    name: string;
    isin: string | null;
    amfiCode: string | null;
    folioLast4: string;
    closed: boolean;
  } | null;
  /** only lines that are not on file yet */
  lines: StatementLine[];
  /** only the position fields that are new or changed */
  position: {
    invested?: number;
    startedOn?: string;
    units?: number;
    unitsAsOf?: string;
    casAsOf?: string;
    folioLast4?: string;
    isin?: string;
    amfiCode?: string;
    /** the period of the detailed statement that decided this fund (recorded so an older one cannot override it) */
    coverFrom?: string;
    coverTo?: string;
  };
  /** where the new lines are stored from: a statement, or an app export */
  lineSource?: 'cas' | 'csv';
  /** stored lines the statement replaces (set aside, not deleted), by their stored reference */
  replace?: { keys: string[]; reason: string } | null;
  valuation: {
    amount: number;
    asOf: string;
    nav: number | null;
    units: number | null;
    invested: number | null;
    /** record the stored fund value for that date / the balance observation */
    snapshot: boolean;
    observation: boolean;
  } | null;
  /** the fund is fully sold: close it */
  close: boolean;
  /** the fund is missing from a complete statement: close it, zero its units and value on this date */
  markSoldAsOf: string | null;
}

export type FundChangeKind = 'new' | 'sold' | 'update' | 'unchanged' | 'review';

export interface ReplacedLineView extends LineView {
  source: string;
}

/** What the statement does with the lines already on file inside its period. */
export interface ReplaceView {
  /** lines on file the statement replaces (they are set aside in a hidden list, not deleted) */
  count: number;
  bySource: Record<string, number>;
  /** the first few, for the list that opens */
  views: ReplacedLineView[];
  /** why nothing was replaced although lines on file are not on the statement (it does not add up, or a newer one is applied) */
  blocked: string | null;
  /** lines of an older statement or a file that fall inside the period a newer statement covers, so were not added */
  coveredByStatement: number;
}

export interface FundChangeItem {
  /** `${ownerId}|${assetId}` for a fund on file, `${ownerId}|new:${isin or name}` for a new one */
  key: string;
  ownerId: string;
  assetId: string | null;
  name: string;
  kind: FundChangeKind;
  /** why it is new, sold or left for review, in plain words */
  why: string | null;
  lines: {
    newCount: number;
    /** lines of the statement that are already on file */
    duplicateCount: number;
    newLines: LineView[];
    /** stored lines inside the statement period that this statement does not have and does not replace (an earlier statement's); kept */
    keptNotOnStatement: number;
    /** what the statement replaces on file; absent in a change list stored before statements took priority */
    replace?: ReplaceView;
  };
  units: ValueChange<number> | null;
  invested: ValueChange<number> | null;
  startedOn: ValueChange<string> | null;
  value: { before: number | null; after: number; asOf: string } | null;
  sip: SipChange | null;
  /** things worth knowing that are not changes */
  notes: string[];
  write: FundWrite | null;
  /** the fund part (not its SIP) is something to apply */
  changed: boolean;
  /** the fund ends up closed (sold, or added after it was sold) */
  closed: boolean;
  /** what an unticked "sold" is remembered under, so it is not proposed again for the same statement */
  ignore: { verdict: IgnorableVerdict; basis: string } | null;
  /** for kind 'review': two funds could be this one, or the fund is not on the statement and may not be sold */
  reviewKind?: 'ambiguous' | 'absent';
  /** a question for the person with the answer I think most likely (kind 'review', and a fund the statement does not list) */
  prompt?: FundPrompt | null;
  /** the SIP could not be judged: keep it as recorded (suggested) or mark it stopped from a date */
  sipPrompt?: FundPrompt | null;
  /** the questions whose answer led to this item: it is applied with the answer, not by a tick */
  chosen?: string[];
  /** statement folios the person's choice linked to this fund: written once, so the same question is not asked again */
  links?: FolioLink[];
}

export interface FundImportDiff {
  ownerId: string;
  periodFrom: string | null;
  periodTo: string | null;
  items: FundChangeItem[];
  /** funds on the statement (several folios of one fund count once) */
  statementFunds: number;
  /** funds the statement lists that are not applied for another reason (not held and long sold) */
  skipped: number;
  /** statement-wide remarks (a short statement, a sold verdict that was held back, …) */
  notes: string[];
}

// ------------------------------------------------------------------------------------------------
// Lines
// ------------------------------------------------------------------------------------------------
/** The reference a line is stored under. The same line twice on one day is two lines: the reference carries an occurrence number. */
export function statementLineKeys(
  folio: string,
  lines: { date: string; kind: string; amount: number; units: number }[],
): string[] {
  const seen = new Map<string, number>();
  return lines.map((t) => {
    const base = `${t.date}|${t.kind}|${t.amount}|${t.units}|${folio}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`.slice(0, 200);
  });
}

interface LineMatch {
  fresh: StatementLine[];
  duplicates: number;
  /** stored lines that were not matched by any line of the statement */
  unmatched: OnFileLine[];
}

/** New lines are those that match no stored line: first by key, then (the same line from another file or app) by date, units and amount. */
export function matchLines(
  statement: StatementLine[],
  stored: OnFileLine[],
  tol: { units: number; money: number },
): LineMatch {
  const real = stored.filter((l) => l.source !== 'estimate');
  const taken = new Set<number>();
  const settled = new Set<number>();
  const byKey = new Map<string, number[]>();
  real.forEach((l, i) => byKey.set(l.key, [...(byKey.get(l.key) ?? []), i]));
  statement.forEach((s, si) => {
    const hit = (byKey.get(s.key) ?? []).find((i) => !taken.has(i));
    if (hit !== undefined) {
      taken.add(hit);
      settled.add(si);
    }
  });
  statement.forEach((s, si) => {
    if (settled.has(si)) return;
    const hit = real.findIndex(
      (l, i) =>
        !taken.has(i) &&
        l.date === s.date &&
        Math.sign(l.units) === Math.sign(s.units) &&
        Math.abs(Math.abs(l.units) - Math.abs(s.units)) <= tol.units + 1e-9 &&
        Math.abs(Math.abs(l.amount) - Math.abs(s.amount)) <= tol.money + 1e-9,
    );
    if (hit >= 0) {
      taken.add(hit);
      settled.add(si);
    }
  });
  return {
    fresh: statement.filter((_, si) => !settled.has(si)),
    duplicates: settled.size,
    unmatched: real.filter((_, i) => !taken.has(i)),
  };
}

/**
 * Do the statement's own lines lead from the units it opens with to the units it closes with? Only a statement that adds up may
 * replace anything on file. The opening units are the statement's, or (when it does not print them) the balance before its first line.
 */
export function statementReconciles(
  s: Pick<StatementFund, 'lines' | 'openingUnits' | 'closingUnits' | 'holdingsOnly'>,
  unitTolerance: number,
): {
  ok: boolean;
  opening: number | null;
  lines: number;
  closing: number | null;
  reason: string | null;
} {
  const closing = s.closingUnits;
  const sum = s.lines.reduce((a, l) => a + l.units, 0);
  const first = s.lines[0];
  const opening =
    s.openingUnits ?? (first && first.balance !== null ? first.balance - first.units : null);
  if (s.holdingsOnly || s.lines.length === 0)
    return { ok: false, opening, lines: sum, closing, reason: null };
  if (closing === null || opening === null)
    return {
      ok: false,
      opening,
      lines: sum,
      closing,
      reason: 'it does not print both its opening and its closing units, so it cannot be checked',
    };
  const gap = opening + sum - closing;
  if (Math.abs(gap) > unitTolerance + 1e-9)
    return {
      ok: false,
      opening,
      lines: sum,
      closing,
      reason: `its lines lead from ${r3(opening)} to ${r3(opening + sum)} units but it says it closes at ${r3(closing)}`,
    };
  return { ok: true, opening, lines: sum, closing, reason: null };
}

// ------------------------------------------------------------------------------------------------
// SIP
// ------------------------------------------------------------------------------------------------
export interface SipCadence {
  /** days from one instalment to the next: the median gap of this SIP's own instalments (about 30 for a monthly SIP, 7 for a weekly one) */
  days: number;
  /** the largest normal difference, in days, between an instalment and the day it was due, seen in this SIP's own history */
  deviation: number;
  /** how many instalments the cadence was read from */
  basis: number;
}

export interface SipRead {
  /** every instalment known, from the statement and from the lines already stored, oldest first (amounts to whole rupees) */
  instalments: { date: string; amount: number }[];
  /** the cadence of this SIP; null when fewer than `sipMinInstalments` instalments are known */
  cadence: SipCadence | null;
  /** the latest run: instalments one cadence apart, with no missed due date between them */
  runStart: string | null;
  runLength: number;
  last: string | null;
  /** the monthly amount now (the commonest of the last three instalments, the latest winning a tie) */
  amount: number | null;
  /** the first instalment of the latest block at that amount */
  amountSince: string | null;
  /** the amounts of the instalments in the latest run differ by no more than a rupee tolerance (set by the caller) */
  similar: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** how many cadences a gap spans: 1 is a normal step, 2 or more means a due date was missed */
const steps = (gap: number, cadence: number) => Math.max(1, Math.round(gap / cadence));

/**
 * Reads a SIP from its own instalments: the usual gap between them, how far an instalment normally strays from its due date (weekends,
 * holidays), and the latest unbroken run. Instalments are the lines of kind "sip" on the statement, plus those already stored.
 */
export function readSip(
  lines: { date: string; kind: string; amount: number; units: number }[],
  stored: { date: string; kind: string; amount: number; source?: string }[],
  rules: { sipMinInstalments: number; moneyTolerance: number },
): SipRead {
  const byDate = new Map<string, number>();
  for (const t of stored)
    if (t.source !== 'estimate' && t.kind === 'sip' && t.amount > 0)
      byDate.set(t.date, Math.round(t.amount));
  for (const t of lines)
    if (t.kind === 'sip' && t.amount > 0 && t.units > 0) byDate.set(t.date, Math.round(t.amount));
  const all = [...byDate.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const none: SipRead = {
    instalments: all,
    cadence: null,
    runStart: null,
    runLength: 0,
    last: all.length ? all[all.length - 1]!.date : null,
    amount: null,
    amountSince: null,
    similar: false,
  };
  if (all.length < Math.max(2, rules.sipMinInstalments)) return none;
  const gaps = all.slice(1).map((x, i) => dayGap(all[i]!.date, x.date));
  const days = Math.max(1, Math.round(median(gaps)));
  const normal = gaps.filter((g) => steps(g, days) === 1).map((g) => Math.abs(g - days));
  const cadence: SipCadence = {
    days,
    deviation: normal.length ? Math.max(...normal) : 0,
    basis: all.length,
  };
  let from = all.length - 1;
  while (from > 0 && steps(gaps[from - 1]!, days) === 1) from--;
  const run = all.slice(from);
  const counts = new Map<number, number>();
  for (const x of run.slice(-3)) counts.set(x.amount, (counts.get(x.amount) ?? 0) + 1);
  let amount = run[run.length - 1]!.amount;
  for (const [a, n] of counts) if (n > (counts.get(amount) ?? 0)) amount = a;
  let i = run.length - 1;
  while (i >= 0 && run[i]!.amount !== amount) i--;
  while (i > 0 && run[i - 1]!.amount === amount) i--;
  const tail = run.slice(-Math.max(2, rules.sipMinInstalments)).map((x) => x.amount);
  return {
    instalments: all,
    cadence,
    runStart: run[0]!.date,
    runLength: run.length,
    last: run[run.length - 1]!.date,
    amount,
    amountSince: run[Math.max(0, i)]!.date,
    similar: Math.max(...tail) - Math.min(...tail) <= rules.moneyTolerance,
  };
}

/**
 * Where a SIP stands on a date, by its own pattern: on track (the next due date has not come), late (it has, but instalments are
 * normally up to `deviation` days late, so it is too early to say) or missed (the due date and the usual lateness have both passed
 * and no instalment came). The first missed due date is the day the stop is recorded from.
 */
export function sipStanding(
  read: SipRead,
  end: string,
): { state: 'ontrack' | 'late' | 'missed'; nextDue: string; lateUntil: string } | null {
  if (!read.cadence || !read.last) return null;
  const nextDue = addDays(read.last, read.cadence.days);
  const lateUntil = addDays(nextDue, read.cadence.deviation);
  return {
    state: end < nextDue ? 'ontrack' : end <= lateUntil ? 'late' : 'missed',
    nextDue,
    lateUntil,
  };
}

interface SipContext {
  read: SipRead;
  end: string;
  periodFrom: string | null;
  rules: ImportRules;
  /** null for a fund that is not on file yet */
  fund: OnFileFund | null;
  held: boolean;
  holdingsOnly: boolean;
  /** the statement lists transactions for this fund */
  hasLines: boolean;
  /** the statement says the SIP was cancelled (and when, if it says) */
  cancelled: { on: string | null } | null;
}

const inr = (n: number) => formatInr(n);
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** "every month" / "every week" for a cadence in days */
const every = (d: number) =>
  d >= 26 && d <= 35 ? 'monthly' : d >= 6 && d <= 8 ? 'weekly' : `about every ${days(d)}`;

function sipOf(kind: SipKind, c: SipContext, o: Partial<SipChange> & { why: string }): SipChange {
  return {
    kind,
    before: null,
    after: null,
    effectiveOn: null,
    lastInstalmentOn: c.read.last,
    write: [],
    verdict: null,
    basis: null,
    ...o,
  };
}

/** The SIP verdict for one fund. See the rules at the top of the file. */
export function judgeSip(c: SipContext): SipChange | null {
  const { read, rules, end } = c;
  const N = rules.sipMinInstalments;
  const f = c.fund;
  const state = f?.state ?? null;
  const active = !!state && !!state.sipMonthly && state.sipMonthly > 0 && !state.sipStopped;
  const stoppedOnFile = !!state && state.sipStopped;
  const cur = read.amount;
  const st = sipStanding(read, end);
  const pattern = read.runLength >= N && cur !== null && read.similar;

  if (!c.held) return null;

  if (!f) {
    // a fund that is not on file yet: record what the statement shows
    if (!pattern || !st || cur === null) return null;
    if (st.state !== 'missed' && !c.cancelled)
      return sipOf('new', c, {
        after: cur,
        effectiveOn: read.runStart,
        write: [{ monthly: cur, effectiveOn: read.runStart! }],
        verdict: 'sip_new',
        basis: `${read.runStart}|${cur}`,
        why: `${read.runLength} instalments of ${inr(cur)} ${every(read.cadence!.days)}, the latest on ${longDate(read.last!)}.`,
      });
    const stopOn = c.cancelled?.on ?? st.nextDue;
    return sipOf('stopped', c, {
      after: cur,
      effectiveOn: stopOn,
      write: [
        { monthly: cur, effectiveOn: read.runStart! },
        { monthly: 0, effectiveOn: stopOn },
      ],
      verdict: 'sip_stopped',
      basis: read.last,
      why: c.cancelled
        ? `A SIP of ${inr(cur)} ran until ${longDate(read.last!)}. The statement says it was cancelled${c.cancelled.on ? ` on ${longDate(c.cancelled.on)}` : ''}, so no further instalment is made.`
        : `A SIP of ${inr(cur)} ran until ${longDate(read.last!)}; the next instalment was due ${longDate(st.nextDue)} and none came.`,
    });
  }

  if (active) {
    const sip = state!.sipMonthly!;
    if (c.cancelled) {
      const stopOn = c.cancelled.on ?? st?.nextDue ?? end;
      return sipOf('stopped', c, {
        before: sip,
        after: 0,
        effectiveOn: stopOn,
        write: [{ monthly: 0, effectiveOn: stopOn }],
        verdict: 'sip_stopped',
        basis: `cancelled|${stopOn}`,
        why: `The statement says the SIP was cancelled${c.cancelled.on ? ` on ${longDate(c.cancelled.on)}` : ''}.`,
      });
    }
    if (!st) {
      return sipOf('cannot_tell', c, {
        before: sip,
        why: c.holdingsOnly
          ? 'This statement lists balances only, with no transactions, so it cannot show whether the SIP continues. The SIP stays as you recorded it (not verified by a statement).'
          : !c.hasLines && read.instalments.length === 0
            ? `This statement has no transactions for the fund, so the SIP of ${inr(sip)} stays as you recorded it (not verified by a statement).`
            : `Only ${read.instalments.length} SIP instalment${read.instalments.length === 1 ? ' is' : 's are'} known (${N} are needed to see this SIP's pattern), so the SIP of ${inr(sip)} stays as you recorded it (not verified by a statement).`,
      });
    }
    const cad = read.cadence!;
    if (st.state === 'missed') {
      if (c.holdingsOnly || c.periodFrom === null || c.periodFrom > st.nextDue)
        return sipOf('cannot_tell', c, {
          before: sip,
          why: `The instalment due ${longDate(st.nextDue)} is not on file, but the statement ${c.periodFrom === null ? 'does not say which period it covers' : `starts on ${longDate(c.periodFrom)}, after that date`}, so it cannot show whether the SIP stopped. It stays as you recorded it.`,
        });
      return sipOf('stopped', c, {
        before: sip,
        after: 0,
        effectiveOn: st.nextDue,
        write: [{ monthly: 0, effectiveOn: st.nextDue }],
        verdict: 'sip_stopped',
        basis: read.last,
        why: `The last instalment was on ${longDate(read.last!)}. The next was due ${longDate(st.nextDue)} (${every(cad.days)}${cad.deviation > 0 ? `, up to ${days(cad.deviation)} late in the past` : ''}) and none came by ${longDate(end)}, the date the statement ends.`,
      });
    }
    if (st.state === 'late')
      return sipOf('cannot_tell', c, {
        before: sip,
        lastInstalmentOn: read.last,
        why: `Cannot tell yet: the instalment due ${longDate(st.nextDue)} has not come, but this SIP has been up to ${days(cad.deviation)} late before, and the statement ends ${longDate(end)}.`,
      });
    // on track
    const plan = state!.sipChanges;
    const inForce = (() => {
      if (plan.length === 0 || !read.last) return sip;
      const a = sipAmountOn(
        { monthly: sip, startedOn: f.startedOn ?? read.last, stopped: false, changes: plan },
        read.last,
      );
      return a > 0 ? a : sip;
    })();
    if (pattern && Math.round(cur!) !== Math.round(inForce))
      return sipOf('changed', c, {
        before: inForce,
        after: cur,
        effectiveOn: read.amountSince,
        write: [{ monthly: cur!, effectiveOn: read.amountSince! }],
        verdict: 'sip_changed',
        basis: `${read.amountSince}|${cur}`,
        why: `Instalments are ${inr(cur!)} since ${longDate(read.amountSince!)}; the SIP on file is ${inr(inForce)}.`,
      });
    return sipOf('unchanged', c, {
      before: inForce,
      after: pattern ? cur : inForce,
      why: `Running: last instalment ${longDate(read.last!)}, the next is due ${longDate(st.nextDue)}.`,
    });
  }

  if (stoppedOnFile) {
    const stops = state!.sipChanges.filter((x) => x.monthly === 0).map((x) => x.from);
    const stoppedOn = stops.length ? stops[stops.length - 1]! : null;
    if (pattern && st && st.state !== 'missed' && !c.cancelled) {
      const from = read.instalments.find(
        (x) => x.date >= read.runStart! && (stoppedOn === null || x.date > stoppedOn),
      );
      if (from)
        return sipOf('resumed', c, {
          before: state!.sipMonthly,
          after: cur,
          effectiveOn: from.date,
          write: [{ monthly: cur!, effectiveOn: from.date }],
          verdict: 'sip_resumed',
          basis: `${from.date}|${cur}`,
          why: `The SIP was marked stopped${stoppedOn ? ` from ${longDate(stoppedOn)}` : ''}, but ${read.runLength} instalments of ${inr(cur!)} ${every(read.cadence!.days)} came again, the latest on ${longDate(read.last!)}.`,
        });
    }
    return sipOf('unchanged', c, { before: 0, why: 'Stopped on file, and no new instalments.' });
  }

  // no SIP on file
  if (pattern && st && st.state !== 'missed' && !c.cancelled)
    return sipOf('new', c, {
      after: cur,
      effectiveOn: read.runStart,
      write: [{ monthly: cur!, effectiveOn: read.runStart! }],
      verdict: 'sip_new',
      basis: `${read.runStart}|${cur}`,
      why: `${read.runLength} instalments of ${inr(cur!)} ${every(read.cadence!.days)} in a row, the latest on ${longDate(read.last!)}, and no SIP on file.`,
    });
  return null;
}

// ------------------------------------------------------------------------------------------------
// The comparison
// ------------------------------------------------------------------------------------------------
const hasKeys = (o: object) => Object.keys(o).length > 0;
const asView = (l: { date: string; kind: string; amount: number; units: number }): LineView => ({
  date: l.date,
  kind: l.kind,
  amount: l.amount,
  units: l.units,
});

/** What the person's choice added to a fund's item: that it is applied with the choice, and which folios were linked to it. */
function carry(item: FundChangeItem, s: StatementFund): FundChangeItem {
  if (s.chosen && s.chosen.length > 0) item.chosen = s.chosen;
  if (s.links && s.links.length > 0) item.links = s.links;
  return item;
}

function emptyLines(): FundChangeItem['lines'] {
  return { newCount: 0, duplicateCount: 0, newLines: [], keptNotOnStatement: 0 };
}

export function diffFundImport(input: FundImportInput): FundImportDiff {
  const end = input.periodTo ?? input.today;
  const items: FundChangeItem[] = [];
  const notes: string[] = [];
  let skipped = 0;
  const claimed = new Set<string>();
  const unmatchedScheme: string[] = [];

  const ignored = (f: OnFileFund | null, verdict: IgnorableVerdict, basis: string | null) =>
    !!f?.state?.ignored.some((i) => i.verdict === verdict && i.basis === basis);

  for (const s of input.funds) {
    if (s.match.status === 'ambiguous') {
      unmatchedScheme.push(s.name);
      const cands = s.match.candidates;
      const siblings = input.funds
        .filter(
          (x) =>
            x !== s &&
            x.match.status === 'ambiguous' &&
            schemeLinkKey(x) === schemeLinkKey(s) &&
            x.folioLast4 !== s.folioLast4,
        )
        .map((x) => ({ folioLast4: x.folioLast4, units: x.closingUnits }));
      const prompt = ambiguousPrompt({
        key: `${input.ownerId}|review:${s.folioLast4}|${schemeLinkKey(s)}`,
        s,
        candidates: cands ? input.onFile.filter((f) => cands.includes(f.assetId)) : null,
        onFile: input.onFile,
        siblings,
        tolerance: input.rules.unitTolerance,
      });
      items.push({
        key: `${input.ownerId}|review:${s.folioLast4}|${schemeLinkKey(s)}`,
        ownerId: input.ownerId,
        assetId: null,
        name: s.name,
        kind: 'review',
        reviewKind: 'ambiguous',
        why: prompt.suggestion.found,
        lines: emptyLines(),
        units: null,
        invested: null,
        startedOn: null,
        value: null,
        sip: null,
        notes: [],
        write: null,
        changed: false,
        ignore: null,
        closed: false,
        prompt,
      });
      continue;
    }
    const f =
      s.match.status === 'one'
        ? (input.onFile.find((x) => x.assetId === (s.match as { assetId: string }).assetId) ?? null)
        : null;
    if (s.match.status === 'none' || !f) {
      if (!s.held && !s.soldThisYear) {
        skipped++;
        continue;
      }
      // a fund held on the statement that is none of yours might be a missing one under another name; one sold in full cannot stand in for it
      if (s.held) unmatchedScheme.push(s.name);
      items.push(carry(newFundItem(input, s, end), s));
      continue;
    }
    claimed.add(f.assetId);
    items.push(carry(existingFundItem(input, s, f, end, ignored), s));
  }

  // funds on file that the statement does not list
  const complete = input.complete && input.funds.length > 0 && input.periodTo !== null;
  const anyHoldingsOnly = input.funds.some((x) => x.holdingsOnly);
  const absent = input.onFile.filter((f) => !claimed.has(f.assetId) && f.status === 'active');
  if (complete && absent.length > 0) {
    const asOf = input.periodTo!;
    const plural1 = absent.length === 1;
    if (anyHoldingsOnly) {
      notes.push(
        `${absent.length} fund${plural1 ? '' : 's'} on file ${plural1 ? 'is' : 'are'} not on this statement, but it lists only balances held with a depository, so nothing was marked as sold.`,
      );
    } else if (unmatchedScheme.length > 0) {
      notes.push(
        `${absent.length} fund${plural1 ? '' : 's'} on file ${plural1 ? 'is' : 'are'} not on this statement, but nothing was marked as sold: ${unmatchedScheme.length === 1 ? 'a fund' : `${unmatchedScheme.length} funds`} on it (${unmatchedScheme.slice(0, 3).join(', ')}${unmatchedScheme.length > 3 ? ', …' : ''}) could not be matched to a fund you have, and a missing fund might be that one under another name.`,
      );
    } else {
      // started after the statement ended, or counted after it: the statement could not know about it
      const couldKnow = (f: OnFileFund) =>
        !(f.startedOn && f.startedOn > asOf) && !(f.unitsAsOf && f.unitsAsOf > asOf);
      const eligible = absent.filter(couldKnow);
      const activeKnown = input.onFile.filter((f) => f.status === 'active' && couldKnow(f)).length;
      const unclear = input.funds.filter((x) => x.unclear);
      const basis = input.basis ?? 'pan';
      // a missing fund is evidence of a sale only when the statement lists everything the person holds (keyed on a PAN), every scheme
      // on it was read cleanly and matched, and the missing funds are not most of what the person has
      const doubt: { kind: 'basis' | 'unclear' | 'many'; text: string; reason: string } | null =
        basis !== 'pan'
          ? {
              kind: 'basis',
              reason:
                basis === 'email'
                  ? 'The statement is keyed on an email address and may not list every folio (a folio registered under another email would be missing), so a missing fund is not proof that it was sold.'
                  : 'The statement does not say whose folios it lists, so a missing fund is not proof that it was sold.',
              text:
                basis === 'email'
                  ? 'This statement lists the funds registered with one email address, so a fund registered under another email would not be on it. It is not marked as sold: check it, and close it yourself if you sold it.'
                  : 'This statement does not say whose folios it lists, so a missing fund proves nothing. It is not marked as sold: check it, and close it yourself if you sold it.',
            }
          : unclear.length > 0
            ? {
                kind: 'unclear',
                reason: `${unclear.length === 1 ? 'A scheme' : `${unclear.length} schemes`} on this statement could not be read cleanly, and a missing fund might be ${unclear.length === 1 ? 'it' : 'one of them'}, so a missing fund is not proof that it was sold.`,
                text: `${unclear.length === 1 ? 'A scheme' : `${unclear.length} schemes`} on this statement could not be read cleanly (${unclear
                  .slice(0, 2)
                  .map((x) => x.name)
                  .join(
                    ', ',
                  )}${unclear.length > 2 ? ', …' : ''}), and a missing fund might be ${unclear.length === 1 ? 'it' : 'one of them'}. It is not marked as sold: check it.`,
              }
            : eligible.length * 2 > activeKnown
              ? {
                  kind: 'many',
                  reason: `${eligible.length} of your ${activeKnown} funds are missing from this statement. That is more likely a statement that does not list everything than that many sales.`,
                  text: `${eligible.length} of your ${activeKnown} funds are missing from this statement. That is more likely a statement that does not list everything than that many sales, so it is not marked as sold: check it.`,
                }
              : null;
      if (doubt && eligible.length > 0)
        notes.push(
          `${eligible.length} fund${eligible.length === 1 ? '' : 's'} on file ${eligible.length === 1 ? 'is' : 'are'} not on this statement, and none was marked as sold. ${doubt.text}`,
        );
      for (const f of eligible) {
        const why = `Not on the statement dated ${longDate(asOf)}.`;
        if (doubt) {
          items.push({
            key: `${input.ownerId}|${f.assetId}`,
            ownerId: input.ownerId,
            assetId: f.assetId,
            name: f.name,
            kind: 'review',
            reviewKind: 'absent',
            prompt: absentPrompt({ f, asOf, doubt: { kind: doubt.kind, reason: doubt.reason } }),
            why: `${why} ${doubt.text}`,
            lines: emptyLines(),
            units: null,
            invested: null,
            startedOn: null,
            value: null,
            sip: null,
            notes: [],
            write: null,
            changed: false,
            closed: false,
            ignore: null,
          });
          continue;
        }
        const soldWhy = `Not on the statement dated ${longDate(asOf)}, which lists all your funds.`;
        const skip = ignored(f, 'sold', asOf);
        const state = f.state;
        const stops = !!state && !!state.sipMonthly && !state.sipStopped;
        items.push({
          key: `${input.ownerId}|${f.assetId}`,
          ownerId: input.ownerId,
          assetId: f.assetId,
          name: f.name,
          kind: skip ? 'unchanged' : 'sold',
          why: skip ? `${soldWhy} You chose to keep it, so it is left as it is.` : soldWhy,
          lines: emptyLines(),
          units:
            skip || !state || state.units === null || state.units === 0
              ? null
              : { before: state.units, after: 0 },
          invested: skip || !state || !state.invested ? null : { before: state.invested, after: 0 },
          startedOn: null,
          value:
            skip || !state?.latestValue
              ? null
              : { before: state.latestValue.amount, after: 0, asOf },
          sip:
            skip || !stops
              ? null
              : {
                  kind: 'stopped',
                  before: state!.sipMonthly,
                  after: 0,
                  effectiveOn: asOf,
                  lastInstalmentOn: null,
                  why: 'The fund is sold, so its SIP stops with it.',
                  write: [],
                  verdict: null,
                  basis: null,
                },
          notes: [],
          write: skip
            ? null
            : {
                create: null,
                lines: [],
                position: {},
                valuation: null,
                close: true,
                markSoldAsOf: asOf,
              },
          changed: !skip,
          closed: !skip,
          ignore: { verdict: 'sold', basis: asOf },
          prompt: skip ? null : absentPrompt({ f, asOf, doubt: null }),
        });
      }
    }
  }

  return {
    ownerId: input.ownerId,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    items,
    statementFunds: input.funds.length,
    skipped,
    notes: [...notes, ...keptNotes(items), ...sipNotes(items)],
  };
}

/** One remark for the funds whose values a statement already decided and this older statement or file left alone. */
function keptNotes(items: FundChangeItem[]): string[] {
  const kept = items.filter((i) => i.notes.some((n) => n.startsWith('Kept:')));
  if (kept.length === 0) return [];
  const first = kept[0]!.notes.find((n) => n.startsWith('Kept:'))!;
  return [
    kept.length === 1
      ? first
      : `${first} The same for ${kept.length - 1} other fund${kept.length === 2 ? '' : 's'} (${kept
          .slice(0, 4)
          .map((i) => i.name)
          .join(', ')}${kept.length > 4 ? ', …' : ''}).`,
  ];
}

/** One remark for the SIPs a short statement could not judge. */
function sipNotes(items: FundChangeItem[]): string[] {
  const n = items.filter((i) => i.sip?.kind === 'cannot_tell' && !i.sipPrompt);
  if (n.length === 0) return [];
  return [
    `${n.length} SIP${n.length === 1 ? '' : 's'} could not be judged from this statement (${n
      .slice(0, 3)
      .map((i) => i.name)
      .join(
        ', ',
      )}${n.length > 3 ? ', …' : ''}); ${n.length === 1 ? 'it is' : 'they are'} left as ${n.length === 1 ? 'it is' : 'they are'}. ${n[0]!.sip!.why}`,
  ];
}

function newFundItem(input: FundImportInput, s: StatementFund, end: string): FundChangeItem {
  const asOf = s.value?.asOf ?? input.periodTo;
  const fresh = s.lines;
  const sip = judgeSip({
    read: readSip(s.lines, [], input.rules),
    end,
    periodFrom: input.periodFrom,
    rules: input.rules,
    fund: null,
    held: s.held,
    holdingsOnly: s.holdingsOnly,
    hasLines: s.lines.length > 0,
    cancelled: s.sipCancelled ?? null,
  });
  const position: FundWrite['position'] = {};
  if (s.invested !== null) position.invested = s.invested;
  if (s.startedOn) position.startedOn = s.startedOn;
  if (s.closingUnits !== null && asOf) {
    position.units = s.held ? s.closingUnits : 0;
    position.unitsAsOf = asOf;
  }
  if (asOf) position.casAsOf = asOf;
  position.folioLast4 = s.folioLast4;
  if (s.isin) position.isin = s.isin;
  if (s.amfiCode) position.amfiCode = s.amfiCode;
  if (
    input.source === 'statement' &&
    input.periodFrom &&
    input.periodTo &&
    statementReconciles(s, input.rules.unitTolerance).ok
  ) {
    position.coverFrom = input.periodFrom;
    position.coverTo = input.periodTo;
  }
  const valuation = !asOf
    ? null
    : !s.held
      ? {
          amount: 0,
          asOf,
          nav: s.value?.nav ?? null,
          units: 0,
          invested: 0,
          snapshot: true,
          observation: true,
        }
      : s.value
        ? {
            amount: r2(s.value.amount),
            asOf: s.value.asOf,
            nav: s.value.nav,
            units: s.closingUnits,
            invested: s.invested,
            snapshot: true,
            observation: true,
          }
        : null;
  return {
    key: `${input.ownerId}|new:${(s.isin ?? s.name).toLowerCase()}`,
    ownerId: input.ownerId,
    assetId: null,
    name: s.name,
    kind: 'new',
    why: s.held
      ? 'Not among your funds yet; the statement shows it held.'
      : 'Not among your funds; sold this financial year, so it is kept for the tax on the sale.',
    lines: {
      newCount: fresh.length,
      duplicateCount: 0,
      newLines: fresh.map(asView),
      keptNotOnStatement: 0,
    },
    units: s.closingUnits === null ? null : { before: null, after: s.held ? s.closingUnits : 0 },
    invested: s.invested === null ? null : { before: null, after: s.invested },
    startedOn: s.startedOn ? { before: null, after: s.startedOn } : null,
    value: valuation ? { before: null, after: valuation.amount, asOf: valuation.asOf } : null,
    sip,
    notes: [],
    ignore: null,
    closed: !s.held,
    write: {
      create: {
        name: s.name,
        isin: s.isin,
        amfiCode: s.amfiCode,
        folioLast4: s.folioLast4,
        closed: !s.held,
      },
      lines: fresh,
      lineSource: input.source === 'statement' ? 'cas' : 'csv',
      position,
      replace: null,
      valuation,
      close: !s.held,
      markSoldAsOf: null,
    },
    changed: true,
  };
}

const MAX_REPLACED_VIEWS = 40;

/** The period a statement will cover once applied: joined to the one already on file when the two touch, else just its own. */
function nextCover(
  cover: StatementCover | null | undefined,
  from: string,
  to: string,
): StatementCover {
  if (cover && cover.from !== null && cover.from < from && from <= addDays(cover.to, 1))
    return { from: cover.from, to };
  return { from, to };
}

function existingFundItem(
  input: FundImportInput,
  s: StatementFund,
  f: OnFileFund,
  end: string,
  ignored: (f: OnFileFund | null, verdict: IgnorableVerdict, basis: string | null) => boolean,
): FundChangeItem {
  const { rules } = input;
  const tol = { units: rules.unitTolerance, money: rules.moneyTolerance };
  const st = f.state;
  const asOf = s.value?.asOf ?? input.periodTo;
  const notes: string[] = [];
  const m = matchLines(s.lines, st?.lines ?? [], tol);

  // ---- who decides: a detailed statement over a file, a newer statement over an older one
  const isStatement = input.source === 'statement';
  const cover = st?.cover ?? null;
  const coverText = cover ? longDate(cover.to) : '';
  const inCover = (d: string) =>
    !!cover && d <= cover.to && (cover.from === null || d >= cover.from);
  const fileDate = !isStatement
    ? (s.lines
        .map((l) => l.date)
        .sort()
        .pop() ?? null)
    : null;
  // an older statement, or a file whose newest line is not after the statement already applied: that statement's values stay
  const olderStatement = isStatement && !!cover && olderThanApplied(input.periodTo, cover.to);
  const keepValues =
    !!cover && (olderStatement || (!isStatement && fileDate !== null && cover.to >= fileDate));
  const rec = statementReconciles(s, rules.unitTolerance);
  const windowKnown = isStatement && !!input.periodFrom && !!input.periodTo;
  const inWin = (d: string) => windowKnown && d >= input.periodFrom! && d <= input.periodTo!;

  // lines of an older statement or of a file that fall inside what a newer statement covers are not added: it already decided them
  let fresh = m.fresh;
  let coveredByStatement = 0;
  if (cover && (olderStatement || !isStatement)) {
    fresh = m.fresh.filter((l) => !inCover(l.date));
    coveredByStatement = m.fresh.length - fresh.length;
  }

  // ---- lines on file inside the period that the statement does not have
  const estimatesInWindow =
    s.lines.length === 0
      ? []
      : (st?.lines ?? []).filter((l) => l.source === 'estimate' && inWin(l.date));
  const unmatchedInWindow =
    s.lines.length === 0
      ? []
      : m.unmatched.filter(
          (l) =>
            (input.periodFrom ? l.date >= input.periodFrom : true) &&
            (input.periodTo ? l.date <= input.periodTo : true),
        );
  const lower = unmatchedInWindow.filter((l) => statementOutranks(l.source));
  const candidates = isStatement ? [...estimatesInWindow, ...lower] : [];
  let replacing: OnFileLine[] = [];
  let blocked: string | null = null;
  if (candidates.length > 0) {
    if (olderStatement)
      blocked = `A statement dated ${coverText} is already applied, so this older one replaces nothing.`;
    else if (!windowKnown)
      blocked =
        'This statement does not say which period it covers, so nothing on file was replaced.';
    else if (!rec.ok && !s.holdingsOnly)
      blocked = `Nothing on file was replaced: ${rec.reason ?? 'the statement cannot be checked'}.`;
    else if (!s.holdingsOnly) replacing = candidates;
  }
  const replacingKeys = new Set(replacing.map((l) => l.key));
  const kept = unmatchedInWindow.filter((l) => !replacingKeys.has(l.key));
  if (kept.length > 0)
    notes.push(
      `${kept.length} line${kept.length === 1 ? '' : 's'} on file ${kept.length === 1 ? 'is' : 'are'} not on this statement; kept.`,
    );
  if (blocked) notes.push(blocked);
  const bySource: Record<string, number> = {};
  for (const l of replacing) bySource[l.source] = (bySource[l.source] ?? 0) + 1;
  const replace: ReplaceView = {
    count: replacing.length,
    bySource,
    views: replacing
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, MAX_REPLACED_VIEWS)
      .map((l) => ({ ...asView(l), source: l.source })),
    blocked,
    coveredByStatement,
  };

  const first = s.lines.map((l) => l.date).sort()[0] ?? null;
  const realDates = (st?.lines ?? []).filter((l) => l.source !== 'estimate').map((l) => l.date);
  const earliestOnFile =
    (realDates.length > 0 ? realDates : [f.startedOn ?? '']).filter((x) => x !== '').sort()[0] ??
    null;
  // the statement begins well after the fund did and holds nothing from before: it cannot be the whole history
  // (a statement that runs from the beginning of the register is the whole history by definition)
  const startsLater =
    first !== null &&
    earliestOnFile !== null &&
    (s.openingUnits ?? 0) <= rules.unitTolerance &&
    earliestOnFile < first &&
    !(isStatement && fromInception(input.periodFrom));
  const countNewer = !!f.unitsAsOf && !!asOf && f.unitsAsOf > asOf;
  const frozen = countNewer || keepValues;

  const position: FundWrite['position'] = {};
  let units: ValueChange<number> | null = null;
  let invested: ValueChange<number> | null = null;
  let startedOn: ValueChange<string> | null = null;

  // closing
  const redeemed = s.lines.some((l) => l.units < 0);
  const fullySold =
    !s.held &&
    s.closingUnits !== null &&
    redeemed &&
    f.status === 'active' &&
    !frozen &&
    !(f.startedOn && asOf && f.startedOn > asOf);
  const soldOn = fullySold
    ? (s.lines
        .filter((l) => l.units < 0)
        .map((l) => l.date)
        .sort()
        .pop() ?? asOf)
    : null;
  const soldIgnored = fullySold && ignored(f, 'sold', asOf);
  const sold = fullySold && !soldIgnored;

  const after = s.closingUnits === null ? null : s.held ? s.closingUnits : 0;
  if (keepValues)
    notes.push(
      `Kept: the fund statement dated ${coverText} is more accurate than ${olderStatement ? 'this older one' : 'this file'}, so units, amount invested and first purchase are left as they are.`,
    );
  if (coveredByStatement > 0)
    notes.push(
      `${coveredByStatement} line${coveredByStatement === 1 ? '' : 's'} of this ${isStatement ? 'statement' : 'file'} fall${coveredByStatement === 1 ? 's' : ''} inside the period of the statement dated ${coverText}, which decides that period, so ${coveredByStatement === 1 ? 'it was' : 'they were'} not added.`,
    );
  if (after !== null && asOf && !frozen) {
    const differs = !has(st?.units) || Math.abs(st.units - after) > rules.unitTolerance;
    if (differs) {
      if (startsLater && has(st?.units) && after < st.units - rules.unitTolerance)
        notes.push(
          `The statement starts on ${longDate(first!)}, after this fund started (${longDate(earliestOnFile!)}), so its ${r3(after)} units are not taken as the whole holding; ${r3(st.units)} units stay as they are.`,
        );
      else {
        position.units = after;
        position.unitsAsOf = asOf;
        units = { before: st?.units ?? null, after };
      }
    }
  } else if (countNewer && !keepValues && after !== null)
    notes.push(
      `Your unit count dated ${longDate(f.unitsAsOf!)} is newer than this statement (${longDate(asOf!)}), so units and amount invested are left as they are.`,
    );

  if (s.invested !== null && !frozen) {
    const differs = !has(st?.invested) || Math.abs(st.invested - s.invested) > rules.moneyTolerance;
    if (differs && !(startsLater && has(st?.invested) && s.invested < st.invested)) {
      position.invested = s.invested;
      invested = { before: st?.invested ?? null, after: s.invested };
    }
  }
  if (s.startedOn && !frozen) {
    if (!f.startedOn || s.startedOn < f.startedOn) {
      position.startedOn = s.startedOn;
      startedOn = { before: f.startedOn, after: s.startedOn };
    } else if (
      isStatement &&
      rec.ok &&
      s.startedOn > f.startedOn &&
      !startsLater &&
      (s.openingUnits ?? 1) <= rules.unitTolerance &&
      // the statement is where the fund starts: a start date on file that is earlier stands only if lines on file back it
      !(st?.lines ?? []).some(
        (l) => l.source !== 'estimate' && !replacingKeys.has(l.key) && l.date < s.startedOn!,
      )
    ) {
      position.startedOn = s.startedOn;
      startedOn = { before: f.startedOn, after: s.startedOn };
    }
  }

  // SIP
  const sipReadNow = readSip(s.lines, st?.lines ?? [], rules);
  let sip =
    f.status === 'active' && !sold && !keepValues
      ? judgeSip({
          read: sipReadNow,
          end,
          periodFrom: input.periodFrom,
          rules,
          fund: f,
          held: s.held,
          holdingsOnly: s.holdingsOnly,
          hasLines: s.lines.length > 0,
          cancelled: s.sipCancelled ?? null,
        })
      : null;
  if (sip && sip.verdict && ignored(f, sip.verdict, sip.basis)) {
    sip = {
      ...sip,
      kind: 'ignored',
      write: [],
      why: `${sip.why} You chose to keep the SIP as it is, so it is not proposed again for this statement.`,
    };
  }
  if (sold && st && st.sipMonthly && !st.sipStopped && soldOn)
    sip = {
      kind: 'stopped',
      before: st.sipMonthly,
      after: 0,
      effectiveOn: soldOn,
      lastInstalmentOn: null,
      why: 'The fund is sold, so its SIP stops with it.',
      write: [{ monthly: 0, effectiveOn: soldOn }],
      verdict: null,
      basis: null,
    };

  const lines = {
    newCount: fresh.length,
    duplicateCount: m.duplicates,
    newLines: fresh.map(asView),
    keptNotOnStatement: kept.length,
    replace,
  };

  let why: string | null = null;
  if (sold) {
    if (position.units === undefined && asOf && (!has(st?.units) || st.units !== 0)) {
      position.units = 0;
      position.unitsAsOf = asOf;
      units = { before: st?.units ?? null, after: 0 };
    }
    why = `Fully redeemed: the statement dated ${longDate(asOf!)} shows 0 units after the sale on ${longDate(soldOn!)}.`;
  } else if (soldIgnored) {
    notes.push('The statement shows this fund fully redeemed; you chose to keep it as it is.');
  }

  const other = lines.newCount > 0 || hasKeys(position) || sold || replacing.length > 0;
  if (other && asOf && !frozen) position.casAsOf = asOf;
  if (other) {
    if (s.isin && f.isin !== s.isin) position.isin = s.isin;
    if (s.amfiCode && f.amfiCode !== s.amfiCode) position.amfiCode = s.amfiCode;
    if (s.folioLast4 && f.folioLast4 !== s.folioLast4) position.folioLast4 = s.folioLast4;
  }
  // the period this statement decided is recorded (quietly when nothing else changes), so an older statement cannot override it
  if (isStatement && windowKnown && !s.holdingsOnly && rec.ok && !olderStatement) {
    const c = nextCover(cover, input.periodFrom!, input.periodTo!);
    if (c.from !== (cover?.from ?? null) || c.to !== (cover?.to ?? null)) {
      position.coverFrom = c.from!;
      position.coverTo = c.to;
    }
  }
  const bookkeeping = position.coverTo !== undefined && !other && !hasKeysExceptCover(position);

  // a value only goes in alongside other changes: the units times the live price already follows the market
  let valuation: FundWrite['valuation'] = null;
  let valueView: FundChangeItem['value'] = null;
  if (other && asOf && !frozen) {
    const amount = sold ? 0 : s.value && s.held ? r2(s.value.amount) : null;
    const when = sold ? asOf : (s.value?.asOf ?? null);
    if (amount !== null && when) {
      const latest = st?.latestValue ?? null;
      const observation = !latest || when > latest.asOf;
      const snap = st?.snapshots.find((x) => x.asOf === when) ?? null;
      const snapshot =
        !snap ||
        Math.abs(snap.value - amount) > rules.moneyTolerance ||
        (after !== null &&
          snap.units !== null &&
          Math.abs(snap.units - after) > rules.unitTolerance);
      if (observation || snapshot) {
        valuation = {
          amount,
          asOf: when,
          nav: s.value?.nav ?? null,
          units: after,
          invested: sold ? 0 : (invested?.after ?? s.invested),
          snapshot,
          observation,
        };
        if (observation) valueView = { before: latest?.amount ?? null, after: amount, asOf: when };
      }
    }
  }
  if (sold && !invested && st?.invested) {
    position.invested = 0;
    invested = { before: st.invested, after: 0 };
  }

  const write: FundWrite | null =
    other || valuation || bookkeeping
      ? {
          create: null,
          lines: fresh,
          lineSource: isStatement ? 'cas' : 'csv',
          position,
          replace:
            replacing.length > 0
              ? {
                  keys: replacing.map((l) => l.key),
                  reason: `Replaced by the fund statement dated ${longDate(input.periodTo!)}`,
                }
              : null,
          valuation,
          close: sold,
          markSoldAsOf: null,
        }
      : null;
  const changed = write !== null && !bookkeeping;
  if (f.status !== 'active' && s.held && (s.closingUnits ?? 0) > rules.unitTolerance)
    notes.push(
      'This fund is marked as closed on file but the statement shows units held; its status is left as it is.',
    );

  return {
    key: `${input.ownerId}|${f.assetId}`,
    ownerId: input.ownerId,
    assetId: f.assetId,
    name: f.name,
    kind: sold ? 'sold' : changed ? 'update' : 'unchanged',
    why,
    lines,
    units,
    invested,
    startedOn,
    value: valueView,
    sip,
    notes,
    write,
    changed,
    closed: sold,
    ignore: fullySold ? { verdict: 'sold', basis: asOf! } : null,
    sipPrompt:
      sip && sip.kind === 'cannot_tell' && s.lines.length > 0 && !s.holdingsOnly
        ? sipPrompt({ name: f.name, sip, stopFrom: sipStanding(sipReadNow, end)?.nextDue ?? end })
        : null,
  };
}

/** True when the position carries a field other than the recorded statement period. */
function hasKeysExceptCover(p: FundWrite['position']): boolean {
  const { coverFrom, coverTo, ...rest } = p;
  void coverFrom;
  void coverTo;
  return hasKeys(rest);
}

// ------------------------------------------------------------------------------------------------
// Words
// ------------------------------------------------------------------------------------------------
export interface Chip {
  label: string;
  tone: 'ok' | 'warn' | 'info' | 'bad' | 'muted';
}

/** The key of the SIP part of an item, for choosing it separately from the fund. */
export const sipKey = (itemKey: string) => `${itemKey}#sip`;

/** The key of the replace part of an item (the lines on file the statement replaces), for choosing it separately from the fund. */
export const replaceKey = (itemKey: string) => `${itemKey}#replace`;

/** True when the statement replaces lines on file for this fund (something to tick or untick). */
export const replaceIsChange = (i: { lines: { replace?: ReplaceView | undefined } }): boolean =>
  (i.lines.replace?.count ?? 0) > 0;

/** True when this SIP verdict is something to apply (and so to tick or untick). */
export const sipIsChange = (s: SipChange | null | undefined): s is SipChange =>
  !!s && s.write.length > 0 && s.kind !== 'ignored';

export function sipChip(s: SipChange): Chip | null {
  switch (s.kind) {
    case 'stopped':
      return { label: 'SIP stopped', tone: 'warn' };
    case 'new':
      return { label: 'SIP new', tone: 'ok' };
    case 'resumed':
      return { label: 'SIP resumed', tone: 'ok' };
    case 'changed':
      return {
        label: `SIP ${inr(s.before ?? 0)} → ${inr(s.after ?? 0)}`,
        tone: 'info',
      };
    default:
      return null;
  }
}

export function chipsOf(i: Omit<FundChangeItem, 'write'>): Chip[] {
  const out: Chip[] = [];
  if (i.kind === 'new')
    out.push({ label: i.closed ? 'New fund, already sold' : 'New fund', tone: 'info' });
  if (i.kind === 'sold')
    out.push(
      i.prompt?.start === 'keep'
        ? { label: 'Not on this statement', tone: 'warn' }
        : { label: 'Sold', tone: 'bad' },
    );
  if (i.kind === 'review')
    out.push(
      i.reviewKind === 'absent'
        ? { label: 'Not on this statement', tone: 'warn' }
        : { label: 'Your decision', tone: 'warn' },
    );
  if (replaceIsChange(i))
    out.push({
      label: `${i.lines.replace!.count} replaced`,
      tone: 'info',
    });
  if (i.lines.newCount > 0)
    out.push({
      label: `+${i.lines.newCount} transaction${i.lines.newCount === 1 ? '' : 's'}`,
      tone: 'ok',
    });
  const c = i.sip ? sipChip(i.sip) : null;
  if (c && (sipIsChange(i.sip) || i.kind === 'sold')) out.push(c);
  return out;
}

/** A question is waiting for the person: a fund that could be several, someone else's folios, or a SIP that could not be judged. */
export const needsAnswer = (i: Pick<FundChangeItem, 'kind' | 'sipPrompt'>) =>
  i.kind === 'review' || !!i.sipPrompt;

/** An item is listed when it has something to apply or a question to answer. */
export const isListed = (i: Omit<FundChangeItem, 'write'>) =>
  i.changed || sipIsChange(i.sip) || needsAnswer(i);

/** The items that have something to apply or ask, in the order they are shown. */
export const changedItems = (d: FundImportDiff) => d.items.filter(isListed);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "2 funds updated: +5 transactions; 1 SIP stopped; 1 fund sold". Counts what was applied (the whole diff when `applied` is not given).
 */
export function summariseChanges(
  items: Omit<FundChangeItem, 'write'>[],
  applied?: { funds: Set<string>; sips: Set<string>; replaces?: Set<string> },
): string {
  const fundOk = (i: Omit<FundChangeItem, 'write'>) => (applied ? applied.funds.has(i.key) : true);
  const sipOk = (i: Omit<FundChangeItem, 'write'>) => (applied ? applied.sips.has(i.key) : true);
  const updated = items.filter((i) => i.kind === 'update' && fundOk(i));
  const created = items.filter((i) => i.kind === 'new' && fundOk(i));
  const sold = items.filter((i) => i.kind === 'sold' && fundOk(i));
  const tx = items
    .filter(fundOk)
    .filter((i) => i.kind !== 'sold' || i.lines.newCount > 0)
    .reduce((a, i) => a + i.lines.newCount, 0);
  const sips = items.filter((i) => sipOk(i) && sipIsChange(i.sip));
  const count = (k: SipKind) => sips.filter((i) => i.sip!.kind === k).length;
  const head: string[] = [];
  if (updated.length > 0) head.push(`${plural(updated.length, 'fund', 'funds')} updated`);
  if (created.length > 0) head.push(`${plural(created.length, 'new fund', 'new funds')}`);
  const replaced = items
    .filter((i) => fundOk(i) && replaceIsChange(i) && (!applied || applied.replaces?.has(i.key)))
    .reduce((a, i) => a + (i.lines.replace?.count ?? 0), 0);
  const txWords = [
    ...(tx > 0 ? [`+${tx} transaction${tx === 1 ? '' : 's'}`] : []),
    ...(replaced > 0 ? [`${replaced} replaced by the statement`] : []),
  ].join(', ');
  const parts: string[] = [];
  if (head.length > 0) parts.push(head.join(', ') + (txWords ? `: ${txWords}` : ''));
  else if (txWords) parts.push(txWords);
  if (count('stopped') > 0) parts.push(`${count('stopped')} SIP stopped`);
  if (count('new') > 0) parts.push(`${count('new')} SIP new`);
  if (count('resumed') > 0) parts.push(`${count('resumed')} SIP resumed`);
  if (count('changed') > 0) parts.push(`${count('changed')} SIP amount changed`);
  if (sold.length > 0) parts.push(`${plural(sold.length, 'fund', 'funds')} sold`);
  return parts.length > 0 ? parts.join('; ') : 'Nothing changed';
}

/** One plain sentence for each applied or proposed change, for the log. */
export function changeLines(items: Omit<FundChangeItem, 'write'>[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    const bits: string[] = [];
    if (i.kind === 'new') bits.push(i.closed ? 'added (already sold)' : 'added');
    if (i.kind === 'sold') bits.push('sold');
    if (i.lines.newCount > 0)
      bits.push(`+${i.lines.newCount} transaction${i.lines.newCount === 1 ? '' : 's'}`);
    if (replaceIsChange(i))
      bits.push(`${i.lines.replace!.count} on file replaced by the statement`);
    if (i.units && i.kind !== 'new')
      bits.push(`units ${fmtUnits(i.units.before)} → ${fmtUnits(i.units.after)}`);
    if (i.invested && i.kind !== 'new')
      bits.push(
        `invested ${i.invested.before === null ? '–' : inr(i.invested.before)} → ${inr(i.invested.after)}`,
      );
    const c = i.sip ? sipChip(i.sip) : null;
    if (c && sipIsChange(i.sip))
      bits.push(
        `${c.label.toLowerCase().replace(/^sip/, 'SIP')} from ${i.sip.effectiveOn ? longDate(i.sip.effectiveOn) : '–'}`,
      );
    if (i.kind === 'review')
      bits.push(
        i.reviewKind === 'absent'
          ? 'not on this statement: waiting for your decision (suggestion: leave it)'
          : 'waiting for your decision',
      );
    if (bits.length > 0) out.push(`${i.name}: ${bits.join('; ')}`);
  }
  return out;
}

export const fmtUnits = (n: number | null) =>
  n === null ? '–' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** The change list kept with an import: each changed item without its write set, new lines capped. */
export type StoredChange = Omit<FundChangeItem, 'write'> & { applied: boolean };
export function storedChanges(
  items: FundChangeItem[],
  applied: { funds: Set<string>; sips: Set<string>; replaces?: Set<string> },
  maxLines = 40,
): StoredChange[] {
  return items.filter(isListed).map((i) => {
    const { write, ...rest } = i;
    void write;
    return {
      ...rest,
      lines: { ...rest.lines, newLines: rest.lines.newLines.slice(0, maxLines) },
      applied: applied.funds.has(i.key) || applied.sips.has(i.key),
    };
  });
}

/** Totals over a preview, for the line at the top: what the statement replaces, adds and confirms. */
export interface PriorityTotals {
  /** funds the statement changes the ledger of by replacing lines */
  funds: number;
  replaced: number;
  added: number;
  confirmed: number;
  bySource: Record<string, number>;
}

export function priorityTotals(items: Pick<FundChangeItem, 'lines' | 'kind'>[]): PriorityTotals {
  const t: PriorityTotals = { funds: 0, replaced: 0, added: 0, confirmed: 0, bySource: {} };
  for (const i of items) {
    if (i.kind === 'review') continue;
    t.added += i.lines.newCount;
    t.confirmed += i.lines.duplicateCount;
    const r = i.lines.replace;
    if (r && r.count > 0) {
      t.funds++;
      t.replaced += r.count;
      for (const [k, n] of Object.entries(r.bySource)) t.bySource[k] = (t.bySource[k] ?? 0) + n;
    }
  }
  return t;
}
