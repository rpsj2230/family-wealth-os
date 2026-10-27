import { describe, expect, it } from 'vitest';
import { buildDigest, type DigestInput } from '../src/digest';
import { carryForward } from '../src/estimate';
import { aggregateNetWorth } from '../src/networth';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-10-26');
const nw = aggregateNetWorth([
  {
    assetId: 'a',
    ownerId: 'r',
    type: 'bank_account',
    status: 'active',
    name: 'A',
    estimate: carryForward({ amount: 5_000_000, asOf: d('2026-10-25'), today }),
  },
  {
    assetId: 'b',
    ownerId: 'g',
    type: 'mutual_fund',
    status: 'active',
    name: 'B',
    estimate: carryForward({ amount: 1_200_000, asOf: d('2026-10-25'), today }),
  },
]);

const base = (o: Partial<DigestInput> = {}): DigestInput => ({
  date: '2026-10-26',
  householdName: 'Our household',
  netWorth: nw,
  ownerNames: { r: 'Rupash', g: 'Ragini' },
  previous: { date: '2026-10-25', total: 6_150_000 },
  lastBankBalanceAsOf: '2026-10-25',
  attention: { maturedUnconfirmed: [], maturingSoon: [], overdueLoans: [], staleOrMissing: 0 },
  market: { navLatest: '2026-10-23', fx: { SGD: { rate: 74.263, date: '2026-10-23' } } },
  appUrl: 'https://example.test',
  ...o,
});

describe('rate ideas', () => {
  it('lists up to two better-rate ideas in the attention list', () => {
    const g = buildDigest(
      base({
        rateIdeas: ['Moving ₹5,00,000 earns ₹9,000 more a year.', 'Second idea.', 'Third idea.'],
      }),
    );
    expect(g.text).toContain('Better rate: Moving ₹5,00,000 earns ₹9,000 more a year.');
    expect(g.text).toContain('Better rate: Second idea.');
    expect(g.text).not.toContain('Third idea');
  });
});

describe('task reminders', () => {
  const t = (tasksDue: { title: string; dueOn: string }[]) =>
    base({
      attention: {
        maturedUnconfirmed: [],
        maturingSoon: [],
        overdueLoans: [],
        staleOrMissing: 0,
        tasksDue,
      },
    });
  it('lists tasks due within a week and overdue ones, and hides later ones', () => {
    const g = buildDigest(
      t([
        { title: '[Plan w1] Wave 1: sell 7 folios', dueOn: '2026-10-27' },
        { title: 'Old task', dueOn: '2026-10-20' },
        { title: 'Far away', dueOn: '2027-03-31' },
      ]),
    );
    expect(g.text).toContain('Due 27 Oct 2026 (in 1 day): Wave 1: sell 7 folios');
    expect(g.text).toContain('Overdue by 6 days: Old task');
    expect(g.text).not.toContain('Far away');
  });
});

describe('policy reminders', () => {
  const att = (policyDates: { insurer: string; kind: 'renewal' | 'ends'; on: string }[]) =>
    base({
      attention: {
        maturedUnconfirmed: [],
        maturingSoon: [],
        overdueLoans: [],
        staleOrMissing: 0,
        policyDates,
      },
    });

  it('mentions a renewal inside the window with the days left', () => {
    const g = buildDigest(att([{ insurer: 'Great Eastern', kind: 'renewal', on: '2026-11-15' }]));
    expect(g.text).toContain('Great Eastern renewal on 15 Nov 2026 (in 20 days)');
  });

  it('stays quiet about dates far away', () => {
    const g = buildDigest(att([{ insurer: 'HDFC Life', kind: 'ends', on: '2027-06-01' }]));
    expect(g.text).not.toContain('HDFC Life');
    expect(g.text).toContain('NOTHING NEEDS YOUR ATTENTION TODAY');
  });

  it('asks you to confirm when a date has passed', () => {
    const g = buildDigest(att([{ insurer: 'Niva Bupa', kind: 'renewal', on: '2026-10-20' }]));
    expect(g.text).toContain('Niva Bupa renewal date (20 Oct 2026) has passed');
  });
});

describe('buildDigest', () => {
  it('leads with the estimated net worth and the change since the previous snapshot, labelled as an estimate', () => {
    const g = buildDigest(base());
    expect(g.subject).toBe('₹62.00 L estimated (+₹50,000) · 26 Oct 2026');
    expect(g.text).toContain('Since 25 Oct 2026: +₹50,000');
    expect(g.text).toContain('not new savings');
    expect(g.text).toContain('By person: Rupash ₹50.00 L · Ragini ₹12.00 L');
  });

  it('says plainly when no new verified bank balance has arrived', () => {
    const stale = buildDigest(base({ lastBankBalanceAsOf: '2026-10-20' }));
    expect(stale.text).toContain('No new verified bank balance received.');
    expect(stale.text).toContain('dated 20 Oct 2026');
    expect(buildDigest(base({ lastBankBalanceAsOf: null })).text).toContain(
      'No new verified bank balance received.',
    );
    expect(buildDigest(base()).text).not.toContain('No new verified bank balance received.');
  });

  it('shows the date of every market input, and admits when there is no NAV data', () => {
    const g = buildDigest(base());
    expect(g.text).toContain('latest NAV, dated 23 Oct 2026');
    expect(g.text).toContain('SGD converted at ₹74.263 (rate dated 23 Oct 2026)');
    expect(buildDigest(base({ market: { navLatest: null, fx: {} } })).text).toContain(
      'carried forward from your last recorded values',
    );
  });

  it('lists what needs attention, and says so when nothing does', () => {
    const g = buildDigest(
      base({
        attention: {
          maturedUnconfirmed: ['RBL FD'],
          maturingSoon: [{ name: 'Yes Bank FD', daysLeft: 6, amount: 1_380_416 }],
          overdueLoans: [{ name: 'Somesh', outstanding: 200_000, daysOverdue: 114 }],
          staleOrMissing: 3,
        },
      }),
    );
    expect(g.text).toContain('NEEDS YOUR ATTENTION');
    expect(g.text).toContain('RBL FD has matured');
    expect(g.text).toContain('Yes Bank FD matures in 6 days (₹13,80,416)');
    expect(g.text).toContain('Somesh owes ₹2,00,000, 114 days overdue');
    expect(buildDigest(base()).text).toContain('NOTHING NEEDS YOUR ATTENTION TODAY');
  });

  it('handles the first report and negative changes', () => {
    expect(buildDigest(base({ previous: null })).text).toContain('first report');
    const down = buildDigest(base({ previous: { date: '2026-10-25', total: 6_500_000 } }));
    expect(down.subject).toContain('−₹3.00 L');
    expect(down.text).toContain('−₹3,00,000');
  });

  it('escapes anything that could break the HTML and keeps the WhatsApp text short and plain', () => {
    const g = buildDigest(
      base({
        householdName: 'A <b>&</b> B',
        attention: {
          maturedUnconfirmed: ['<script>x</script>'],
          maturingSoon: [],
          overdueLoans: [],
          staleOrMissing: 0,
        },
      }),
    );
    expect(g.html).not.toContain('<script>');
    expect(g.html).toContain('&lt;script&gt;');
    expect(g.html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B');
    expect(g.whatsapp.length).toBeLessThan(900);
    expect(g.whatsapp).not.toContain('<li');
  });

  it('includes the retirement line only when supplied, as an estimate', () => {
    expect(buildDigest(base()).text).not.toContain('Retirement view');
    const g = buildDigest(
      base({
        retirement: {
          statusText: 'projected shortfall under the selected assumptions',
          earliestAge: 62,
        },
      }),
    );
    expect(g.text).toContain('earliest age that meets the plan under your assumptions: 62');
    expect(g.text).toContain('not a guarantee');
  });
});

describe('tax lines and the monthly review', () => {
  it('lists tax ideas and shows how the month went on the first', () => {
    const g = buildDigest(
      base({
        taxIdeas: [
          'Tax harvest for Rupash: 100 days left.',
          'Tax refunds still to claim: about ₹30,000.',
        ],
        monthly: {
          since: '2026-09-30',
          change: 125_000,
          byPerson: [
            { name: 'Rupash', change: 100_000 },
            { name: 'Ragini', change: 25_000 },
          ],
        },
      }),
    );
    expect(g.text).toContain('Tax harvest for Rupash: 100 days left.');
    expect(g.text).toContain('Tax refunds still to claim');
    expect(g.text).toContain('Month in review');
    expect(g.text).toContain('Ragini');
    expect(g.whatsapp.length).toBeGreaterThan(0);
  });
  it('says nothing extra when there is nothing to say', () => {
    const g = buildDigest(base());
    expect(g.text).not.toContain('Month in review');
  });
});

describe('what the holdings earned', () => {
  const tile = (key: 'recent' | 'fy', amount: number, asked: string, clamped = false) => ({
    key,
    label: key === 'fy' ? 'This financial year' : 'Last 30 days',
    asked,
    from: clamped ? '2026-06-01' : asked,
    to: '2026-10-26',
    clamped,
    dataStarts: '2026-06-01',
    amount,
    pct: 0.01,
    base: 1,
    putIn: 0,
    takenOut: 0,
    estimated: true,
    empty: false,
    coverage: { withValue: 9, of: 10 },
    netWorth: { start: 1, end: 2, change: 1 },
    startFrom: {
      oldest: '2026-08-22',
      newest: '2026-08-22',
      onTheDay: 0,
      movedForward: 1,
      fromTerms: 0,
    },
  });
  const gains = {
    days: 30,
    recent: tile('recent', 41_000, '2026-09-26'),
    fy: tile('fy', 222_000, '2026-04-01', true),
  };

  it('replaces the change since the previous snapshot, in the e-mail, the subject and the WhatsApp text, with the same words as Home', () => {
    const g = buildDigest(base({ gains }));
    expect(g.text).toContain('Earned: last 30 days +₹41,000 (since 26 Sep 2026)');
    expect(g.text).toContain('this financial year +₹2,22,000 (data starts 1 Jun 2026)');
    expect(g.text).toContain('money added or taken out is not counted');
    expect(g.text).not.toContain('Since 25 Oct 2026');
    expect(g.whatsapp).toContain('+₹41,000 earned in 30 days');
    expect(g.subject).toMatch(/\(\+₹41,000 in 30 days\)/);
  });

  it('keeps the old line when the records could not be read', () => {
    const g = buildDigest(base({ gains: null }));
    expect(g.text).toContain('Since 25 Oct 2026');
  });
});
