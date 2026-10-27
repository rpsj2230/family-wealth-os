/**
 * What the Rates pages show, worked out from the rates on file, their change log and the state of each bank's rate page.
 * Pure: the pages read the rows and call these functions, so every sentence on screen can be tested.
 */
import { sameBank, slabText, tenureText, type RateOffer } from './rates';
import { bankSummary, type BankSummary, type BoardOffer, type RateEventRow } from './rate-board';

// ---- why a rate was wrong -------------------------------------------------------------------------------------------

export type RateReason =
  'senior_citizen' | 'wrong_tenure' | 'wrong_slab' | 'nro_nre' | 'outdated' | 'other';

/** The reasons a person can give when they change a rate the bank page gave, in plain words. */
export const RATE_REASONS: { key: RateReason; label: string; help: string }[] = [
  {
    key: 'senior_citizen',
    label: 'It was the senior-citizen rate',
    help: 'The page lists a higher column for senior citizens and that one was read.',
  },
  {
    key: 'wrong_tenure',
    label: 'It belongs to another term',
    help: 'The figure is from a neighbouring term band.',
  },
  {
    key: 'wrong_slab',
    label: 'It belongs to another balance slab',
    help: 'The figure is from a neighbouring balance range.',
  },
  {
    key: 'nro_nre',
    label: 'NRE and NRO were mixed up',
    help: 'The figure is for the other account type.',
  },
  {
    key: 'outdated',
    label: 'It came from an old table',
    help: 'The page still shows an older table with an earlier date.',
  },
  {
    key: 'other',
    label: 'Something else / not sure',
    help: 'The refresh will work out the cause.',
  },
];

export const reasonLabel = (r: string | null | undefined): string =>
  RATE_REASONS.find((x) => x.key === r)?.label ?? (r ? r.replace(/_/g, ' ') : 'No reason recorded');

// ---- small formatting helpers ---------------------------------------------------------------------------------------

/** 0.0725 -> "7.25%" */
export const ratePct = (r: number): string => `${(r * 100).toFixed(2)}%`;

/** 0.0025 -> "0.25 pts" (percentage points) */
export const pointsText = (d: number): string => `${Math.abs(d * 100).toFixed(2)} pts`;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "26 Oct 2026" from a date or timestamp. */
export const niceDay = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** "today", "yesterday", "5 days ago" */
export const rateAgoText = (days: number): string =>
  days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;

/** What one rate row is about: "NRE deposit, 2 yr" or "Savings, above ₹5 L". */
export function slotText(o: {
  product: 'savings' | 'fd';
  accountKind: string;
  tenureFrom: number;
  tenureTo: number;
  tenureDays?: number | null;
  balanceFrom?: number | null;
  balanceTo?: number | null;
}): string {
  const kind = o.accountKind === 'any' ? '' : `${o.accountKind} `;
  const t =
    o.product === 'fd'
      ? `${kind}deposit, ${tenureText(o)}`
      : `${kind}savings, ${slabText(o) ?? 'any balance'}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---- the savings ladder ---------------------------------------------------------------------------------------------

export interface SlabStep {
  label: string;
  /** a label short enough to sit under a bar: "<=1L", "1-5L", ">50L" */
  short: string;
  rate: number;
  /** 0..100: bar height against the highest rate on the board */
  heightPct: number;
  best: boolean;
}

const compactAmt = (n: number) =>
  n >= 1e7
    ? `${+(n / 1e7).toFixed(2)}Cr`
    : n >= 1e5
      ? `${+(n / 1e5).toFixed(2)}L`
      : `${+(n / 1e3).toFixed(1)}k`;

/** A slab in a few characters: up to 1L, 1L-5L, above 50L. */
export function slabShort(o: { balanceFrom?: number | null; balanceTo?: number | null }): string {
  const from = o.balanceFrom ?? 0;
  const to = o.balanceTo ?? null;
  if (from === 0 && to === null) return 'any';
  if (from === 0) return `≤${compactAmt(to!)}`;
  if (to === null) return `>${compactAmt(from)}`;
  return `${compactAmt(from)}–${compactAmt(to)}`;
}

/** Savings slabs as steps, lowest balance first, each with a bar height to draw. `scaleMax` lets every bank use the same scale. */
export function slabLadder(
  savings: Pick<RateOffer, 'rate' | 'balanceFrom' | 'balanceTo'>[],
  scaleMax?: number,
): SlabStep[] {
  const sorted = [...savings].sort((a, b) => (a.balanceFrom ?? 0) - (b.balanceFrom ?? 0));
  const top = Math.max(scaleMax ?? 0, ...sorted.map((s) => s.rate), 0.0001);
  const best = Math.max(...sorted.map((s) => s.rate), 0);
  return sorted.map((s) => ({
    label: slabText(s) ?? 'any balance',
    short: slabShort(s),
    rate: s.rate,
    heightPct: Math.max(10, Math.round((s.rate / top) * 100)),
    best: s.rate === best,
  }));
}

// ---- where a rate came from -----------------------------------------------------------------------------------------

export interface Origin {
  kind: 'manual' | 'ai';
  /** "Pasted notes", "Typed in the form", "Edited by you", "Read from www.janabank.com" */
  note: string;
  url: string | null;
  on: string;
  count: number;
}

/** Rates grouped by where they came from, newest first, so the board can say "7 rates read from the bank page on 21 Oct". */
export function originsOf(offers: RateOffer[]): Origin[] {
  const m = new Map<string, Origin>();
  for (const o of offers) {
    const note =
      o.sourceNote ?? (o.sourceKind === 'ai' ? 'Read from the bank page' : 'Typed by you');
    const k = `${o.sourceKind}|${note}|${o.sourceUrl ?? ''}`;
    const cur = m.get(k);
    if (cur) {
      cur.count++;
      if (o.checkedOn > cur.on) cur.on = o.checkedOn;
    } else
      m.set(k, {
        kind: o.sourceKind,
        note,
        url: o.sourceUrl ?? null,
        on: o.checkedOn,
        count: 1,
      });
  }
  return [...m.values()].sort((a, b) => b.on.localeCompare(a.on));
}

/** The one-line "Where from" for a single rate. */
export function whereFrom(o: RateOffer): {
  who: 'You' | 'Bank page';
  note: string;
  url: string | null;
} {
  return {
    who: o.sourceKind === 'ai' ? 'Bank page' : 'You',
    note: o.sourceNote ?? (o.sourceKind === 'ai' ? 'Read from the bank page' : 'Typed by you'),
    url: o.sourceUrl ?? null,
  };
}

/** The kind of rates a bank page or document carries: savings slabs, fixed deposit terms, or both. */
export type DocKind = 'savings' | 'fd' | 'both';
export const DOC_KINDS: readonly DocKind[] = ['both', 'savings', 'fd'];
export const isDocKind = (v: unknown): v is DocKind =>
  v === 'savings' || v === 'fd' || v === 'both';
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  both: 'Savings and fixed deposits',
  savings: 'Savings',
  fd: 'Fixed deposits',
};

/**
 * Rates once saved from comparison websites carry a note starting with this. Nothing reads such sites any more; the marker is kept
 * only to find the rows saved earlier, so they can be replaced by the bank's own figures or removed.
 */
export const THIRD_PARTY_NOTE = 'Reference only';
export const isThirdPartyNote = (note: string | null | undefined): boolean =>
  !!note && note.startsWith(THIRD_PARTY_NOTE);

// ---- did the monthly refresh read the bank's page? -------------------------------------------------------------------

export interface RateSourceRow {
  bank: string;
  url: string;
  enabled: boolean;
  lastRunOn: string | null;
  lastResult: string | null;
}

export interface SourceStatus {
  /** ok = read; warn = read but needs a look, or not run lately; bad = could not read; idle = nothing to report yet */
  health: 'ok' | 'warn' | 'bad' | 'idle';
  headline: string;
  /** the worker's own words, kept so nothing is hidden */
  detail: string | null;
  fix: { text: string; href?: string; hrefLabel?: string } | null;
  ranOn: string | null;
  url: string | null;
}

const PASTE_FIX =
  'Open the page in your own browser, expand every section, select all, copy, and paste it into “Paste the page” on the Sync bank rates page.';

/** What a sync writes in `last_result` when the rates were saved ("14 rates saved ...", or the older "read 14 rates: ..."). */
export const isSavedResult = (lower: string): boolean =>
  lower.startsWith('read ') || /^\d+ rates saved/.test(lower);
/** What a sync writes when the bank's page could not be read. */
export const isCannotReadResult = (lower: string): boolean =>
  lower.startsWith('cannot read') ||
  lower.startsWith('could not refresh') ||
  lower.startsWith('could not sync') ||
  lower.startsWith('not read') ||
  lower.startsWith('not reached') ||
  lower.startsWith('pasted page not read');

/** Turns the worker's last_result into a plain explanation and the way out. */
export function sourceStatus(
  src: RateSourceRow | null,
  today: string,
  staleRunDays = 10,
): SourceStatus {
  if (!src)
    return {
      health: 'idle',
      headline: 'No rate page is listed for this bank, so nothing is read automatically.',
      detail: null,
      fix: {
        text: 'Add the page where the bank publishes its rates and the Monday refresh reads it.',
        href: '/settings#rates',
        hrefLabel: 'Add a rate page in Settings',
      },
      ranOn: null,
      url: null,
    };
  const base = { ranOn: src.lastRunOn, url: src.url, detail: src.lastResult };
  const r = (src.lastResult ?? '').trim();
  const lower = r.toLowerCase();
  if (!src.enabled)
    return {
      ...base,
      health: 'idle',
      headline: 'This rate page is switched off.',
      fix: {
        text: 'Switch it on in Settings to read it once a month.',
        href: '/settings#rates',
        hrefLabel: 'Open Settings',
      },
    };
  if (r === '')
    return {
      ...base,
      health: 'idle',
      headline: 'Added, not read yet.',
      fix: {
        text: 'It is read on the next Monday run. To read it now, run “Refresh interest rates” under GitHub > Actions.',
      },
    };
  if (lower.startsWith('not read: no ai key'))
    return {
      ...base,
      health: 'bad',
      headline: 'Not read: no AI key is switched on.',
      fix: {
        text: 'Add an Anthropic, OpenRouter, Groq or Gemini key, or switch a saved one on, then run the refresh again.',
        href: '/settings#email',
        hrefLabel: 'Open the AI keys in Settings',
      },
    };
  if (lower.startsWith('skipped'))
    return {
      ...base,
      health: 'idle',
      headline: 'Skipped: you hold no savings account or deposit at this bank.',
      fix: {
        text: 'Only banks you use are read. Type or paste the rates if you want them on file anyway.',
      },
    };
  if (lower.startsWith('unchanged since'))
    return {
      ...base,
      health: 'ok',
      headline:
        'Unchanged: the bank’s page is the same as at the last read, so the rates were confirmed as checked.',
      fix: null,
    };
  if (lower.startsWith('cannot read'))
    return {
      ...base,
      health: 'bad',
      headline: (r.split(/(?<=\.)\s/)[0] ?? r).replace(/^Cannot read: /i, 'Cannot read: '),
      fix: {
        text: PASTE_FIX,
        href: '/rates/sync',
        hrefLabel: 'Open Sync bank rates',
      },
    };
  if (isSavedResult(lower)) {
    const attention = /still read wrongly|differ from the page/.test(lower);
    return {
      ...base,
      health: attention ? 'warn' : 'ok',
      headline: attention ? 'Read, but some rates differ from the bank page.' : 'Read successfully.',
      fix: attention
        ? {
            text: 'Check the rates marked “page says” below and accept the page’s figure or keep yours.',
          }
        : null,
    };
  }
  if (
    lower.includes('could not refresh') ||
    lower.includes('answered') ||
    lower.includes('no rates')
  ) {
    // with several AI keys the message names each key's answer ("Anthropic answered 401 (...); Groq answered 429 (...)")
    const codes = [...lower.matchAll(/answered (\d{3})/g)].map((m) => m[1]);
    const code = codes[0];
    const ai = lower.includes('ai service');
    if (ai && codes.length > 0 && codes.every((c) => c === '401' || c === '402' || c === '403'))
      return {
        ...base,
        health: 'bad',
        headline:
          codes.length > 1
            ? 'The AI service refused every saved key.'
            : 'The AI service refused the saved key.',
        fix: {
          text: 'The key may be wrong, expired or out of credit. Save a fresh one, or add another key.',
          href: '/settings#email',
          hrefLabel: 'Check the key in Settings',
        },
      };
    if (ai && codes.length > 0 && codes.every((c) => c === '429'))
      return {
        ...base,
        health: 'warn',
        headline: 'The AI service was busy (free limit reached).',
        fix: {
          text: 'Nothing to do: the next Monday run tries again. Rates on file are unchanged.',
        },
      };
    if (ai)
      return {
        ...base,
        health: 'bad',
        headline: `The AI service could not answer${codes.length > 0 ? ` (${[...new Set(codes)].join(', ')})` : ''}.`,
        fix: { text: 'Rates on file are unchanged. It is tried again next Monday.' },
      };
    if (code === '404' || code === '410')
      return {
        ...base,
        health: 'bad',
        headline: 'The rate page was not found; its address has probably changed.',
        fix: {
          text: 'Find the bank’s current rate page and replace the address.',
          href: '/settings#rates',
          hrefLabel: 'Change the address in Settings',
        },
      };
    if (code === '401' || code === '403' || code === '429' || code === '503')
      return {
        ...base,
        health: 'bad',
        headline: 'The bank’s website refused the automatic read.',
        fix: { text: PASTE_FIX },
      };
    if (lower.includes('almost no readable text'))
      return {
        ...base,
        health: 'bad',
        headline: 'The page loads its rates with a browser script, so there was nothing to read.',
        fix: {
          text: `${PASTE_FIX} Or point Settings at a plain rate table or PDF address.`,
          href: '/settings#rates',
          hrefLabel: 'Change the address in Settings',
        },
      };
    if (lower.includes('no rates could be read'))
      return {
        ...base,
        health: 'bad',
        headline: 'The page opened, but no savings or NRE deposit rates were found on it.',
        fix: {
          text: 'Check the address points at the rate table, not the bank’s home page.',
          href: '/settings#rates',
          hrefLabel: 'Check the address in Settings',
        },
      };
    if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('timed out'))
      return {
        ...base,
        health: 'warn',
        headline: 'The page took too long to answer.',
        fix: { text: 'Nothing to do: it is tried again next Monday.' },
      };
    return {
      ...base,
      health: 'bad',
      headline: 'The page could not be refreshed.',
      fix: { text: PASTE_FIX },
    };
  }
  const old = src.lastRunOn ? daysBetween(src.lastRunOn, today) : null;
  return {
    ...base,
    health: old !== null && old > staleRunDays ? 'warn' : 'idle',
    headline: r,
    fix: null,
  };
}

/** Marks a read that succeeded long ago as needing a look: the Monday job may have stopped. */
export function withRunAge(s: SourceStatus, today: string, staleRunDays = 10): SourceStatus {
  if (!s.ranOn || s.health === 'idle') return s;
  const old = daysBetween(s.ranOn, today);
  if (old <= staleRunDays) return s;
  return {
    ...s,
    health: s.health === 'ok' ? 'warn' : s.health,
    headline: `${s.headline} Last tried ${old} days ago.`,
    fix: s.fix ?? {
      text: 'The Monday refresh seems to have stopped. Check “Refresh interest rates” under GitHub > Actions.',
    },
  };
}

// ---- the board ------------------------------------------------------------------------------------------------------

export type BoardSort = 'fd' | 'saving' | 'name' | 'old';
export type BoardView = 'held' | 'all';
export const BOARD_SORTS: { key: BoardSort; label: string }[] = [
  { key: 'fd', label: 'Highest FD' },
  { key: 'saving', label: 'Highest savings' },
  { key: 'name', label: 'Bank name' },
  { key: 'old', label: 'Oldest check first' },
];
export const parseSort = (s: string | undefined): BoardSort =>
  (BOARD_SORTS.find((x) => x.key === s)?.key ?? 'fd') as BoardSort;
export const parseView = (s: string | undefined): BoardView => (s === 'all' ? 'all' : 'held');

export interface BankCard {
  bank: string;
  held: number;
  holds: boolean;
  ladder: SlabStep[];
  savingsCount: number;
  depositCount: number;
  bestSaving: BoardOffer | null;
  bestFd: BoardOffer | null;
  checkedOn: string | null;
  ageDays: number | null;
  stale: boolean;
  lastMove: BankSummary['lastMove'];
  differs: number;
  misread: number;
  origins: Origin[];
  source: SourceStatus;
}

/** Bank names with each bank once, in the order first seen: the first spelling wins ("Jana Bank" and "Jana Small Finance Bank" are one bank). */
export function canonicalBanks(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) if (!out.some((b) => sameBank(b, n))) out.push(n);
  return out;
}

export interface HoldingLite {
  bank: string;
  current: number;
  needsConfirmation: boolean;
}

/** One card per bank: the banks you use, or every bank with a rate on file, in the order asked. */
export function buildBoardCards(args: {
  offers: BoardOffer[];
  events: RateEventRow[];
  holdings: HoldingLite[];
  sources: RateSourceRow[];
  today: string;
  staleDays: number;
  view: BoardView;
  sort: BoardSort;
}): BankCard[] {
  const { offers, events, holdings, sources, today, staleDays } = args;
  const heldBanks = canonicalBanks(holdings.map((h) => h.bank));
  const banks = canonicalBanks([...heldBanks, ...offers.map((o) => o.bank)]);
  const scaleMax = Math.max(0, ...offers.filter((o) => o.product === 'savings').map((o) => o.rate));
  const cards = banks.map((bank): BankCard => {
    const s = bankSummary(offers, events, bank);
    const mine = offers.filter((o) => sameBank(o.bank, bank));
    const src = sources.find((x) => sameBank(x.bank, bank)) ?? null;
    const age = s.checkedOn ? Math.max(0, daysBetween(s.checkedOn, today)) : null;
    return {
      bank,
      held: holdings
        .filter((h) => !h.needsConfirmation && sameBank(h.bank, bank))
        .reduce((t, h) => t + h.current, 0),
      holds: heldBanks.some((b) => sameBank(b, bank)),
      ladder: slabLadder(s.savings, scaleMax),
      savingsCount: s.savings.length,
      depositCount: s.deposits.length,
      bestSaving: s.bestSaving,
      bestFd: s.bestFd,
      checkedOn: s.checkedOn,
      ageDays: age,
      stale: age !== null && age > staleDays,
      lastMove: s.lastMove,
      differs: s.differs,
      misread: s.misread,
      origins: originsOf(mine),
      source: withRunAge(sourceStatus(src, today), today),
    };
  });
  const shown = cards.filter((c) => args.view === 'all' || c.holds);
  return shown.sort((a, b) => {
    switch (args.sort) {
      case 'name':
        return a.bank.localeCompare(b.bank);
      case 'saving':
        return (
          (b.bestSaving?.rate ?? -1) - (a.bestSaving?.rate ?? -1) || a.bank.localeCompare(b.bank)
        );
      case 'old':
        // never-checked banks have nothing to be old; they go last
        return (
          (a.checkedOn ?? '9999').localeCompare(b.checkedOn ?? '9999') ||
          a.bank.localeCompare(b.bank)
        );
      default:
        return (b.bestFd?.rate ?? -1) - (a.bestFd?.rate ?? -1) || a.bank.localeCompare(b.bank);
    }
  });
}

/** "up 0.25 pts on 12 Oct 2026 (7.75% to 8.00%)", with the rate that moved when the log line is known; null when nothing has moved. */
export function moveText(
  m: { from: number; to: number; at: string; event?: RateEventRow } | null,
): { dir: 'up' | 'down' | 'flat'; what: string | null; text: string } | null {
  if (!m) return null;
  const d = m.to - m.from;
  const what = m.event
    ? slotText({
        product: m.event.product,
        accountKind: m.event.accountKind,
        tenureFrom: m.event.tenureFrom,
        tenureTo: m.event.tenureTo,
        balanceFrom: m.event.balanceFrom,
        balanceTo: m.event.balanceTo,
      })
    : null;
  if (Math.abs(d) < 0.00005) return { dir: 'flat', what, text: `unchanged on ${niceDay(m.at)}` };
  return {
    dir: d > 0 ? 'up' : 'down',
    what,
    text: `${d > 0 ? 'up' : 'down'} ${pointsText(d)} on ${niceDay(m.at)} (${ratePct(m.from)} to ${ratePct(m.to)})`,
  };
}

// ---- the change log -------------------------------------------------------------------------------------------------

export interface EventLine {
  at: string;
  /** "FD, NRE deposit, 2 yr" */
  what: string;
  action: string;
  oldRate: number | null;
  newRate: number | null;
  dir: 'up' | 'down' | 'flat' | 'new' | 'gone';
  who: string;
  why: string | null;
}

/** One line of the change log, in words. */
export function eventLine(e: RateEventRow): EventLine {
  const what = slotText({
    product: e.product,
    accountKind: e.accountKind,
    tenureFrom: e.tenureFrom,
    tenureTo: e.tenureTo,
    balanceFrom: e.balanceFrom,
    balanceTo: e.balanceTo,
  });
  const dir: EventLine['dir'] =
    e.kind === 'added'
      ? 'new'
      : e.kind === 'removed'
        ? 'gone'
        : e.oldRate === null || e.newRate === null || Math.abs(e.newRate - e.oldRate) < 0.00005
          ? 'flat'
          : e.newRate > e.oldRate
            ? 'up'
            : 'down';
  const action =
    e.kind === 'added'
      ? 'Added'
      : e.kind === 'removed'
        ? 'Removed'
        : e.kind === 'corrected'
          ? 'Corrected by you'
          : e.kind === 'confirmed'
            ? 'Page now agrees with your correction'
            : 'Changed';
  return {
    at: e.at,
    what,
    action,
    oldRate: e.oldRate,
    newRate: e.newRate,
    dir,
    who: e.source === 'manual' ? 'You' : 'Monthly refresh',
    why: e.kind === 'corrected' || e.kind === 'confirmed' ? reasonLabel(e.reason) : null,
  };
}

// ---- rates the bank page disagrees with, and corrections waiting to be checked --------------------------------------

export interface PageDifference {
  id: string;
  what: string;
  yours: number;
  page: number;
  seenOn: string | null;
  /** the refresh read this figure wrongly before and you corrected it */
  correction: boolean;
}

export function pageDifferences(offers: BoardOffer[]): PageDifference[] {
  return offers
    .filter((o) => o.pageRate !== null && o.pageRate !== undefined)
    .map((o) => ({
      id: o.id,
      what: slotText(o),
      yours: o.rate,
      page: o.pageRate!,
      seenOn: o.pageSeenOn ?? null,
      correction: o.aiRate !== null && o.aiRate !== undefined,
    }));
}

/** Rates you corrected that the next refresh will check against the page. */
export function pendingCorrections(offers: BoardOffer[]) {
  return offers
    .filter((o) => o.sourceKind === 'manual' && o.aiRate !== null && o.aiRate !== undefined)
    .map((o) => ({
      id: o.id,
      what: slotText(o),
      read: o.aiRate!,
      yours: o.rate,
      reason: reasonLabel(o.correctionReason),
      stillWrong: (o.misreadCount ?? 0) > 0,
      times: o.misreadCount ?? 0,
    }));
}
