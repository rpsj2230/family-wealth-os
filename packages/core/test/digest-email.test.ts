import { describe, expect, it } from 'vitest';
import type { DigestInput } from '../src/digest';
import { DIGEST_TEXT_LIMIT, buildDigestEmail, emailProblems } from '../src/digest-email';
import { goalCard, retirementCard, type DigestGoalCard } from '../src/digest-goals';
import type { DigestWealth } from '../src/digest-wealth';
import { carryForward } from '../src/estimate';
import { summariseGoals } from '../src/goal-summary';
import { classCards } from '../src/home';
import { aggregateNetWorth } from '../src/networth';
import { DEFAULT_SETTINGS, buildPlan } from '../src/planning';
import { assess } from '../src/retirement';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-10-27');
const part = (count: number, invested: number, current: number) => ({
  count,
  invested,
  current,
  maturity: current,
});

/** four kinds of holding that add up to the net worth, built by the same function Home uses */
function wealthOf(
  netWorth: number,
  o: Partial<Parameters<typeof classCards>[0]> = {},
): DigestWealth {
  const classes = classCards({
    netWorth,
    fd: part(2, 2_000_000, 2_300_000),
    fdToday: 1_200,
    awaiting: { count: 0, invested: 0, current: 0 },
    cash: part(3, 1_000_000, 1_000_000),
    cashToday: 300,
    othersHeld: part(0, 0, 0),
    funds: { count: 2, invested: 1_500_000, value: 1_900_000, today: 8_000, withoutStatement: 0 },
    earned: {},
    ...o,
  });
  const invested = classes.reduce((a, c) => a + c.invested, 0);
  const profit = classes.reduce((a, c) => a + c.profit, 0);
  const dayAmount = 1_200 + 300 + 8_000;
  return {
    total: netWorth,
    today: {
      amount: dayAmount,
      pct: dayAmount / (netWorth - dayAmount),
      banks: 1_500,
      funds: 8_000,
    },
    overall: {
      invested,
      profit,
      profitPct: invested > 0 ? profit / invested : null,
      estimated: false,
    },
    classes,
  };
}

const nw = aggregateNetWorth([
  {
    assetId: 'a',
    ownerId: 'r',
    type: 'bank_account',
    status: 'active',
    name: 'A',
    estimate: carryForward({ amount: 6_200_000, asOf: d('2026-10-25'), today }),
  },
]);

const goalsFor = (...g: Parameters<typeof summariseGoals>[0]['goals']) =>
  summariseGoals({
    goals: g,
    allocations: g.map((x) => ({
      goalId: x.id,
      assetId: 'a',
      method: 'percent' as const,
      value: 25,
    })),
    values: new Map([['a', 6_200_000]]),
    sips: new Map([['a', 40_000]]),
    today: '2026-10-27',
  });

const base = (o: Partial<DigestInput> = {}): DigestInput => ({
  date: '2026-10-27',
  householdName: 'Our household',
  netWorth: nw,
  ownerNames: { r: 'Rupash' },
  previous: { date: '2026-10-26', total: 6_150_000 },
  lastBankBalanceAsOf: '2026-10-26',
  attention: { maturedUnconfirmed: [], maturingSoon: [], overdueLoans: [], staleOrMissing: 0 },
  market: { navLatest: '2026-10-24', fx: {} },
  appUrl: 'https://wealth.example.test/',
  wealth: wealthOf(6_200_000),
  asOf: '2026-10-26',
  lateInputs: 2,
  goals: [],
  needsYou: [],
  ...o,
});

const strip = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

describe('the hero and the tiles', () => {
  const e = buildDigestEmail(base());
  const text = strip(e.html);

  it('leads with net worth, today and the overall profit, each with an arrow and a sign', () => {
    expect(e.html.indexOf('Net worth')).toBeLessThan(e.html.indexOf('Today'));
    expect(text).toContain('₹62.00 L');
    expect(text).toContain('₹62,00,000');
    expect(text).toMatch(/▲ \+₹9,500 \(\+0\.2%\)/);
    expect(text).toMatch(/Overall profit \/ loss ▲ \+₹[\d.]+ L \(\+\d+\.\d%\)/);
    expect(text).toContain('you put in');
  });

  it('shows the header, with the date, "values as of" and the late-input chip', () => {
    expect(text).toContain('Family wealth');
    expect(text).toContain('27 Oct 2026');
    expect(text).toContain('Values as of 26 Oct 2026');
    expect(text).toContain('2 inputs late');
    expect(strip(buildDigestEmail(base({ lateInputs: 1 })).html)).toContain('1 input late');
    expect(strip(buildDigestEmail(base({ lateInputs: 0 })).html)).toContain('All inputs current');
  });

  it('has a tile for FDs, savings, mutual funds and other, in that order, adding up to the total', () => {
    const labels = ['In FDs', 'In savings', 'In mutual funds', 'In other'];
    const at = labels.map((l) => text.indexOf(l.toUpperCase()) >= 0 || e.html.indexOf(l) >= 0);
    expect(at).toEqual([true, true, true, true]);
    const idx = labels.map((l) => e.html.indexOf(l));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    const w = base().wealth!;
    expect(w.classes.reduce((a, c) => a + c.current, 0)).toBeCloseTo(6_200_000, 2);
    expect(w.classes.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 10);
    // each tile's exact amount is in its title
    for (const c of w.classes)
      expect(e.html).toContain(
        `title="₹${new Intl.NumberFormat('en-IN').format(Math.round(c.current))}"`,
      );
  });

  it('shows the funds tile with today and the overall profit and per cent', () => {
    expect(text).toMatch(/In mutual funds ₹19\.00 L 31% of total/);
    expect(text).toMatch(/Today ▲ \+₹8,000/);
    expect(text).toMatch(/Overall \+₹4\.00 L \(\+26\.7%\)/);
  });

  it('draws a fall in red with a down arrow and a true minus sign', () => {
    const down = wealthOf(6_200_000, {
      funds: {
        count: 2,
        invested: 1_500_000,
        value: 1_300_000,
        today: -45_000,
        withoutStatement: 1,
      },
    });
    down.today = { amount: -45_000, pct: -0.0072, banks: 0, funds: -45_000 };
    down.overall = { invested: 4_500_000, profit: -200_000, profitPct: -0.044, estimated: true };
    const m = buildDigestEmail(base({ wealth: down }));
    const t = strip(m.html);
    expect(t).toMatch(/▼ −₹45,000 \(−0\.7%\)/);
    expect(t).toMatch(/▼ −₹2\.00 L \(−4\.4%\)/);
    expect(t).toContain('partly an estimate');
    expect(m.html).toMatch(/class="dn"[^>]*>▼/);
    expect(m.html).not.toContain('-₹');
    expect(m.text).toContain('−₹45,000');
  });

  it('copes with zero and with very large values', () => {
    const zero = wealthOf(0, {
      fd: part(0, 0, 0),
      cash: part(0, 0, 0),
      funds: null,
      fdToday: 0,
      cashToday: 0,
    });
    zero.today = { amount: 0, pct: null, banks: 0, funds: 0 };
    zero.overall = { invested: 0, profit: 0, profitPct: null, estimated: false };
    const z = buildDigestEmail(base({ wealth: zero, previous: null }));
    expect(strip(z.html)).toContain('₹0');
    expect(strip(z.html)).toContain('No change yet today');
    expect(z.html).not.toMatch(/NaN|Infinity|undefined/);
    expect(z.text).not.toMatch(/NaN|Infinity|undefined/);
    const big = wealthOf(98_765_432_100, {
      fd: part(1, 5e9, 6e9),
      cash: part(1, 1e9, 1e9),
      funds: { count: 1, invested: 2e10, value: 3e10, today: 1e8, withoutStatement: 0 },
    });
    const b = buildDigestEmail(base({ wealth: big }));
    expect(strip(b.html)).toMatch(/₹9,876\.54 Cr|₹987\.65 Cr/);
    expect(b.subject.length).toBeLessThanOrEqual(72);
  });
});

describe('goals', () => {
  const cards = (): DigestGoalCard[] =>
    goalsFor(
      {
        id: 'on',
        name: 'Education',
        kind: 'education',
        targetAmount: 1_900_000,
        targetDate: '2032-06-01',
        inflationRate: null,
      },
      {
        id: 'late',
        name: 'Second flat',
        kind: 'property',
        targetAmount: 2_500_000,
        targetDate: '2029-03-01',
        inflationRate: null,
      },
      {
        id: 'far',
        name: 'Emergency fund',
        kind: 'emergency',
        targetAmount: 100_000,
        targetDate: '2027-12-31',
        inflationRate: null,
      },
      {
        id: 'nodata',
        name: 'Holiday',
        kind: 'other',
        targetAmount: null,
        targetDate: null,
        inflationRate: null,
      },
    ).map((g) => goalCard(g, 0.1));

  it('shows one card per goal in each state, with the chip, the bar and the pace sentence', () => {
    const c = cards();
    expect(c.map((g) => g.state)).toEqual(['on_track', 'behind', 'ahead', 'no_data']);
    const e = buildDigestEmail(base({ goals: c }));
    const t = strip(e.html);
    expect(t).toContain('Goals');
    expect(t).toContain('Education');
    expect(t).toContain('On track');
    expect(t).toMatch(/Behind by ₹[\d.]+ (L|Cr) \(about [^)]+\)/);
    expect(t).toMatch(/Ahead by ₹/);
    expect(t).toContain('Not enough data: set a target amount and date.');
    expect(t).toMatch(
      /At the current pace you reach ₹[\d.,]+ (L|Cr)? ?by \d+ \w+ \d{4} against ₹[\d.,]+ (L|Cr)? ?needed: shortfall ₹/,
    );
    expect(t).toMatch(/To be on track add ₹[\d.,]+ (L|Cr)? ?a month/);
    expect(t).toMatch(/\d+% saved/);
    // the bar is table cells with percentage widths, and carries a text label
    expect(e.html).toMatch(/role="img" aria-label="\d+% saved/);
    expect(e.html).toMatch(/<td class="bar1" width="[\d.]+%"/);
    // goals link to the portal
    expect(e.html).toContain('href="https://wealth.example.test/goals"');
  });

  it('puts the same states in the plain text, one line per goal', () => {
    const e = buildDigestEmail(base({ goals: cards() }));
    const lines = e.text
      .split('\n')
      .filter((l) => l.startsWith('• ') && /Education|Second flat|Emergency|Holiday/.test(l));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('On track');
    expect(lines[1]).toMatch(/Behind by .* · add ₹[\d.,]+( L| Cr)?\/month/);
    expect(lines[3]).toContain('Not enough data');
  });

  it('says so for a household with no goals, and leaves the section out when the view is off', () => {
    const none = buildDigestEmail(base({ goals: [] }));
    expect(strip(none.html)).toContain('No goals set yet');
    expect(none.text).toContain('No goals set yet');
    const off = buildDigestEmail(base({ goals: null }));
    expect(strip(off.html)).not.toContain('are we on track');
    expect(off.text).not.toContain('GOALS');
  });
});

describe('retirement', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    primaryDob: '1980-03-15',
    spouseDob: '1982-06-01',
    monthlySpendingToday: 100_000,
    retireAtAge: 60,
  };
  const card = () => {
    const plan = buildPlan(
      settings,
      { cash: 2_000_000, equity: 3_000_000, locked: 0, excluded: [] },
      20_000,
      '2026-10-27',
    );
    return retirementCard({
      plan,
      assumptions: settings.assumptions,
      readiness: assess(plan, settings.assumptions),
      monteCarlo: { successRate: 0.62, runs: 2000 },
      earliestAge: 64,
      aheadMargin: 0.1,
    });
  };

  it('is a goal card of its own when the person saved retirement assumptions', () => {
    const c = card();
    const e = buildDigestEmail(base({ retirement: { statusText: 'x', earliestAge: 64, card: c } }));
    const t = strip(e.html);
    expect(t).toContain('Retirement at 60');
    expect(t).toMatch(/Corpus needed ₹[\d.,]+ (L|Cr)? ?in today’s money/);
    expect(t).toMatch(/years to go \(age 60\)/);
    expect(t).toContain('62% chance the money lasts');
    expect(t).toMatch(/Behind by ₹/);
    expect(t).toContain('shortfall');
    expect(t).toMatch(/save about ₹[\d.,]+ (L|Cr)? ?more a month/);
    expect(e.html).toContain('href="https://wealth.example.test/retire"');
    expect(e.text).toContain('RETIREMENT');
    expect(e.text).toMatch(/Retirement at 60: Behind by/);
  });

  it('is absent when there are no assumptions or the view is off', () => {
    const none = buildDigestEmail(base({ retirement: null }));
    expect(strip(none.html)).not.toContain('Retirement');
    expect(none.text).not.toContain('RETIREMENT');
    expect(buildDigestEmail(base()).text).not.toContain('Retirement');
  });

  it('still shows the older one-line view when only its words are supplied', () => {
    const e = buildDigestEmail(
      base({
        retirement: { statusText: 'projected shortfall under your assumptions', earliestAge: 62 },
      }),
    );
    expect(strip(e.html)).toContain('earliest age that meets the plan under your assumptions: 62');
  });
});

describe('needs you, what changed and the footer', () => {
  const needs = [
    {
      text: '2 matured deposits (₹5.00 L) to confirm: say where the money went.',
      href: '/deposits?tab=maturities',
      tone: 'bad' as const,
    },
    { text: '1 task due in the next 7 days.', href: '/tasks', tone: 'warn' as const },
    { text: 'Better rate: move ₹2 L.', href: '/rates', tone: 'info' as const },
  ];

  it('lists the items in the order given, each a link to its page, capped at the Settings number', () => {
    const e = buildDigestEmail(base({ needsYou: needs, limits: { needsYouMax: 2 } }));
    expect(e.html).toContain('href="https://wealth.example.test/deposits?tab=maturities"');
    expect(e.html).toContain('href="https://wealth.example.test/tasks"');
    expect(e.html).not.toContain('Better rate');
    expect(strip(e.html)).toContain('1 more on Home');
    expect(e.subject).toContain('3 need you');
    expect(e.text).toContain('NEEDS YOU (3)');
    expect(e.text).toContain('... and 1 more');
    expect(e.text.indexOf('matured deposits')).toBeLessThan(e.text.indexOf('task due'));
  });

  it('says nothing needs the person when that is so', () => {
    const e = buildDigestEmail(base());
    expect(strip(e.html)).toContain('Nothing needs you today.');
    expect(e.subject).not.toContain('need');
  });

  it('shows what moved and the biggest deposits paying out', () => {
    const e = buildDigestEmail(
      base({
        changes: {
          since: '2026-09-27',
          partial: false,
          kinds: [{ key: 'funds', label: 'Mutual funds', change: -120_000 }],
          people: [{ key: 'r', label: 'Rupash', change: 80_000 }],
          maturities: [
            { name: 'Yes Bank FD-1234', on: '2026-11-05', daysLeft: 9, amount: 1_380_416 },
          ],
          maturityDays: 30,
        },
      }),
    );
    const t = strip(e.html);
    expect(t).toContain('What changed');
    expect(t).toMatch(/Mutual funds ▼ −₹1\.20 L/);
    expect(t).toMatch(/Rupash ▲ \+₹80,000/);
    expect(t).toContain('Deposits paying out in the next 30 days');
    expect(t).toContain('Yes Bank FD-1234');
    expect(t).toContain('₹13.80 L');
    expect(e.text).toContain('Paying out in 30 days');
  });

  it('ends with the button, where the numbers come from and where to change who gets it', () => {
    const t = strip(buildDigestEmail(base()).html);
    expect(t).toContain('Open the portal');
    expect(t).toContain('Where the numbers come from.');
    expect(t).toContain('not a bank statement');
    expect(t).toContain('Settings &gt; Notifications');
    const e = buildDigestEmail(base());
    expect(e.html).toContain('href="https://wealth.example.test"');
    expect(e.html).toContain('href="https://wealth.example.test/settings?tab=notifications"');
  });

  it('adds the month in review on the first of a month', () => {
    const e = buildDigestEmail(
      base({
        monthly: {
          since: '2026-09-30',
          change: 125_000,
          byPerson: [{ name: 'Rupash', change: 125_000 }],
        },
      }),
    );
    expect(strip(e.html)).toContain('Month in review');
    expect(e.text).toContain('Month in review');
  });
});

describe('safety of the HTML and the text', () => {
  const full = (): DigestInput =>
    base({
      goals: goalsFor({
        id: 'g',
        name: '<b>Flat</b> & "more"',
        kind: 'property',
        targetAmount: 5_000_000,
        targetDate: '2030-01-01',
        inflationRate: null,
      }).map((g) => goalCard(g, 0.1)),
      needsYou: [{ text: '<script>alert(1)</script> owes ₹1', href: '/others', tone: 'bad' }],
      householdName: 'A <i>&</i> B',
    });

  it('contains no script, no remote file and no image, and escapes what it is given', () => {
    const e = buildDigestEmail(full());
    expect(emailProblems(e.html)).toEqual([]);
    expect(e.html).not.toMatch(/<script/i);
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('&lt;b&gt;Flat&lt;/b&gt; &amp; &quot;more&quot;');
    expect(e.html).toContain('A &lt;i&gt;&amp;&lt;/i&gt; B');
    // only anchors reach outside: every URL is a link to the portal
    const urls = [...e.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]!);
    expect(urls.every((u) => u.startsWith('https://wealth.example.test'))).toBe(true);
  });

  it('is a 600 px table layout with dark-mode metadata, a preheader and system fonts', () => {
    const e = buildDigestEmail(full());
    expect(e.html).toContain('max-width:600px');
    expect(e.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(e.html).toContain('prefers-color-scheme: dark');
    expect(e.html).toMatch(
      /display:none;max-height:0;overflow:hidden[^>]*>Net worth ₹62\.00 L, up ₹9,500 today/,
    );
    expect(e.html).toContain('-apple-system');
    expect(e.html).not.toMatch(/#fff(fff)?\b|background:\s*white|#000(000)?\b/i);
    expect(e.html).not.toMatch(/<(img|iframe|video)/i);
  });

  it('never prints a whole account or PAN number', () => {
    const e = buildDigestEmail(
      base({
        attention: {
          maturedUnconfirmed: ['HDFC FD-1234'],
          maturingSoon: [],
          overdueLoans: [],
          staleOrMissing: 0,
        },
      }),
    );
    expect(`${e.html}${e.text}`).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b|\b\d{9,}\b/);
  });

  it('keeps the plain text within the Telegram limit however long the lists are', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      text: `Item ${i}: ${'a very long sentence about something that needs doing '.repeat(4)}`,
      href: '/tasks',
      tone: 'warn' as const,
    }));
    const goals = Array.from({ length: 60 }, (_, i) =>
      goalCard(
        goalsFor({
          id: `g${i}`,
          name: `Goal number ${i} with a quite long name indeed`,
          kind: 'other',
          targetAmount: 900_000,
          targetDate: '2031-01-01',
          inflationRate: null,
        })[0]!,
        0.1,
      ),
    );
    const e = buildDigestEmail(base({ needsYou: many, goals, limits: { needsYouMax: 80 } }));
    expect(e.text.length).toBeLessThanOrEqual(DIGEST_TEXT_LIMIT);
    expect(e.text.length).toBeLessThan(4000);
    expect(e.chat.length).toBeLessThanOrEqual(DIGEST_TEXT_LIMIT);
    // it ends with the link and the note, not in the middle of a line
    expect(e.text.trim().endsWith('not a bank statement.')).toBe(true);
  });

  it('carries the key numbers in the plain text, in an aligned compact format', () => {
    const w = base({
      goals: goalsFor({
        id: 'g',
        name: 'Education',
        kind: 'education',
        targetAmount: 1_000_000,
        targetDate: '2032-06-01',
        inflationRate: null,
      }).map((g) => goalCard(g, 0.1)),
    });
    const e = buildDigestEmail(w);
    expect(e.text.split('\n')[0]).toBe('Family Wealth Summary · 27 Oct 2026');
    expect(e.text).toMatch(/Net worth {3}₹62\.00 L {2}\(₹62,00,000\)/);
    expect(e.text).toMatch(/Today {7}\+₹9,500 \(\+0\.2%\)/);
    expect(e.text).toMatch(/Overall {5}\+₹[\d.]+ L \(\+[\d.]+%\) on ₹[\d.]+ L put in/);
    expect(e.text).toMatch(/FDs +₹23\.00 L +37%/);
    expect(e.text).toMatch(/Savings +₹10\.00 L +16%/);
    expect(e.text).toMatch(/Mutual funds +₹19\.00 L +31%/);
    expect(e.text).toContain('GOALS');
    expect(e.chat.split('\n')[0]).toBe('*Family Wealth Summary · 27 Oct 2026*');
  });

  it('gives the plain-text part for every HTML part (the figures are all in it)', () => {
    const e = buildDigestEmail(full());
    for (const needle of ['₹62.00 L', 'Today', 'Overall', 'GOALS', 'NEEDS YOU', 'Open the portal'])
      expect(e.text).toContain(needle);
  });
});

describe('foreign cash under the savings tile', () => {
  const sgd = {
    currency: 'SGD',
    native: 41_250,
    inr: 2_314_125,
    rate: 56.1,
    accounts: 1,
    asOf: '2026-10-12',
    rateDate: '2026-10-27',
    rateLive: true,
  };
  const withSgd = base({ wealth: wealthOf(6_200_000, { cashForeign: [sgd] }) });
  const e = buildDigestEmail(withSgd);

  it('keeps the savings figure and adds the S$ balance with the rupee value in small type', () => {
    const text = strip(e.html);
    expect(text).toContain('₹10.00 L');
    expect(text).toContain('S$ 41,250');
    expect(text).toContain('≈ ₹23.14 L at ₹56.1 (27 Oct)');
    expect(emailProblems(e.html)).toEqual([]);
  });

  it('adds one small line to the text and the chat message under the savings line', () => {
    for (const t of [e.text, e.chat]) {
      const lines = t.split('\n');
      const at = lines.findIndex((l) => l.startsWith('Savings'));
      expect(lines[at]).toContain('₹10.00 L');
      expect(lines[at + 1]).toContain('of it S$ 41,250 ≈ ₹23.14 L at ₹56.1 (27 Oct)');
    }
  });

  it('shows nothing extra when all cash is in rupees', () => {
    const plain = buildDigestEmail(base());
    expect(plain.text).not.toContain('of it');
    expect(strip(plain.html)).not.toContain('S$');
  });

  it('writes one line per currency and stays within the message limit', () => {
    const usd = { ...sgd, currency: 'USD', native: 2_000, inr: 168_400, rate: 84.2 };
    const two = buildDigestEmail(
      base({ wealth: wealthOf(6_200_000, { cashForeign: [sgd, usd] }) }),
    );
    expect(two.text.match(/of it /g)?.length).toBe(2);
    expect(two.text).toContain('US$ 2,000');
    expect(two.text.length).toBeLessThanOrEqual(DIGEST_TEXT_LIMIT);
    expect(two.chat.length).toBeLessThanOrEqual(DIGEST_TEXT_LIMIT);
  });
});
