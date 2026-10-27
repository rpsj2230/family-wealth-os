import { describe, expect, it } from 'vitest';
import type { BoardOffer, RateEventRow } from '../src/rate-board';
import {
  buildBoardCards,
  eventLine,
  moveText,
  originsOf,
  pageDifferences,
  pendingCorrections,
  parseSort,
  parseView,
  reasonLabel,
  slabLadder,
  slabShort,
  slotText,
  sourceStatus,
  withRunAge,
  type RateSourceRow,
} from '../src/rate-view';

const offer = (o: Partial<BoardOffer>): BoardOffer => ({
  id: 'x',
  bank: 'Jana Bank',
  product: 'fd',
  accountKind: 'NRE',
  tenureFrom: 24,
  tenureTo: 24,
  rate: 0.08,
  conditions: null,
  sourceKind: 'ai',
  checkedOn: '2026-10-20',
  ...o,
});
const sav = (o: Partial<BoardOffer>) =>
  offer({ product: 'savings', accountKind: 'any', tenureFrom: 0, tenureTo: 0, ...o });
const ev = (o: Partial<RateEventRow>): RateEventRow => ({
  at: '2026-10-01T10:00:00Z',
  bank: 'Jana Bank',
  product: 'fd',
  accountKind: 'NRE',
  tenureFrom: 24,
  tenureTo: 24,
  balanceFrom: null,
  balanceTo: null,
  kind: 'added',
  oldRate: null,
  newRate: 0.08,
  source: 'ai',
  reason: null,
  ...o,
});
const src = (o: Partial<RateSourceRow>): RateSourceRow => ({
  bank: 'Jana Bank',
  url: 'https://example.invalid/rates',
  enabled: true,
  lastRunOn: '2026-10-20',
  lastResult: null,
  ...o,
});

describe('slabLadder', () => {
  it('orders slabs by balance and scales bars against the shared maximum', () => {
    const l = slabLadder(
      [
        { rate: 0.07, balanceFrom: 5_000_000, balanceTo: null },
        { rate: 0.025, balanceFrom: null, balanceTo: 100_000 },
      ],
      0.08,
    );
    expect(l.map((s) => s.label)).toEqual(['up to ₹1 L', 'above ₹50 L']);
    expect(l[1]!.heightPct).toBe(88);
    expect(l[1]!.best).toBe(true);
    expect(l[0]!.best).toBe(false);
  });
  it('is empty when there are no slabs and never draws an invisible bar', () => {
    expect(slabLadder([])).toEqual([]);
    expect(
      slabLadder([{ rate: 0.001, balanceFrom: null, balanceTo: null }], 0.09)[0]!.heightPct,
    ).toBe(10);
  });
});

describe('slabShort', () => {
  it('writes a slab in a few characters', () => {
    expect(slabShort({ balanceFrom: null, balanceTo: 100_000 })).toBe('≤1L');
    expect(slabShort({ balanceFrom: 100_000, balanceTo: 500_000 })).toBe('1L–5L');
    expect(slabShort({ balanceFrom: 5_000_000, balanceTo: null })).toBe('>50L');
    expect(slabShort({ balanceFrom: 10_000_000, balanceTo: null })).toBe('>1Cr');
    expect(slabShort({ balanceFrom: 0, balanceTo: null })).toBe('any');
  });
});

describe('sourceStatus', () => {
  const t = '2026-10-26';
  it('explains a bank with no rate page and where to add one', () => {
    const s = sourceStatus(null, t);
    expect(s.health).toBe('idle');
    expect(s.fix?.href).toBe('/settings#rates');
  });
  it('says a missing AI key is the reason and points to the setting', () => {
    const s = sourceStatus(
      src({ lastResult: 'Not read: no AI key is switched on. Add a free key.' }),
      t,
    );
    expect(s.health).toBe('bad');
    expect(s.fix?.href).toBe('/settings#email');
  });
  it('tells a refused page (403) from a missing page (404)', () => {
    const refused = sourceStatus(src({ lastResult: 'could not refresh: page answered 403' }), t);
    expect(refused.headline).toMatch(/refused/);
    expect(refused.fix?.text).toMatch(/paste/);
    const gone = sourceStatus(src({ lastResult: 'could not refresh: page answered 404' }), t);
    expect(gone.headline).toMatch(/not found/);
    expect(gone.fix?.href).toBe('/settings#rates');
  });
  it('tells a script-built page and an empty answer apart', () => {
    expect(
      sourceStatus(
        src({
          lastResult:
            'could not refresh: the page had almost no readable text (it may need a browser to load)',
        }),
        t,
      ).headline,
    ).toMatch(/script/);
    expect(
      sourceStatus(
        src({ lastResult: 'could not refresh: no rates could be read from the page' }),
        t,
      ).headline,
    ).toMatch(/no savings or NRE/);
  });
  it('separates AI trouble from page trouble', () => {
    expect(
      sourceStatus(src({ lastResult: 'could not refresh: AI service answered 401' }), t).fix?.href,
    ).toBe('/settings#email');
    expect(
      sourceStatus(src({ lastResult: 'could not refresh: AI service answered 429' }), t).health,
    ).toBe('warn');
  });
  it('reads the answer of several AI keys', () => {
    const refused = sourceStatus(
      src({
        lastResult:
          'could not refresh: AI service: Anthropic answered 401 (the key was refused); Groq answered 402 (no credit left)',
      }),
      t,
    );
    expect(refused.headline).toBe('The AI service refused every saved key.');
    expect(refused.fix?.href).toBe('/settings#email');
    expect(
      sourceStatus(
        src({
          lastResult:
            'could not refresh: AI service: Groq answered 429 (busy, or its limit is used up for now); Gemini answered 429 (busy, or its limit is used up for now)',
        }),
        t,
      ).health,
    ).toBe('warn');
    expect(
      sourceStatus(
        src({
          lastResult:
            'could not refresh: AI service: Anthropic answered 401 (the key was refused); Groq answered 429 (busy)',
        }),
        t,
      ).headline,
    ).toBe('The AI service could not answer (401, 429).');
  });
  it('says a read that needed the next AI key was still a read', () => {
    const s = sourceStatus(
      src({
        lastResult:
          'read 12 rates: 0 new, 0 changed, 12 unchanged; read by Groq after Anthropic answered 401 (the key was refused)',
      }),
      t,
    );
    expect(s.health).toBe('ok');
  });
  it('treats a clean read as ok and a read with differences as needing a look', () => {
    expect(
      sourceStatus(src({ lastResult: 'read 12 rates: 0 new, 1 changed, 11 unchanged' }), t).health,
    ).toBe('ok');
    const w = sourceStatus(
      src({
        lastResult:
          'read 12 rates: 0 new, 0 changed, 12 unchanged; 2 typed rates differ from the page',
      }),
      t,
    );
    expect(w.health).toBe('warn');
    expect(w.fix?.text).toMatch(/page says|accept/i);
  });
  it('shows a rate page that has never been read, and one that is switched off', () => {
    expect(sourceStatus(src({ lastResult: null, lastRunOn: null }), t).headline).toMatch(
      /not read yet/,
    );
    expect(sourceStatus(src({ enabled: false }), t).headline).toMatch(/switched off/);
  });
  it('warns when a good read is old, because the Monday job may have stopped', () => {
    const ok = sourceStatus(
      src({ lastResult: 'read 5 rates: 0 new, 0 changed, 5 unchanged', lastRunOn: '2026-09-01' }),
      t,
    );
    const w = withRunAge(ok, t);
    expect(w.health).toBe('warn');
    expect(w.headline).toMatch(/55 days ago/);
    expect(withRunAge(ok, '2026-09-05').health).toBe('ok');
  });
});

describe('buildBoardCards', () => {
  const offers = [
    offer({ id: 'a', rate: 0.08, checkedOn: '2026-10-25' }),
    sav({ id: 's1', rate: 0.025, balanceTo: 100_000 }),
    sav({ id: 's2', rate: 0.07, balanceFrom: 5_000_000, checkedOn: '2026-10-10' }),
    offer({ id: 'b', bank: 'Yes Bank', rate: 0.0725, checkedOn: '2026-09-01' }),
    sav({ id: 'c', bank: 'Equitas Bank', rate: 0.065, balanceFrom: 1_000_000 }),
    offer({ id: 'n', bank: 'Jana Bank', accountKind: 'NRO', rate: 0.09 }),
  ];
  const args = {
    offers,
    events: [ev({ kind: 'changed', oldRate: 0.0775, newRate: 0.08, at: '2026-10-10T00:00:00Z' })],
    holdings: [
      { bank: 'Jana Small Finance Bank', current: 500_000, needsConfirmation: false },
      { bank: 'Yes Bank', current: 100_000, needsConfirmation: false },
      { bank: 'Jana Small Finance Bank', current: 50_000, needsConfirmation: true },
    ],
    sources: [
      src({ lastResult: 'read 3 rates: 0 new, 0 changed, 3 unchanged', lastRunOn: '2026-10-25' }),
    ],
    today: '2026-10-26',
    staleDays: 30,
    view: 'held' as const,
    sort: 'fd' as const,
  };
  it('shows only the banks you use by default and counts holdings that are confirmed', () => {
    const c = buildBoardCards(args);
    expect(c.map((x) => x.bank)).toEqual(['Jana Small Finance Bank', 'Yes Bank']);
    expect(c[0]!.held).toBe(500_000);
    expect(c[0]!.holds).toBe(true);
  });
  it('lists every bank with a rate on file in the all view', () => {
    const c = buildBoardCards({ ...args, view: 'all' });
    expect(c.map((x) => x.bank).sort()).toEqual([
      'Equitas Bank',
      'Jana Small Finance Bank',
      'Yes Bank',
    ]);
    expect(c.find((x) => x.bank === 'Equitas Bank')!.holds).toBe(false);
  });
  it('ignores NRO deposits for the best NRE rate and finds the last move', () => {
    const jana = buildBoardCards(args)[0]!;
    expect(jana.bestFd!.rate).toBe(0.08);
    expect(jana.bestSaving!.rate).toBe(0.07);
    expect(jana.lastMove).toMatchObject({ from: 0.0775, to: 0.08 });
    expect(jana.ladder).toHaveLength(2);
    expect(jana.source.health).toBe('ok');
  });
  it('sorts by highest savings, by name and by oldest check', () => {
    const all = { ...args, view: 'all' as const };
    expect(buildBoardCards({ ...all, sort: 'saving' }).map((x) => x.bank)).toEqual([
      'Jana Small Finance Bank',
      'Equitas Bank',
      'Yes Bank',
    ]);
    expect(buildBoardCards({ ...all, sort: 'name' }).map((x) => x.bank)).toEqual([
      'Equitas Bank',
      'Jana Small Finance Bank',
      'Yes Bank',
    ]);
    // Yes Bank was checked on 1 Sep, the oldest
    expect(buildBoardCards({ ...all, sort: 'old' })[0]!.bank).toBe('Yes Bank');
  });
  it('marks a bank stale after the configured number of days', () => {
    const c = buildBoardCards({ ...args, staleDays: 30 });
    expect(c.find((x) => x.bank === 'Yes Bank')!.stale).toBe(true);
    expect(c.find((x) => x.bank !== 'Yes Bank')!.stale).toBe(false);
  });
  it('reads sort and view from the address, with safe defaults', () => {
    expect(parseSort('saving')).toBe('saving');
    expect(parseSort('nonsense')).toBe('fd');
    expect(parseSort(undefined)).toBe('fd');
    expect(parseView('all')).toBe('all');
    expect(parseView('x')).toBe('held');
  });
});

describe('where a rate came from', () => {
  it('groups rates by note and page, newest first, with counts', () => {
    const o = originsOf([
      offer({
        id: '1',
        sourceKind: 'ai',
        sourceNote: 'Read from janabank.com',
        sourceUrl: 'https://janabank.com/r',
        checkedOn: '2026-10-21',
      }),
      offer({
        id: '2',
        sourceKind: 'ai',
        sourceNote: 'Read from janabank.com',
        sourceUrl: 'https://janabank.com/r',
        checkedOn: '2026-10-22',
      }),
      offer({ id: '3', sourceKind: 'manual', sourceNote: 'Pasted notes', checkedOn: '2026-10-25' }),
      offer({ id: '4', sourceKind: 'manual', sourceNote: null, checkedOn: '2026-10-01' }),
    ]);
    expect(o.map((x) => [x.note, x.count, x.on])).toEqual([
      ['Pasted notes', 1, '2026-10-25'],
      ['Read from janabank.com', 2, '2026-10-22'],
      ['Typed by you', 1, '2026-10-01'],
    ]);
  });
});

describe('the change log and corrections', () => {
  it('describes a correction with who and why, and an addition without', () => {
    const c = eventLine(
      ev({
        kind: 'corrected',
        oldRate: 0.0825,
        newRate: 0.0775,
        source: 'manual',
        reason: 'senior_citizen',
      }),
    );
    expect(c).toMatchObject({
      action: 'Corrected by you',
      dir: 'down',
      who: 'You',
      why: 'It was the senior-citizen rate',
    });
    expect(c.what).toBe('NRE deposit, 2 yr');
    const a = eventLine(ev({ kind: 'added' }));
    expect(a).toMatchObject({ dir: 'new', who: 'Weekly refresh', why: null });
    expect(eventLine(ev({ kind: 'removed', newRate: null, oldRate: 0.08 })).dir).toBe('gone');
  });
  it('describes savings slabs', () => {
    expect(
      slotText({
        product: 'savings',
        accountKind: 'any',
        tenureFrom: 0,
        tenureTo: 0,
        balanceFrom: 500_000,
        balanceTo: 1_000_000,
      }),
    ).toBe('Savings, ₹5 L to ₹10 L');
  });
  it('words the last move as up, down or unchanged', () => {
    expect(moveText({ from: 0.075, to: 0.08, at: '2026-10-10T00:00:00Z' })).toMatchObject({
      dir: 'up',
    });
    expect(moveText({ from: 0.08, to: 0.0775, at: '2026-10-10T00:00:00Z' })!.text).toBe(
      'down 0.25 pts on 10 Oct 2026 (8.00% to 7.75%)',
    );
    expect(moveText(null)).toBeNull();
  });
  it('lists what the page disagrees on and corrections waiting for the next refresh', () => {
    const rows = [
      offer({ id: 'a', sourceKind: 'manual', pageRate: 0.085, pageSeenOn: '2026-10-21' }),
      offer({
        id: 'b',
        sourceKind: 'manual',
        aiRate: 0.0825,
        rate: 0.0775,
        correctionReason: 'senior_citizen',
        misreadCount: 2,
        pageRate: 0.0825,
      }),
      offer({ id: 'c' }),
    ];
    const d = pageDifferences(rows);
    expect(d.map((x) => [x.id, x.correction])).toEqual([
      ['a', false],
      ['b', true],
    ]);
    const p = pendingCorrections(rows);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({
      id: 'b',
      stillWrong: true,
      times: 2,
      reason: 'It was the senior-citizen rate',
    });
  });
  it('gives a readable label for unknown reasons too', () => {
    expect(reasonLabel(null)).toBe('No reason recorded');
    expect(reasonLabel('some_new_cause')).toBe('some new cause');
  });
});
