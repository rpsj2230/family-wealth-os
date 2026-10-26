/**
 * Daily summary text for email and WhatsApp. Pure: it formats numbers it is given and never claims delivery.
 * Rules from the brief: say plainly when no new verified bank balance has arrived, show the date of every market input,
 * and never present an estimate as a verified balance.
 */
import { DEFAULT_CONFIG } from './config';
import { formatInr, formatInrCompact } from './money';
import type { NetWorthResult } from './networth';

export interface DigestInput {
  date: string; // YYYY-MM-DD, Asia/Singapore date of the report
  householdName: string;
  netWorth: NetWorthResult;
  ownerNames: Record<string, string>;
  previous: { date: string; total: number } | null;
  /** newest as-of date among bank balance records (any source) */
  lastBankBalanceAsOf: string | null;
  attention: {
    maturedUnconfirmed: string[];
    maturingSoon: { name: string; daysLeft: number; amount: number }[];
    overdueLoans: { name: string; outstanding: number; daysOverdue: number }[];
    staleOrMissing: number;
    /** upcoming or missed policy dates; the digest keeps only those inside the reminder window */
    policyDates?: { insurer: string; kind: 'renewal' | 'ends'; on: string }[];
    /** open tasks with a due date; the digest keeps overdue ones and those due within a week */
    tasksDue?: { title: string; dueOn: string }[];
  };
  market: { navLatest: string | null; fx: Record<string, { rate: number; date: string }> };
  retirement?: { statusText: string; earliestAge: number | null } | null;
  appUrl: string;
  /** how far ahead policy dates and tasks appear; from Settings (reminders) */
  reminders?: { policyDays: number; taskDays: number };
  /** better interest rates found elsewhere, already worded; from the rate comparison */
  rateIdeas?: string[];
}

export interface Digest {
  subject: string;
  text: string;
  html: string;
  whatsapp: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatInr(Math.abs(n))}`;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const niceDate = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function buildDigest(i: DigestInput): Digest {
  const nw = i.netWorth;
  const lines: string[] = [];
  const bullets: string[] = [];

  const change = i.previous ? nw.total - i.previous.total : null;
  const headline = `${i.householdName}: ${formatInrCompact(nw.total)} estimated net worth`;
  lines.push(`${headline} on ${niceDate(i.date)}.`);
  if (change !== null && i.previous) {
    lines.push(
      `Since ${niceDate(i.previous.date)}: ${signed(change)}. This is mostly interest accruing and market movement, not new savings. It is an estimate.`,
    );
  } else {
    lines.push('This is the first report, so there is nothing to compare with yet.');
  }
  const people = Object.entries(nw.byOwner)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `${i.ownerNames[id] ?? 'Unknown'} ${formatInrCompact(v)}`);
  if (people.length) lines.push(`By person: ${people.join(' · ')}.`);
  lines.push(
    `Liquid ${formatInrCompact(nw.byLiquidity.liquid)} · Investments ${formatInrCompact(nw.byLiquidity.investable)} · Retirement accounts ${formatInrCompact(nw.byLiquidity.retirement)} · Illiquid ${formatInrCompact(nw.byLiquidity.illiquid)}.`,
  );

  // data freshness
  const fresh: string[] = [];
  if (!i.lastBankBalanceAsOf || daysBetween(i.lastBankBalanceAsOf, i.date) > 2) {
    fresh.push(
      `No new verified bank balance received.${i.lastBankBalanceAsOf ? ` The latest bank balance on record is dated ${niceDate(i.lastBankBalanceAsOf)}.` : ''}`,
    );
  } else {
    fresh.push(`Latest bank balance on record is dated ${niceDate(i.lastBankBalanceAsOf)}.`);
  }
  fresh.push(
    i.market.navLatest
      ? `Fund values use the latest NAV, dated ${niceDate(i.market.navLatest)}.`
      : 'Fund values are carried forward from your last recorded values (no NAV data yet).',
  );
  for (const [cur, v] of Object.entries(i.market.fx))
    fresh.push(`${cur} converted at ₹${v.rate.toFixed(3)} (rate dated ${niceDate(v.date)}).`);
  const e = nw.estimateTotals;
  fresh.push(
    `Of the total, ${formatInrCompact(e.byBasis.calculated)} is calculated from contracts or units, ${formatInrCompact(e.byBasis.estimated)} is estimated and ${formatInrCompact(e.byBasis.carried_forward)} is carried forward from your last entry.`,
  );

  // things to act on
  const a = i.attention;
  for (const m of a.maturedUnconfirmed.slice(0, 5))
    bullets.push(`${m} has matured; confirm where the money went (not counted until you do).`);
  for (const m of a.maturingSoon.slice(0, 5))
    bullets.push(
      `${m.name} matures in ${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'} (${formatInr(m.amount)}).`,
    );
  for (const l of a.overdueLoans.slice(0, 5))
    bullets.push(`${l.name} owes ${formatInr(l.outstanding)}, ${l.daysOverdue} days overdue.`);
  const taskReminders = (a.tasksDue ?? [])
    .map((t) => ({ ...t, daysLeft: daysBetween(i.date, t.dueOn) }))
    .filter((t) => t.daysLeft <= (i.reminders?.taskDays ?? DEFAULT_CONFIG.reminders.taskDays))
    .sort((x, y) => x.daysLeft - y.daysLeft);
  for (const t of taskReminders.slice(0, 5)) {
    const title = t.title.replace(/^\[Plan [\w-]+\]\s*/, '').slice(0, 140);
    bullets.push(
      t.daysLeft < 0
        ? `Overdue by ${-t.daysLeft} day${t.daysLeft === -1 ? '' : 's'}: ${title}`
        : t.daysLeft === 0
          ? `Due today: ${title}`
          : `Due ${niceDate(t.dueOn)} (in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}): ${title}`,
    );
  }
  for (const idea of (i.rateIdeas ?? []).slice(0, 2)) bullets.push(`Better rate: ${idea}`);
  const policyReminders = (a.policyDates ?? [])
    .map((p) => ({ ...p, daysLeft: daysBetween(i.date, p.on) }))
    .filter((p) => p.daysLeft <= (i.reminders?.policyDays ?? DEFAULT_CONFIG.reminders.policyDays))
    .sort((x, y) => x.daysLeft - y.daysLeft);
  for (const p of policyReminders.slice(0, 5)) {
    const what = p.kind === 'renewal' ? 'renewal' : 'cover ends';
    bullets.push(
      p.daysLeft < 0
        ? `${p.insurer} ${what} date (${niceDate(p.on)}) has passed; confirm it was renewed and update the date.`
        : `${p.insurer} ${what} on ${niceDate(p.on)} (${p.daysLeft === 0 ? 'today' : `in ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}`}).`,
    );
  }
  if (a.staleOrMissing > 0)
    bullets.push(
      `${a.staleOrMissing} records are stale or have no value; update them in Monthly update.`,
    );
  if (nw.excluded.some((x) => x.reason === 'no_valuation'))
    bullets.push('Some assets have no recorded value and are not counted.');

  const ret = i.retirement
    ? `Retirement view: ${i.retirement.statusText}${i.retirement.earliestAge !== null ? `; earliest age that meets the plan under your assumptions: ${i.retirement.earliestAge}` : ''}. An estimate, not a guarantee.`
    : null;

  const text = [
    lines.join('\n'),
    '',
    'DATA',
    ...fresh.map((f) => `• ${f}`),
    '',
    bullets.length ? 'NEEDS YOUR ATTENTION' : 'NOTHING NEEDS YOUR ATTENTION TODAY',
    ...bullets.map((b) => `• ${b}`),
    ...(ret ? ['', ret] : []),
    '',
    `Open the app: ${i.appUrl}`,
    'Figures are estimates built from your last recorded values, interest rates, NAVs and exchange rates. This message is not a bank statement.',
  ].join('\n');

  const li = (arr: string[]) =>
    arr.length
      ? `<ul style="padding-left:18px;margin:6px 0">${arr.map((x) => `<li style="margin:4px 0">${esc(x)}</li>`).join('')}</ul>`
      : '';
  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:20px;line-height:1.5">
<p style="margin:0 0 4px;color:#5f6368;font-size:13px">${esc(niceDate(i.date))}</p>
<p style="margin:0;font-size:28px;font-weight:700">${esc(formatInrCompact(nw.total))}</p>
<p style="margin:2px 0 12px;color:#5f6368;font-size:13px">${esc(i.householdName)} · estimated net worth · ${esc(formatInr(nw.total))}</p>
${lines
  .slice(1)
  .map((l) => `<p style="margin:6px 0">${esc(l)}</p>`)
  .join('')}
<h3 style="font-size:14px;margin:16px 0 4px">Data</h3>${li(fresh)}
<h3 style="font-size:14px;margin:16px 0 4px">${bullets.length ? 'Needs your attention' : 'Nothing needs your attention today'}</h3>${li(bullets)}
${ret ? `<p style="margin:12px 0">${esc(ret)}</p>` : ''}
<p style="margin:16px 0"><a href="${esc(i.appUrl)}" style="background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the app</a></p>
<p style="color:#5f6368;font-size:12px">Figures are estimates built from your last recorded values, interest rates, NAVs and exchange rates. This message is not a bank statement.</p>
</div></body></html>`;

  const wa = [
    `*${i.householdName}* ${niceDate(i.date)}`,
    `Net worth (estimate): ${formatInrCompact(nw.total)}${change !== null ? ` (${signed(change)} since ${niceDate(i.previous!.date)})` : ''}`,
    people.join(' | '),
    fresh[0]!,
    ...bullets.slice(0, 3).map((b) => `• ${b}`),
    i.appUrl,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject: `${formatInrCompact(nw.total)} estimated${change !== null ? ` (${change < 0 ? '−' : '+'}${formatInrCompact(Math.abs(change))})` : ''} · ${niceDate(i.date)}`,
    text,
    html,
    whatsapp: wa,
  };
}
