import { describe, expect, it } from 'vitest';
import {
  absentPrompt,
  ambiguousPrompt,
  diffFundImport,
  evidenceFor,
  foreignPrompt,
  nameParts,
  pickCandidate,
  sameSchemeName,
  schemeLinkKey,
  sipPrompt,
  type FundImportInput,
  type OnFileFund,
  type OnFileState,
  type SipChange,
  type StatementFund,
} from '../src';

const TOL = 0.001;
const state = (o: Partial<OnFileState> = {}): OnFileState => ({
  units: 100,
  invested: 10_000,
  sipMonthly: null,
  sipStopped: false,
  sipChanges: [],
  lines: [],
  latestValue: null,
  snapshots: [],
  ignored: [],
  ...o,
});
const fund = (id: string, o: Partial<OnFileFund> & { units?: number | null } = {}): OnFileFund => {
  const { units, ...rest } = o;
  return {
    assetId: id,
    name: 'Axis Large Cap',
    isin: 'INF846K01131',
    amfiCode: null,
    folioLast4: null,
    status: 'active',
    unitsAsOf: null,
    startedOn: '2021-03-05',
    state: state({ units: units === undefined ? 100 : units }),
    ...rest,
  };
};
const stmt = (o: Partial<StatementFund> = {}): StatementFund => ({
  name: 'Axis Large Cap Fund - Direct Growth',
  isin: 'INF846K01131',
  amfiCode: null,
  folioLast4: '3820',
  lines: [],
  closingUnits: 3047.333,
  openingUnits: 0,
  held: true,
  invested: 450_000,
  startedOn: '2021-03-05',
  value: null,
  holdingsOnly: false,
  soldThisYear: false,
  match: { status: 'ambiguous' },
  ...o,
});
const prompt = (s: StatementFund, onFile: OnFileFund[], siblings: { folioLast4: string; units: number | null }[] = []) =>
  ambiguousPrompt({ key: 'k', s, candidates: null, onFile, siblings, tolerance: TOL });

describe('scheme names', () => {
  it('are the same scheme when the words agree, whatever the spelling of "fund", "growth" or "large cap"', () => {
    expect(sameSchemeName('Axis Large Cap Fund - Direct Growth', 'Axis Large Cap')).toBe(true);
    expect(sameSchemeName('Axis Large-Cap Fund Direct Plan Growth', 'AXIS LARGECAP FUND')).toBe(true);
    expect(sameSchemeName('Axis Large Cap Fund', 'Axis Mid Cap Fund')).toBe(false);
  });
  it('are different schemes when both name a plan and the plans differ', () => {
    expect(sameSchemeName('Axis Large Cap - Direct Growth', 'Axis Large Cap - Regular Growth')).toBe(false);
    expect(nameParts('Axis Large Cap Fund - Direct Growth')).toEqual({ core: 'axis largecap', plan: 'direct' });
  });
  it('are remembered under the ISIN, or the name when there is none', () => {
    expect(schemeLinkKey({ isin: 'INF846K01131', name: 'x' })).toBe('inf846k01131');
    expect(schemeLinkKey({ isin: null, name: 'Axis Large Cap Fund - Direct Growth' })).toBe(
      'name:axis largecap|direct',
    );
  });
});

describe('evidence for one fund', () => {
  it('compares ISIN, folio, units and name', () => {
    const s = stmt({ folioLast4: '8540', closingUnits: 700 });
    const e = evidenceFor(s, fund('a', { folioLast4: '8540', units: 700 }), TOL, null);
    expect(e).toEqual({ isin: true, folio: true, units: true, combined: false, name: true });
    const none = evidenceFor(s, fund('b', { isin: 'INF000X', name: 'Other', units: 5 }), TOL, null);
    expect(none).toEqual({ isin: false, folio: false, units: false, combined: false, name: false });
  });
  it('allows the unit tolerance, no more', () => {
    const s = stmt({ closingUnits: 100.0005 });
    expect(evidenceFor(s, fund('a', { units: 100 }), TOL, null).units).toBe(true);
    expect(evidenceFor(s, fund('a', { units: 100.01 }), TOL, null).units).toBe(false);
  });
});

describe('picking a candidate', () => {
  const e = (o: Partial<ReturnType<typeof evidenceFor>>) => ({
    evidence: { isin: false, folio: false, units: false, combined: false, name: false, ...o },
  });
  it('prefers ISIN with folio over everything', () => {
    expect(pickCandidate([e({ isin: true, units: true }), e({ isin: true, folio: true })])).toEqual({
      index: 1,
      tier: 'folio',
    });
  });
  it('then ISIN with the units equal, then the combined units, then a name only one fund has', () => {
    expect(pickCandidate([e({ isin: true }), e({ isin: true, units: true })])).toEqual({ index: 1, tier: 'units' });
    expect(pickCandidate([e({ isin: true }), e({ isin: true, combined: true })])).toEqual({ index: 1, tier: 'combined' });
    expect(pickCandidate([e({ isin: true }), e({ isin: true, name: true })])).toEqual({ index: 1, tier: 'name' });
  });
  it('points nowhere when the evidence is equal, or there is none', () => {
    expect(pickCandidate([e({ isin: true, name: true }), e({ isin: true, name: true })])).toBeNull();
    expect(pickCandidate([e({ isin: true }), e({ isin: true })])).toBeNull();
    expect(pickCandidate([])).toBeNull();
  });
  it('lets the units settle two funds that both have the folio and the ISIN', () => {
    const r = pickCandidate([
      e({ isin: true, folio: true }),
      e({ isin: true, folio: true, units: true }),
    ]);
    expect(r).toEqual({ index: 1, tier: 'folio' });
  });
});

describe('the prompt for a folio that could be several funds', () => {
  it('ISIN and folio: the statement folio is the folio on file for one of two funds with the ISIN', () => {
    const p = prompt(stmt({ folioLast4: '8540', closingUnits: 700 }), [
      fund('a', { name: 'Axis Large Cap A', folioLast4: '3300', units: 50 }),
      fund('b', { name: 'Axis Large Cap B', folioLast4: '8540', units: 600 }),
    ]);
    const s = p.suggestion;
    expect(s.recommended).toBe('link:b');
    expect(s.suggest).toBe('Apply folio …8540 to your fund "Axis Large Cap B".');
    expect(s.why).toContain('Both of your funds with this ISIN could be it');
    expect(s.why).toContain('only "Axis Large Cap B" has folio …8540 on file');
    expect(s.approve).toBe('Approve: link folio …8540 to "Axis Large Cap B"');
    expect(s.options.map((o) => o.id)).toEqual(['link:b', 'link:a', 'new', 'leave']);
    expect(p.start).toBe('leave'); // nothing happens until it is approved
  });

  it('ISIN with the units equal: the folio is not on file yet, the units are the statement\'s closing units', () => {
    const p = prompt(stmt(), [
      fund('a', { folioLast4: '8540', units: 700 }),
      fund('b', { name: 'Axis Large Cap', folioLast4: null, units: 3047.333 }),
    ]);
    const s = p.suggestion;
    expect(s.recommended).toBe('link:b');
    expect(s.why).toBe(
      'Folio …3820 is not on file yet, but your fund "Axis Large Cap" has 3,047.333 units, which equal the statement\'s closing units.',
    );
    expect(s.suggest).toBe('Link folio …3820 to your fund "Axis Large Cap".');
  });

  it('says when the fund has another folio on file', () => {
    const p = prompt(stmt(), [
      fund('a', { folioLast4: '8540', units: 3047.333 }),
      fund('b', { name: 'Axis Large Cap B', folioLast4: '1', units: 1 }),
    ]);
    expect(p.suggestion.why).toContain('not the folio on file (…8540)');
  });

  it('a name only one fund has: the others only share the ISIN', () => {
    const p = prompt(stmt({ closingUnits: 10 }), [
      fund('a', { name: 'Axis Large Cap', units: 50 }),
      fund('b', { name: 'Axis Bluechip Legacy', units: 60 }),
    ]);
    expect(p.suggestion.recommended).toBe('link:a');
    expect(p.suggestion.why).toContain('Only "Axis Large Cap" has this scheme\'s name');
    expect(p.candidates.map((c) => c.assetId)[0]).toBe('a');
  });

  it('combines two folios that are one holding: together they hold the units of one fund', () => {
    const s = stmt({ folioLast4: '3820', closingUnits: 1000 });
    const p = prompt(
      s,
      [
        fund('a', { name: 'Axis Large Cap', units: 1700 }),
        fund('b', { name: 'Axis Large Cap', units: 5 }),
      ],
      [{ folioLast4: '8540', units: 700 }],
    );
    expect(p.suggestion.recommended).toBe('link:a');
    expect(p.suggestion.suggest).toContain('Combine them into one holding');
    expect(p.suggestion.why).toContain('Folios …3820 and …8540 on this statement are one scheme and hold 1,700 units together');
  });

  it('no evidence: says it cannot tell, offers no Approve, and still lists every choice', () => {
    const p = prompt(stmt({ closingUnits: 410.5, folioLast4: '6601' }), [
      fund('a', { folioLast4: '2200', units: 100 }),
      fund('b', { folioLast4: '2201', units: 200 }),
    ]);
    const s = p.suggestion;
    expect(s.recommended).toBeNull();
    expect(s.approve).toBeNull();
    expect(s.suggest).toBe('I cannot tell which it is, so I am not guessing: please choose.');
    expect(s.why).toContain('nothing (the folio, the units or the name) points to just one of them');
    expect(s.options.map((o) => o.id)).toEqual(['link:a', 'link:b', 'new', 'leave']);
    expect(s.options[0]!.label).toBe('Same as Axis Large Cap, folio …2200, 100 units, since 5 Mar 2021');
  });

  it('describes each candidate by folio, units and start date, so two funds of one name can be told apart', () => {
    const p = prompt(stmt(), [
      fund('a', { folioLast4: null, units: 3047.333, status: 'closed' }),
      fund('b', { folioLast4: '8540', units: 700 }),
    ]);
    const labels = p.suggestion.options.map((o) => o.label);
    expect(labels.some((l) => l.includes('no folio on file, 3,047.333 units, since 5 Mar 2021, closed'))).toBe(true);
    expect(labels.some((l) => l.includes('folio …8540, 700 units'))).toBe(true);
  });

  it('with nothing that fits it offers a new fund or leaving it', () => {
    const p = prompt(stmt(), []);
    expect(p.suggestion.recommended).toBeNull();
    expect(p.suggestion.options.map((o) => o.id)).toEqual(['new', 'leave']);
    expect(p.suggestion.why).toBe('No fund of yours has this ISIN or name.');
  });

  it('uses the candidates the matcher named, not every fund', () => {
    const files = [fund('a', { units: 3047.333 }), fund('b'), fund('c', { units: 3047.333 })];
    const p = ambiguousPrompt({
      key: 'k',
      s: stmt(),
      candidates: [files[0]!, files[1]!],
      onFile: files,
      siblings: [],
      tolerance: TOL,
    });
    expect(p.candidates.map((c) => c.assetId).sort()).toEqual(['a', 'b']);
    expect(p.suggestion.recommended).toBe('link:a');
  });
});

describe('the prompt for a fund the statement does not list', () => {
  const f = fund('x', { name: 'Old Fund', folioLast4: '9001', units: 50 });
  it('suggests marking it sold when the statement lists all the funds of the person', () => {
    const p = absentPrompt({ f, asOf: '2026-10-25', basis: 'pan' });
    expect(p.suggestion.recommended).toBe('sold');
    expect(p.start).toBe('sold');
    expect(p.suggestion.approve).toBe('Approve: mark "Old Fund" as sold on 25 Oct 2026');
    expect(p.suggestion.options.find((o) => o.id === 'sold')!.input).toMatchObject({
      kind: 'date',
      value: '2026-10-25',
      required: true,
    });
  });
  it('suggests leaving it as it is when the statement is keyed on an e-mail address', () => {
    const p = absentPrompt({ f, asOf: '2026-10-25', basis: 'email' });
    expect(p.suggestion.recommended).toBe('keep');
    expect(p.start).toBe('keep');
    expect(p.suggestion.suggest).toBe('Leave it as it is.');
    expect(p.suggestion.why).toContain('keyed on an e-mail address and may not list every folio');
    expect(p.suggestion.options.map((o) => o.id)).toEqual(['keep', 'sold']);
    expect(p.suggestion.found).toContain('folio …9001, 50 units');
  });
});

describe('the prompt for a SIP that could not be judged', () => {
  const sip = { kind: 'cannot_tell', before: 3000, why: 'Cannot tell yet: the instalment is late.' } as SipChange;
  it('suggests keeping the SIP as recorded, or marking it stopped from a date', () => {
    const p = sipPrompt({ name: 'Bond Fund', sip, stopFrom: '2026-10-24' });
    expect(p.suggestion.suggest).toBe('Keep the SIP as recorded (₹3,000 a month).');
    expect(p.suggestion.approve).toBe('Approve: keep the SIP as recorded');
    expect(p.suggestion.options[1]).toMatchObject({
      id: 'stop',
      action: 'mark the SIP stopped from 24 Oct 2026',
      input: { kind: 'date', value: '2026-10-24', required: true },
    });
    expect(p.start).toBe('keep');
  });
});

describe('the prompt for folios of someone else', () => {
  const g = {
    key: 'foreign:567H',
    holder: 'Chitra Example',
    panLast4: '567H',
    member: null,
    folios: [{ name: 'Sample Bond Fund', folioLast4: '4455', units: 10, invested: 1000 }],
  };
  it('suggests skipping them and links to Settings > People for someone not in the family list', () => {
    const p = foreignPrompt(g);
    expect(p.suggestion.suggest).toBe('Skip these folios.');
    expect(p.suggestion.recommended).toBe('skip');
    expect(p.suggestion.found).toContain('not any person in your family list');
    expect(p.suggestion.links).toEqual([{ href: '/settings?tab=people', text: 'Add this person in Settings > People' }]);
    expect(p.suggestion.options.map((o) => o.id)).toEqual(['skip', 'mine']);
  });
  it('names the family member whose folios they are, and has no Add link', () => {
    const p = foreignPrompt({ ...g, member: 'Beena' });
    expect(p.suggestion.suggest).toBe("Skip these folios here; they belong to Beena.");
    expect(p.suggestion.links).toEqual([]);
    expect(p.suggestion.why).toContain('import this statement again under Beena');
  });
});

describe('inside the comparison', () => {
  const input = (o: Partial<FundImportInput>): FundImportInput => ({
    ownerId: 'o1',
    source: 'statement',
    complete: true,
    periodFrom: '2023-01-01',
    periodTo: '2026-10-25',
    today: '2026-10-26',
    funds: [],
    onFile: [],
    rules: { sipMinInstalments: 3, unitTolerance: TOL, moneyTolerance: 1 },
    ...o,
  });
  it('gives each ambiguous folio its own key and a prompt, and the old red "Needs a look" is gone', () => {
    const d = diffFundImport(
      input({
        funds: [stmt({ folioLast4: '8540', closingUnits: 700 }), stmt({ folioLast4: '3820' })],
        onFile: [
          fund('a', { folioLast4: '8540', units: 700 }),
          fund('b', { folioLast4: null, units: 3047.333 }),
        ],
      }),
    );
    expect(d.items.map((i) => i.kind)).toEqual(['review', 'review']);
    expect(new Set(d.items.map((i) => i.key)).size).toBe(2);
    expect(d.items[0]!.prompt!.suggestion.recommended).toBe('link:a');
    expect(d.items[1]!.prompt!.suggestion.recommended).toBe('link:b');
    expect(JSON.stringify(d)).not.toMatch(/Needs a look|check its ISIN or folio/);
    expect(d.items.every((i) => i.write === null && !i.changed)).toBe(true);
  });
});
