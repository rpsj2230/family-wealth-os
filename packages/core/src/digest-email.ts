/**
 * The daily summary as an e-mail: a scannable HTML page that reads well in Gmail on a phone, a compact plain-text version (also used
 * for Telegram and the WhatsApp share), the subject and the preheader. Pure: it formats the numbers it is given (see `DigestInput`);
 * the figures come from the same functions Home, Goals and "Can I retire now?" use, so the e-mail and the portal agree.
 *
 * HTML rules: tables for layout, inline styles (plus a small <style> block that only adds dark-mode colours for clients that read
 * it), a 600 px column, system fonts, no images, no script, no remote resource. Colour is never the only cue: every up or down
 * figure has an arrow and a sign, every state a word. Nothing is pure white or pure black, so a client that darkens the page by
 * itself keeps the text readable.
 */
import { PERCENT_KIND, TERMS } from './terms';
import { DEFAULT_CONFIG } from './config';
import type { DigestInput } from './digest';
import {
  ARROW,
  dayGap,
  esc,
  inr,
  inrExact,
  niceDate,
  plainPct,
  dayMonth,
  signedInr,
  signedPct,
  tone,
} from './digest-format';
import type { DigestGoalCard } from './digest-goals';
import {
  foreignRupeeLine,
  foreignShort,
  formatForeign,
  formatRate,
  shortDay,
} from './foreign-cash';
import { digestSubject, needsYouMarker, DIGEST_SUBJECT_NAME } from './digest-subject';
import { FAMILY_KIND_LABEL, familyLines, signedExact, type DigestFamily } from './digest-family';
import type { Change, ClassCard } from './home';

export interface DigestEmail {
  subject: string;
  /** the hidden line some clients show beside the subject */
  preheader: string;
  html: string;
  /** compact plain text: the e-mail's text part and the Telegram message */
  text: string;
  /** the same numbers for the WhatsApp share (bold with *asterisks*) */
  chat: string;
}

/** Longest plain-text version we build, safely under Telegram's 4,096 characters. */
export const DIGEST_TEXT_LIMIT = 3600;

// ------------------------------------------------------------------------------------------------
// Colours: light values inline, dark values in the <style> block (clients that ignore it keep the light ones)
// ------------------------------------------------------------------------------------------------
const L = {
  page: '#e9edf2',
  card: '#f8f9fb',
  tile: '#f1f4f8',
  ink: '#1b2433',
  mute: '#566275',
  line: '#d5dbe4',
  up: '#14733f',
  down: '#b3261e',
  warn: '#8a5300',
  brand: '#12355b',
  brandInk: '#eef3fa',
  accent: '#2b64d6',
  accent2: '#9db8ee',
  track: '#dde3ec',
} as const;

const CHIP: Record<string, { bg: string; fg: string; cls: string }> = {
  on_track: { bg: '#d9efe3', fg: '#0f5c34', cls: 'c-ok' },
  ahead: { bg: '#d6e8fa', fg: '#0a4a8a', cls: 'c-ahead' },
  behind: { bg: '#fbdedb', fg: '#8d1a12', cls: 'c-bad' },
  no_data: { bg: '#e4e8ee', fg: '#3f4a5a', cls: 'c-na' },
  past_due: { bg: '#e4e8ee', fg: '#3f4a5a', cls: 'c-na' },
  warn: { bg: '#fdeccb', fg: '#734300', cls: 'c-warn' },
  ok: { bg: '#d9efe3', fg: '#0f5c34', cls: 'c-ok' },
};

const DARK_CSS = `
@media (prefers-color-scheme: dark) {
  .pg { background:#0f141b !important; }
  .cd { background:#18202b !important; border-color:#2a3442 !important; }
  .tl { background:#202a37 !important; }
  .ink { color:#e7ecf3 !important; }
  .mu { color:#a2aebf !important; }
  .ln { border-color:#2d3846 !important; }
  .up { color:#58cf93 !important; }
  .dn { color:#ff8a80 !important; }
  .wn { color:#f2b95a !important; }
  .tr { background:#2d3846 !important; }
  .bar1 { background:#6c9cff !important; }
  .bar2 { background:#3a5a99 !important; }
  .c-ok { background:#1d3a2c !important; color:#8fe0b6 !important; }
  .c-ahead { background:#1c3552 !important; color:#9cc8f5 !important; }
  .c-bad { background:#46201d !important; color:#ffb4ac !important; }
  .c-na { background:#2a3340 !important; color:#c0cad8 !important; }
  .c-warn { background:#43320f !important; color:#f6cd84 !important; }
  .btn { background:#6c9cff !important; color:#0f141b !important; }
  .hd { background:#0b2540 !important; }
}`;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// ------------------------------------------------------------------------------------------------
// The model both renderers read
// ------------------------------------------------------------------------------------------------
interface NeedsItem {
  text: string;
  href: string;
  tone: 'bad' | 'warn' | 'info';
}

function legacyNeeds(i: DigestInput): NeedsItem[] {
  const a = i.attention;
  const out: NeedsItem[] = [];
  for (const m of a.maturedUnconfirmed.slice(0, 5))
    out.push({
      text: `${m} has matured; confirm where the money went (not counted until you do).`,
      href: '/deposits?tab=maturities',
      tone: 'bad',
    });
  for (const m of a.maturingSoon.slice(0, 5))
    out.push({
      text: `${m.name} matures in ${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'} (${inrExact(m.amount)}).`,
      href: '/deposits?tab=maturities',
      tone: 'warn',
    });
  for (const l of a.overdueLoans.slice(0, 5))
    out.push({
      text: `${l.name} owes ${inrExact(l.outstanding)}, ${l.daysOverdue} days overdue.`,
      href: '/others',
      tone: 'bad',
    });
  const taskDays = i.reminders?.taskDays ?? DEFAULT_CONFIG.reminders.taskDays;
  const tasks = (a.tasksDue ?? [])
    .map((t) => ({ ...t, daysLeft: dayGap(i.date, t.dueOn) }))
    .filter((t) => t.daysLeft <= taskDays)
    .sort((x, y) => x.daysLeft - y.daysLeft);
  for (const t of tasks.slice(0, 5)) {
    const title = t.title.replace(/^\[Plan [\w-]+\]\s*/, '').slice(0, 140);
    out.push({
      text:
        t.daysLeft < 0
          ? `Overdue by ${-t.daysLeft} day${t.daysLeft === -1 ? '' : 's'}: ${title}`
          : t.daysLeft === 0
            ? `Due today: ${title}`
            : `Due ${niceDate(t.dueOn)} (in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}): ${title}`,
      href: '/tasks',
      tone: t.daysLeft < 0 ? 'bad' : 'warn',
    });
  }
  for (const idea of (i.rateIdeas ?? []).slice(0, 2))
    out.push({ text: `Better rate: ${idea}`, href: '/rates', tone: 'info' });
  for (const t of (i.taxIdeas ?? []).slice(0, 3)) out.push({ text: t, href: '/tax', tone: 'warn' });
  const policyDays = i.reminders?.policyDays ?? DEFAULT_CONFIG.reminders.policyDays;
  const pol = (a.policyDates ?? [])
    .map((p) => ({ ...p, daysLeft: dayGap(i.date, p.on) }))
    .filter((p) => p.daysLeft <= policyDays)
    .sort((x, y) => x.daysLeft - y.daysLeft);
  for (const p of pol.slice(0, 5)) {
    const what = p.kind === 'renewal' ? 'renewal' : 'cover ends';
    out.push({
      text:
        p.daysLeft < 0
          ? `${p.insurer} ${what} date (${niceDate(p.on)}) has passed; confirm it was renewed and update the date.`
          : `${p.insurer} ${what} on ${niceDate(p.on)} (${p.daysLeft === 0 ? 'today' : `in ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}`}).`,
      href: '/others?tab=policies',
      tone: p.daysLeft < 0 ? 'bad' : 'warn',
    });
  }
  if (a.staleOrMissing > 0)
    out.push({
      text: `${a.staleOrMissing} records are stale or have no value; update them in Monthly update.`,
      href: '/monthly',
      tone: 'warn',
    });
  if (i.netWorth.excluded.some((x) => x.reason === 'no_valuation'))
    out.push({
      text: 'Some assets have no recorded value and are not counted.',
      href: '/monthly',
      tone: 'info',
    });
  return out;
}

/** What the person is told about the data behind the numbers: the bank balance, the NAV and exchange-rate dates, the basis split. */
function dataLines(i: DigestInput): { bank: string; rest: string[] } {
  const nw = i.netWorth;
  const bank =
    !i.lastBankBalanceAsOf || dayGap(i.lastBankBalanceAsOf, i.date) > 2
      ? `No new verified bank balance received.${i.lastBankBalanceAsOf ? ` The latest bank balance on record is dated ${niceDate(i.lastBankBalanceAsOf)}.` : ''}`
      : `Latest bank balance on record is dated ${niceDate(i.lastBankBalanceAsOf)}.`;
  const rest = [
    i.market.navLatest
      ? `Fund values use the latest NAV, dated ${niceDate(i.market.navLatest)}.`
      : 'Fund values are carried forward from your last recorded values (no NAV data yet).',
    ...Object.entries(i.market.fx).map(
      ([cur, v]) => `${cur} converted at ₹${v.rate.toFixed(3)} (rate dated ${niceDate(v.date)}).`,
    ),
  ];
  const e = nw.estimateTotals;
  rest.push(
    `Of the total, ${inr(e.byBasis.calculated)} is calculated from contracts or units, ${inr(e.byBasis.estimated)} is estimated and ${inr(e.byBasis.carried_forward)} is carried forward from your last entry.`,
  );
  return { bank, rest };
}

interface Model {
  i: DigestInput;
  subject: string;
  preheader: string;
  total: number;
  today: { amount: number; pct: number | null } | null;
  todayLabel: string;
  overall: {
    profit: number;
    profitPct: number | null;
    invested: number;
    estimated: boolean;
  } | null;
  month: Change | null;
  classes: ClassCard[];
  /** the family figures (money words v6), from Home's model; null leaves them out */
  family: DigestFamily | null;
  goals: DigestGoalCard[] | null;
  retire: DigestGoalCard | null;
  retireLine: string | null;
  needs: NeedsItem[];
  needsTotal: number;
  late: number;
  asOf: string | null;
  data: { bank: string; rest: string[] };
  base: string;
}

function model(i: DigestInput): Model {
  const nw = i.netWorth;
  const w = i.wealth ?? null;
  const cfg = DEFAULT_CONFIG.digest;
  const max = i.limits?.needsYouMax ?? cfg.needsYouMax;
  const allNeeds = i.needsYou ?? legacyNeeds(i);
  // the day's change: Home's (what the banks earned plus the funds' move), else the move since the last saved day
  const prev = i.previous ? nw.total - i.previous.total : null;
  const today = w
    ? { amount: w.today.amount, pct: w.today.pct }
    : prev !== null && i.previous
      ? { amount: prev, pct: i.previous.total > 0 ? prev / i.previous.total : null }
      : null;
  const goals = i.goals ?? null;
  const retire = i.retirement?.card ?? null;
  const showMonth = i.month ?? null;
  const base = i.appUrl.replace(/\/+$/, '');
  const m: Model = {
    i,
    subject: '',
    preheader: '',
    total: w ? w.total : nw.total,
    today,
    todayLabel: w || !i.previous ? TERMS.todayChange.label : `Since ${dayMonth(i.previous.date)}`,
    overall: w ? w.overall : null,
    month: showMonth,
    classes: w ? w.classes : [],
    family: i.family ?? null,
    goals,
    retire,
    retireLine: i.retirement
      ? `${i.retirement.statusText}${i.retirement.earliestAge !== null ? `; earliest age that meets the plan under your assumptions: ${i.retirement.earliestAge}` : ''}`
      : null,
    needs: allNeeds.slice(0, max),
    needsTotal: allNeeds.length,
    late: i.lateInputs ?? i.attention.staleOrMissing,
    asOf: i.asOf ?? null,
    data: dataLines(i),
    base,
  };
  m.subject = digestSubject({
    date: i.date,
    netWorth: m.total,
    dayPct: today ? today.pct : null,
    needsYou: allNeeds.length,
  });
  const bits: string[] = [];
  bits.push(
    today && Math.round(today.amount) !== 0
      ? `Net worth ${inr(m.total)}, ${today.amount < 0 ? 'down' : 'up'} ${inr(Math.abs(today.amount))} today`
      : `Net worth ${inr(m.total)}`,
  );
  const gl = [...(goals ?? []), ...(retire ? [retire] : [])];
  if (gl.length) {
    const n = (s: string) => gl.filter((g) => g.state === s).length;
    const ok = n('on_track') + n('ahead');
    const behind = n('behind');
    bits.push(
      `${ok} of ${gl.length} ${gl.length === 1 ? 'goal' : 'goals'} on track${behind ? `, ${behind} behind` : ''}`,
    );
  }
  if (allNeeds.length) bits.push(needsYouMarker(allNeeds.length));
  m.preheader = bits.join(' · ');
  return m;
}

// ------------------------------------------------------------------------------------------------
// HTML pieces
// ------------------------------------------------------------------------------------------------
const toneClass = (t: 'up' | 'down' | 'flat') => (t === 'up' ? 'up' : t === 'down' ? 'dn' : 'mu');
const toneColor = (t: 'up' | 'down' | 'flat') =>
  t === 'up' ? L.up : t === 'down' ? L.down : L.mute;

/**
 * "▲ +₹1.2 L (+0.4%)" in green or red, with the exact amount in the title. `exact` writes the amount to the rupee, `decimals` the
 * places of the percentage and `kind` the word after it ("overall").
 */
function delta(
  amount: number,
  pct: number | null,
  size = 14,
  bold = true,
  o: { exact?: boolean; decimals?: number; kind?: string } = {},
): string {
  const t = tone(amount);
  // the amount and the percentage may wrap apart on a narrow screen, but neither is cut in two
  const p =
    pct !== null && t !== 'flat'
      ? ` <span style="white-space:nowrap">(${esc(signedPct(pct, o.decimals ?? 1))}${o.kind ? ` ${esc(o.kind)}` : ''})</span>`
      : '';
  return `<span class="${toneClass(t)}" title="${esc(inrExact(amount))}" style="color:${toneColor(t)};font-size:${size}px;${bold ? 'font-weight:700;' : ''}"><span style="white-space:nowrap">${ARROW[t]} ${esc(o.exact ? signedExact(amount) : signedInr(amount))}</span>${p}</span>`;
}

function chip(label: string, key: keyof typeof CHIP): string {
  const c = CHIP[key]!;
  return `<span class="${c.cls}" style="display:inline-block;background:${c.bg};color:${c.fg};font-size:12px;font-weight:700;line-height:16px;padding:3px 9px;border-radius:999px;white-space:nowrap">${esc(label)}</span>`;
}

function bar(savedPct: number | null, projectedPct: number | null, label: string): string {
  const a = Math.round((savedPct ?? 0) * 10) / 10;
  const b = Math.max(0, Math.round(((projectedPct ?? 0) - a) * 10) / 10);
  const rest = Math.max(0, Math.round((100 - a - b) * 10) / 10);
  const cell = (w: number, cls: string, bg: string) =>
    w > 0
      ? `<td class="${cls}" width="${w}%" style="width:${w}%;height:10px;line-height:10px;font-size:0;background:${bg}">&nbsp;</td>`
      : '';
  return `<table role="img" aria-label="${esc(label)}" width="100%" cellpadding="0" cellspacing="0" border="0" class="tr" style="width:100%;background:${L.track};border-radius:5px;border-collapse:separate;overflow:hidden"><tr>${cell(a, 'bar1', L.accent)}${cell(b, 'bar2', L.accent2)}${cell(rest, 'tr', L.track)}</tr></table>`;
}

function section(title: string, body: string, note = ''): string {
  return `<tr><td class="pg" style="padding:18px 16px 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ink" style="font:700 13px/18px ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${L.ink};padding:0 4px 8px 4px">${esc(title)}${note ? ` <span class="mu" style="font-weight:400;letter-spacing:0;text-transform:none;color:${L.mute}">${esc(note)}</span>` : ''}</td></tr>${body}</table></td></tr>`;
}

const card = (inner: string, pad = '14px 16px') =>
  `<tr><td class="cd" style="background:${L.card};border:1px solid ${L.line};border-radius:12px;padding:${pad}">${inner}</td></tr><tr><td height="10" style="height:10px;line-height:10px;font-size:0">&nbsp;</td></tr>`;

/** A yearly rate in a tile or the hero: 7.59%. */
const ratePct = (r: number) => plainPct(r, 2);

function tile(c: ClassCard, label: string, f: DigestFamily | null): string {
  const t = tone(c.today);
  const hasProfit = (c.key === 'fd' || c.key === 'funds') && c.invested > 0;
  const pt = tone(c.profit);
  const share = Math.round(c.share * 1000) / 10;
  const lines: string[] = [];
  if (c.key !== 'others')
    lines.push(
      `<div class="mu" style="color:${L.mute};font-size:12px;line-height:17px">${esc(TERMS.todayChange.label)} <span class="${toneClass(t)}" style="color:${toneColor(t)};font-weight:700;white-space:nowrap">${ARROW[t]} ${esc(signedInr(c.today))}</span></div>`,
    );
  if (hasProfit)
    lines.push(
      `<div class="mu" style="color:${L.mute};font-size:12px;line-height:17px">${esc(TERMS.profit.label)} <span class="${toneClass(pt)}" style="color:${toneColor(pt)};font-weight:700" title="${esc(inrExact(c.profit))}">${esc(signedInr(c.profit))}${c.profitPct !== null ? ` (${esc(signedPct(c.profitPct))} ${PERCENT_KIND.overall})` : ''}${c.estimated ? ' est.' : ''}</span></div>`,
    );
  // the yearly rate Home shows on the same card: XIRR for deposits and funds, the rate savings earned this financial year
  const yearly =
    c.key === 'fd'
      ? f?.fd?.xirr
      : c.key === 'funds'
        ? f?.funds?.xirr
        : c.key === 'cash'
          ? f?.savings?.rate
          : null;
  if (yearly !== null && yearly !== undefined)
    lines.push(
      `<div class="mu" style="color:${L.mute};font-size:12px;line-height:17px">${esc(c.key === 'cash' ? TERMS.rateEarned.label : TERMS.xirr.label)} <span class="ink" style="color:${L.ink};font-weight:700;white-space:nowrap">${esc(ratePct(yearly))} ${PERCENT_KIND.yearly}</span></div>`,
    );
  // foreign cash: the savings in S$ (or another currency) on their own, with the rupee value and the rate in small type under it.
  // The tile's own figure above stays the rupee total of all cash.
  for (const f of c.foreign ?? [])
    lines.push(
      `<div class="mu" title="${esc(foreignRupeeLine(f))}" style="color:${L.mute};font-size:12px;line-height:17px;padding-top:3px">of it <span class="ink" style="color:${L.ink};font-weight:700;white-space:nowrap">${esc(formatForeign(f.native, f.currency))}</span></div><div class="mu" style="color:${L.mute};font-size:11px;line-height:15px">≈ ${esc(inr(f.inr))} at ₹${esc(formatRate(f.rate))}${f.rateDate ? ` (${esc(shortDay(f.rateDate))})` : ''}</div>`,
    );
  return `<div style="display:inline-block;width:100%;max-width:142px;vertical-align:top;font-size:14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="tl" style="background:${L.tile};border-radius:10px;table-layout:fixed"><tr><td height="${f ? 150 : 132}" valign="top" align="left" style="height:${f ? 150 : 132}px;text-align:left;padding:10px 10px 11px 10px;font-family:${FONT}">
<div class="mu" style="color:${L.mute};font-size:11px;line-height:15px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">${esc(label)}</div>
<div class="ink" title="${esc(inrExact(c.current))}" style="color:${L.ink};font-size:20px;line-height:27px;font-weight:700;white-space:nowrap">${esc(inr(c.current))}</div>
<div class="mu" style="color:${L.mute};font-size:12px;line-height:17px;padding-bottom:5px">${esc(share.toFixed(share >= 10 || share === 0 ? 0 : 1))}% of total</div>
${bar(Math.min(100, share), null, `${share}% of total`).replace('height:10px', 'height:4px')}
<div style="padding-top:6px">${lines.join('')}</div>
</td></tr></table></td></tr></table></div>`;
}

const TILE_ORDER = ['fd', 'cash', 'funds', 'others'];
const TILE_SHORT: Record<string, string> = {
  fd: 'FDs',
  cash: 'Savings',
  funds: 'Mutual funds',
  others: 'Other',
};
const TILE_LABEL: Record<string, string> = {
  fd: 'In FDs',
  cash: 'In savings',
  funds: 'In mutual funds',
  others: 'In other',
};

function goalBlock(g: DigestGoalCard, base: string, href: string): string {
  const key = g.state;
  const dateLine =
    g.state === 'no_data' || g.state === 'past_due'
      ? ''
      : g.kind === 'retirement'
        ? `Corpus needed ${esc(inr(g.needed ?? 0))} in today’s money${g.date ? ` · by ${esc(niceDate(g.date))}` : ''}`
        : g.targetToday
          ? `Target ${esc(inr(g.targetToday))} today, ${esc(inr(g.needed ?? 0))} by ${g.date ? esc(niceDate(g.date)) : ''} with price rises`
          : `Needs ${esc(inr(g.needed ?? 0))} by ${g.date ? esc(niceDate(g.date)) : ''}`;
  const pct = g.savedPct === null ? '' : `${Math.round(g.savedPct)}% saved`;
  const proj =
    g.projectedPct === null
      ? ''
      : ` · pace reaches ${Math.round(g.projectedPct)}%${g.projectedPct >= 100 ? '' : ' of it'}`;
  const barHtml =
    g.savedPct === null
      ? ''
      : `<tr><td style="padding-top:9px">${bar(g.savedPct, g.projectedPct, `${pct}${proj}`)}</td></tr>
<tr><td class="mu" style="color:${L.mute};font-size:12px;line-height:17px;padding-top:4px"><span class="ink" style="color:${L.ink};font-weight:700" title="${esc(inrExact(g.saved))}">${esc(inr(g.saved))}</span> ${g.kind === 'retirement' ? 'held now' : 'saved so far'} · ${esc(pct)}${esc(proj)}</td></tr>`;
  const extra =
    g.kind === 'retirement' && g.extra
      ? `<tr><td class="mu" style="color:${L.mute};font-size:12px;line-height:17px;padding-top:2px">${[
          g.extra.yearsToGo !== null
            ? `${g.extra.yearsToGo < 1 ? 'Under a year' : `${Math.round(g.extra.yearsToGo)} years`} to go (age ${g.extra.retireAtAge})`
            : '',
          g.extra.successRate !== null
            ? `${plainPct(g.extra.successRate)} chance the money lasts`
            : '',
        ]
          .filter(Boolean)
          .map(esc)
          .join(' · ')}</td></tr>`
      : '';
  return card(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="ink" style="font:700 16px/22px ${FONT};color:${L.ink}"><a href="${esc(base + href)}" class="ink" style="color:${L.ink};text-decoration:none">${esc(g.name)}</a></td><td align="right" style="padding-left:8px;vertical-align:top">${chip(g.chip, key)}</td></tr>
${dateLine ? `<tr><td colspan="2" class="mu" style="color:${L.mute};font-size:12px;line-height:17px;padding-top:2px">${dateLine}</td></tr>` : ''}
<tr><td colspan="2"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${barHtml}${extra}</table></td></tr>
<tr><td colspan="2" class="ink" style="color:${L.ink};font-size:14px;line-height:21px;padding-top:9px">${esc(g.line)}</td></tr>
</table>`,
  );
}

function needsRow(n: NeedsItem, base: string): string {
  const color = n.tone === 'bad' ? L.down : n.tone === 'warn' ? '#b87400' : L.accent;
  const word = n.tone === 'bad' ? 'Late' : n.tone === 'warn' ? 'Soon' : 'Note';
  return `<tr><td valign="top" width="52" style="width:52px;padding:7px 8px 7px 0;font:700 11px/16px ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${color}">${word}</td><td class="ink" style="padding:6px 0;font:14px/20px ${FONT};color:${L.ink}"><a href="${esc(base + n.href)}" class="ink" style="color:${L.ink};text-decoration:underline">${esc(n.text)}</a></td></tr>`;
}

function moverRow(label: string, change: number): string {
  return `<tr><td class="ink" style="padding:3px 0;font:14px/20px ${FONT};color:${L.ink}">${esc(label)}</td><td align="right" style="padding:3px 0;font:14px/20px ${FONT}">${delta(change, null, 14)}</td></tr>`;
}

function buildHtml(m: Model): string {
  const { i } = m;
  const base = m.base;
  const rows: string[] = [];

  // a. header
  const lateChip =
    m.late > 0
      ? chip(`${m.late} input${m.late === 1 ? '' : 's'} late`, 'warn')
      : chip('All inputs current', 'ok');
  rows.push(
    `<tr><td class="hd" style="background:${L.brand};padding:18px 20px 16px 20px;border-radius:14px 14px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font:700 20px/26px ${FONT};color:${L.brandInk}">Family wealth</td><td align="right" style="font:14px/20px ${FONT};color:${L.brandInk}">${esc(niceDate(i.date))}</td></tr><tr><td colspan="2" style="padding-top:8px;font:13px/20px ${FONT};color:${L.brandInk}">${m.asOf ? `Values as of ${esc(niceDate(m.asOf))} &nbsp; ` : ''}${lateChip}</td></tr></table></td></tr>`,
  );

  // b. hero
  const t = m.today;
  const o = m.overall;
  const f = m.family;
  const heroToday = t
    ? Math.round(t.amount) === 0
      ? `<span class="mu" style="color:${L.mute};font-size:14px;font-weight:700">${ARROW.flat} No change yet today</span>`
      : f
        ? delta(t.amount, t.pct, 15, true, { exact: true, decimals: 2 })
        : delta(t.amount, t.pct, 15)
    : `<span class="mu" style="color:${L.mute};font-size:14px">First report: nothing to compare with yet</span>`;
  const heroOverall = o
    ? delta(o.profit, o.profitPct, 15)
    : `<span class="mu" style="color:${L.mute};font-size:14px">Not enough data</span>`;
  const notYet = `<span class="mu" style="color:${L.mute};font-size:14px">Not worked out yet</span>`;
  /** one row of two labelled figures */
  const pair = (a: [string, string], b: [string, string] | null, top = 14) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${top}px"><tr>
<td valign="top" width="50%" style="padding-right:8px"><div class="mu" style="font:12px/16px ${FONT};color:${L.mute}">${esc(a[0])}</div><div style="padding-top:2px">${a[1]}</div></td>
<td valign="top" width="50%">${b ? `<div class="mu" style="font:12px/16px ${FONT};color:${L.mute}">${esc(b[0])}</div><div style="padding-top:2px">${b[1]}</div>` : ''}</td></tr></table>`;
  const plain = (s: string) =>
    `<span class="ink" style="color:${L.ink};font-size:15px;font-weight:700;white-space:nowrap">${esc(s)}</span>`;
  const monthLine = m.month
    ? ` Earned, last 30 days: <span class="${toneClass(tone(m.month.amount))}" style="color:${toneColor(tone(m.month.amount))};font-weight:700">${esc(signedInr(m.month.amount))}${m.month.pct !== null ? ` (${esc(signedPct(m.month.pct))})` : ''}</span>.`
    : '';
  // with Home's family figures: Today's change and Earned this FY; Own money and Lifetime profit; XIRR on own money and the earning
  // rate now (money words v6). Without them (an older input), the profit of the holdings, named as such.
  const heroRows = f
    ? [
        pair(
          [m.todayLabel, heroToday],
          [
            TERMS.earnedFy.label,
            f.earnedFy ? delta(f.earnedFy.amount, null, 15, true, { exact: true }) : notYet,
          ],
        ),
        pair(
          [TERMS.ownMoney.label, f.own ? plain(inrExact(f.own.ownMoney)) : notYet],
          [
            TERMS.lifetimeProfit.label,
            f.own
              ? delta(f.own.lifetimeProfit, f.own.profitPct, 15, true, {
                  exact: true,
                  kind: PERCENT_KIND.overall,
                })
              : notYet,
          ],
          12,
        ),
        pair(
          [TERMS.xirrOwn.label, f.xirrOwn !== null ? plain(ratePct(f.xirrOwn)) : notYet],
          [
            TERMS.earningRate.label,
            f.earningRate !== null ? plain(ratePct(f.earningRate)) : notYet,
          ],
          12,
        ),
        `<div class="mu" style="font:12px/17px ${FONT};color:${L.mute};padding-top:8px">${esc(TERMS.lifetimeProfit.label)} is ${esc(TERMS.netWorth.label.toLowerCase())} − ${esc(TERMS.ownMoney.label.toLowerCase())}, since records began. ${esc(TERMS.profit.label)} on each kind below is its current value − invested${o?.estimated ? '; partly an estimate' : ''}.${monthLine}</div>`,
      ].join('\n')
    : [
        pair(
          [m.todayLabel, heroToday],
          [`${TERMS.profit.label} (${PERCENT_KIND.overall})`, heroOverall],
        ),
        o
          ? `<div class="mu" style="font:12px/17px ${FONT};color:${L.mute};padding-top:8px">${esc(TERMS.profit.label)} of the deposits and funds held: current value − the ${esc(inr(o.invested))} invested${o.estimated ? '; partly an estimate' : ''}. ${esc(TERMS.lifetimeProfit.label)} on your own money is on Home.${monthLine}</div>`
          : '',
      ].join('\n');
  rows.push(
    `<tr><td class="cd" style="background:${L.card};padding:20px 20px 18px 20px;border-left:1px solid ${L.line};border-right:1px solid ${L.line}">
<div class="mu" style="font:700 12px/16px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${L.mute}">${esc(TERMS.netWorth.label)}</div>
<div class="ink" title="${esc(inrExact(m.total))}" style="font:700 40px/48px ${FONT};color:${L.ink};letter-spacing:-.01em">${esc(inr(m.total))}</div>
<div class="mu" style="font:13px/18px ${FONT};color:${L.mute}">${esc(inrExact(m.total))}${i.wealth ? '' : ' · estimated'}</div>
${heroRows}
</td></tr>`,
  );

  // c. tiles
  if (m.classes.length) {
    const ordered = [...m.classes].sort(
      (a, b) => TILE_ORDER.indexOf(a.key) - TILE_ORDER.indexOf(b.key),
    );
    const tiles = ordered.map((c) => tile(c, TILE_LABEL[c.key] ?? c.label, f)).join('');
    const maturing = f
      ? `<div class="mu" style="font:13px/19px ${FONT};color:${L.mute};text-align:left;padding:8px 4px 0 4px">Maturing in the next 30 days: <span class="ink" style="color:${L.ink};font-weight:700;white-space:nowrap">${f.maturing30.principal > 0 ? esc(inrExact(f.maturing30.principal)) : 'nothing'}</span></div>`
      : '';
    rows.push(
      `<tr><td class="cd" style="background:${L.card};padding:0 12px 14px 12px;border-left:1px solid ${L.line};border-right:1px solid ${L.line};border-bottom:1px solid ${L.line};border-radius:0 0 14px 14px;font-size:0;line-height:0;text-align:center">${tiles}${maturing}</td></tr>`,
    );
  } else {
    rows.push(
      `<tr><td class="cd" style="background:${L.card};height:8px;line-height:8px;font-size:0;border-left:1px solid ${L.line};border-right:1px solid ${L.line};border-bottom:1px solid ${L.line};border-radius:0 0 14px 14px">&nbsp;</td></tr>`,
    );
  }

  // d. goals
  if (m.goals !== null) {
    const list = m.goals;
    const body = list.length
      ? list.map((g) => goalBlock(g, base, '/goals')).join('')
      : card(
          `<div class="ink" style="color:${L.ink};font-size:14px;line-height:21px">No goals set yet. <a href="${esc(base + '/goals')}" class="ink" style="color:${L.ink}">Add one in Goals</a> and this summary will say whether you are on track.</div>`,
        );
    rows.push(section('Goals', body, list.length ? 'are we on track at this pace?' : ''));
  }

  // e. retirement
  if (m.retire) rows.push(section('Retirement', goalBlock(m.retire, base, '/retire')));

  // f. needs you / what changed
  if (m.needs.length) {
    const more = m.needsTotal - m.needs.length;
    rows.push(
      section(
        'Needs you',
        card(
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${m.needs.map((n) => needsRow(n, base)).join('')}</table>${
            more > 0
              ? `<div class="mu" style="color:${L.mute};font-size:12px;line-height:17px;padding-top:6px"><a href="${esc(base)}" class="mu" style="color:${L.mute}">${more} more on Home</a></div>`
              : ''
          }`,
          '8px 16px',
        ),
        `${m.needsTotal} in all`,
      ),
    );
  } else {
    rows.push(
      section(
        'Needs you',
        card(
          `<div class="ink" style="color:${L.ink};font-size:14px;line-height:21px">Nothing needs you today.</div>`,
        ),
      ),
    );
  }
  const ch = i.changes;
  if (ch && (ch.kinds.length || ch.people.length || ch.maturities.length)) {
    const parts: string[] = [];
    if (ch.kinds.length)
      parts.push(
        `<div class="mu" style="font:12px/16px ${FONT};color:${L.mute};padding-bottom:2px">By kind of holding since ${esc(dayMonth(ch.since))}${ch.partial ? ' (the history is shorter than the period)' : ''}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${ch.kinds.map((k) => moverRow(k.label, k.change)).join('')}</table>`,
      );
    if (ch.people.length)
      parts.push(
        `<div class="mu" style="font:12px/16px ${FONT};color:${L.mute};padding:8px 0 2px 0">By person</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${ch.people.map((k) => moverRow(k.label, k.change)).join('')}</table>`,
      );
    if (ch.maturities.length)
      parts.push(
        `<div class="mu" style="font:12px/16px ${FONT};color:${L.mute};padding:8px 0 2px 0">Deposits paying out in the next ${ch.maturityDays} days</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${ch.maturities
          .map(
            (d) =>
              `<tr><td class="ink" style="padding:3px 0;font:14px/20px ${FONT};color:${L.ink}">${esc(d.name)} <span class="mu" style="color:${L.mute};font-size:12px">${esc(dayMonth(d.on))}${d.daysLeft === 0 ? ', today' : `, in ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}`}</span></td><td align="right" class="ink" title="${esc(inrExact(d.amount))}" style="padding:3px 0;font:700 14px/20px ${FONT};color:${L.ink};white-space:nowrap">${esc(inr(d.amount))}</td></tr>`,
          )
          .join('')}</table>`,
      );
    rows.push(
      section('What changed', card(parts.join('')), 'money added or withdrawn is part of a move'),
    );
  }
  if (i.monthly) {
    rows.push(
      section(
        'Month in review',
        card(
          `<div class="ink" style="color:${L.ink};font-size:14px;line-height:21px">Since ${esc(niceDate(i.monthly.since))}: ${delta(i.monthly.change, null, 14)}${
            i.monthly.byPerson.length
              ? `<div class="mu" style="color:${L.mute};font-size:13px;padding-top:4px">${i.monthly.byPerson.map((p) => `${esc(p.name)} ${esc(signedInr(p.change))}`).join(' · ')}</div>`
              : ''
          }<div class="mu" style="color:${L.mute};font-size:12px;padding-top:4px">Mostly interest and market movement unless you added savings.</div></div>`,
        ),
      ),
    );
  }

  // retirement summary line when there is no card (older inputs)
  if (!m.retire && m.retireLine)
    rows.push(
      section(
        'Retirement',
        card(
          `<div class="ink" style="color:${L.ink};font-size:14px;line-height:21px">${esc(m.retireLine)}. An estimate, not a guarantee.</div>`,
        ),
      ),
    );

  // g. footer
  rows.push(
    `<tr><td class="pg" style="padding:6px 16px 0 16px;text-align:center"><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 4px auto"><tr><td class="btn" align="center" style="background:${L.brand};border-radius:8px"><a href="${esc(base)}" class="btn" style="display:inline-block;padding:13px 28px;font:700 15px/20px ${FONT};color:${L.brandInk};text-decoration:none;background:${L.brand};border-radius:8px">Open the portal</a></td></tr></table></td></tr>`,
  );
  const sources = [m.data.bank, ...m.data.rest];
  rows.push(
    `<tr><td class="pg" style="padding:12px 20px 24px 20px"><div class="mu" style="font:12px/18px ${FONT};color:${L.mute}"><strong class="ink" style="color:${L.ink}">Where the numbers come from.</strong> ${sources.map(esc).join(' ')} Goals and retirement look ahead under the assumptions in Goals and in Can I retire now?; they are projections, not promises. Every figure is an estimate built from your last recorded values, interest rates, NAVs and exchange rates, not a bank statement.</div>
<div class="mu" style="font:12px/18px ${FONT};color:${L.mute};padding-top:8px">To change who receives this, or what it shows, go to <a href="${esc(base + '/settings?tab=notifications')}" class="mu" style="color:${L.mute}">Settings &gt; Notifications</a>. ${esc(i.householdName)}.</div></td></tr>`,
  );

  const pad = '&#8199;&#847;'.repeat(40);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(m.subject)}</title><style>${DARK_CSS}</style></head>
<body class="pg" style="margin:0;padding:0;background:${L.page};font-family:${FONT};color:${L.ink};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${L.page}">${esc(m.preheader)}${pad}</div>
<table role="presentation" class="pg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${L.page}"><tr><td align="center" style="padding:12px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto">
${rows.join('\n')}
</table></td></tr></table></body></html>`;
}

// ------------------------------------------------------------------------------------------------
// Plain text
// ------------------------------------------------------------------------------------------------
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

function goalText(g: DigestGoalCard): string {
  if (g.state === 'no_data' || g.state === 'past_due') return `• ${g.name}: ${g.line}`;
  const head = `• ${g.name}: ${g.chip}`;
  const prog =
    g.savedPct !== null
      ? `${inr(g.saved)} of ${inr(g.needed ?? 0)} (${Math.round(g.savedPct)}%)${g.date ? ` by ${shortYear(g.date)}` : ''}`
      : '';
  const tail = g.state === 'behind' && g.topUp > 0 ? `add ${inr(g.topUp)}/month` : '';
  const chance =
    g.kind === 'retirement' && typeof g.extra?.successRate === 'number'
      ? `${plainPct(g.extra.successRate)} chance it lasts`
      : '';
  return [head, prog, tail, chance].filter(Boolean).join(' · ');
}

const shortYear = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

function buildText(m: Model, wa: boolean): string {
  const { i } = m;
  const b = (s: string) => (wa ? `*${s}*` : s);
  const out: string[] = [];
  out.push(b(`${DIGEST_SUBJECT_NAME} · ${niceDate(i.date)}`));
  out.push(
    [
      m.asOf ? `Values as of ${niceDate(m.asOf)}` : '',
      m.late > 0 ? `${m.late} input${m.late === 1 ? '' : 's'} late` : '',
    ]
      .filter(Boolean)
      .join(' · ') || '',
  );
  out.push('');
  if (m.family) {
    // the four lines of money words v6, the same in the e-mail's text part, Telegram and WhatsApp
    const lines = familyLines(m.total, m.today, m.family);
    out.push(...lines.slice(0, -1));
    // the foreign part of the savings, small, after the kinds; the savings figure is still all the cash in rupees
    for (const c of m.classes)
      for (const f of c.foreign ?? [])
        out.push(
          `  ${FAMILY_KIND_LABEL.savings}, of it ${foreignShort(f)} at ₹${formatRate(f.rate)}${f.rateDate ? ` (${shortDay(f.rateDate)})` : ''}`,
        );
    out.push(lines[lines.length - 1]!);
  } else {
    const label = (s: string) => pad(s, 16);
    out.push(`${label(TERMS.netWorth.label)}${inr(m.total)}  (${inrExact(m.total)})`);
    if (m.today)
      out.push(
        `${label(m.todayLabel)}${Math.round(m.today.amount) === 0 ? 'no change yet' : `${signedInr(m.today.amount)}${m.today.pct !== null ? ` (${signedPct(m.today.pct)})` : ''}`}`,
      );
    else out.push('First report: nothing to compare with yet.');
    if (m.overall)
      out.push(
        `${label(TERMS.profit.label)}${signedInr(m.overall.profit)}${m.overall.profitPct !== null ? ` (${signedPct(m.overall.profitPct)} ${PERCENT_KIND.overall})` : ''} on ${inr(m.overall.invested)} invested`,
      );
    if (m.classes.length) {
      out.push('');
      for (const c of [...m.classes].sort(
        (a, b) => TILE_ORDER.indexOf(a.key) - TILE_ORDER.indexOf(b.key),
      )) {
        const bits: string[] = [];
        if (c.key !== 'others') bits.push(`today ${signedInr(c.today)}`);
        if ((c.key === 'fd' || c.key === 'funds') && c.invested > 0)
          bits.push(
            `${TERMS.profit.label.toLowerCase()} ${signedInr(c.profit)}${c.profitPct !== null ? ` (${signedPct(c.profitPct)})` : ''}`,
          );
        out.push(
          `${pad(TILE_SHORT[c.key]!, 14)}${padL(inr(c.current), 9)} ${padL(`${Math.round(c.share * 100)}%`, 4)}  ${bits.join(' · ')}`.trimEnd(),
        );
        // the foreign part of the cash, small, under the cash line; the figure above it is still all the cash in rupees
        for (const f of c.foreign ?? [])
          out.push(
            `${' '.repeat(14)}of it ${foreignShort(f)} at ₹${formatRate(f.rate)}${f.rateDate ? ` (${shortDay(f.rateDate)})` : ''}`,
          );
      }
    }
  }
  if (m.goals !== null) {
    out.push('');
    out.push(b('GOALS'));
    if (m.goals.length) for (const g of m.goals) out.push(goalText(g));
    else out.push('• No goals set yet (add one in Goals).');
  }
  if (m.retire) {
    out.push('');
    out.push(b('RETIREMENT'));
    out.push(`• ${m.retire.name}: ${m.retire.chip}`);
    out.push(`  ${m.retire.line}`);
  } else if (m.retireLine) {
    out.push('');
    out.push(`Retirement view: ${m.retireLine}. An estimate, not a guarantee.`);
  }
  out.push('');
  if (m.needs.length) {
    out.push(b(`NEEDS YOU (${m.needsTotal})`));
    for (const n of m.needs) out.push(`• ${n.text}`);
    if (m.needsTotal > m.needs.length) out.push(`• ... and ${m.needsTotal - m.needs.length} more`);
  } else out.push('NOTHING NEEDS YOUR ATTENTION TODAY');
  if (i.changes?.maturities.length) {
    out.push('');
    out.push(`Paying out in ${i.changes.maturityDays} days:`);
    for (const d of i.changes.maturities)
      out.push(`• ${d.name} ${dayMonth(d.on)}: ${inr(d.amount)}`);
  }
  if (i.monthly)
    out.push(
      '',
      `Month in review (since ${niceDate(i.monthly.since)}): ${signedInr(i.monthly.change)}${
        i.monthly.byPerson.length
          ? `; ${i.monthly.byPerson.map((p) => `${p.name} ${signedInr(p.change)}`).join(' · ')}`
          : ''
      }.`,
    );
  out.push('');
  out.push(m.data.bank);
  for (const line of m.data.rest.slice(0, -1)) out.push(line);
  out.push(`Open the portal: ${m.base}`);
  out.push('Estimates from your last recorded values, rates and NAVs; not a bank statement.');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Keeps a text within `limit` characters by dropping its tail lines, never part-way through a line. */
function fit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const lines = text.split('\n');
  const keepTail = 2;
  const tail = lines.slice(-keepTail);
  const head = lines.slice(0, -keepTail);
  while (head.length > 3 && [...head, '…', ...tail].join('\n').length > limit) head.pop();
  return [...head, '…', ...tail].join('\n');
}

export function buildDigestEmail(i: DigestInput): DigestEmail {
  const m = model(i);
  return {
    subject: m.subject,
    preheader: m.preheader,
    html: buildHtml(m),
    text: fit(buildText(m, false), DIGEST_TEXT_LIMIT),
    chat: fit(buildText(m, true), DIGEST_TEXT_LIMIT),
  };
}

/**
 * What a message must not contain to be safe to show and to send: script, event handlers, a file or image fetched from elsewhere.
 * Empty when the HTML is clean. The builder never writes any of these; this is the check the tests (and the preview) rely on.
 */
export function emailProblems(html: string): string[] {
  const found: string[] = [];
  if (/<script\b/i.test(html)) found.push('script');
  if (/<(img|iframe|object|embed|video|audio|source)\b/i.test(html))
    found.push('embedded resource');
  if (/<[^>]*\ssrc\s*=/i.test(html)) found.push('src');
  if (/url\(\s*['"]?(https?:)?\/\//i.test(html)) found.push('css url');
  if (/<link\b/i.test(html)) found.push('link element');
  if (/@import/i.test(html)) found.push('@import');
  if (/<[^>]*\son[a-z]+\s*=/i.test(html)) found.push('event handler');
  return found;
}
