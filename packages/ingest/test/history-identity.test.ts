import { describe, expect, it } from 'vitest';
import {
  inferIdentities,
  type IdentLine,
  type IdentityFact,
  type IdentityOptions,
} from '../src/history-identity';

const NRE: IdentityFact = {
  label: 'Cash-NRE-1111',
  accountKind: 'NRE',
  last4: '1111',
  joint: false,
};
const NRO: IdentityFact = {
  label: 'Cash-NRO-2222',
  accountKind: 'NRO',
  last4: '2222',
  joint: false,
};
const NRE2: IdentityFact = {
  label: 'Cash-NRE JO-3333',
  accountKind: 'NRE',
  last4: '3333',
  joint: true,
};
const A = 'asset:a';
const B = 'asset:b';
const C = 'asset:c';

const opts: IdentityOptions = {
  facts: new Map([
    [A, NRE],
    [B, NRO],
    [C, NRE2],
  ]),
  jumpFactor: 50,
  jumpFloor: 100_000,
  tieRatio: 3,
};

interface Spec {
  /** an identified line: its account; null: a line the tab does not identify */
  id: string | null;
  amount?: number;
  /** the accounts an unidentified line could be */
  cand?: string[];
}

/** One tab of the group "Sample Bank - Asha". */
function tab(month: string, specs: Spec[], extra: Partial<IdentLine> = {}): IdentLine[] {
  const title = `T${month}`;
  return specs.map((s, i) => ({
    id: `${title}|F${i + 3}`,
    tab: title,
    month,
    witness: true,
    inferable: true,
    group: 'g',
    groupName: 'Sample Bank - Asha',
    pos: i + 1,
    label: s.id ? 'Cash-NRE' : 'Cash',
    amountInr: s.amount ?? 1000,
    identity: s.id,
    specific: s.id !== null,
    candidates: s.id ? [] : (s.cand ?? [A, B]),
    ...extra,
  }));
}
const line = (m: string, i: number) => `T${m}|F${i + 3}`;

describe('same position, same number of lines on both sides', () => {
  const lines = [
    ...tab('2024-01', [{ id: A }, { id: B }]),
    ...tab('2024-03', [{ id: null }, { id: null }]),
    ...tab('2024-05', [{ id: A }, { id: B }]),
  ];
  const r = inferIdentities(lines, opts);

  it('is certain, names the account and both tabs it was worked out from', () => {
    expect(r.get(line('2024-03', 0))).toMatchObject({
      state: 'certain',
      basis: 'position',
      identity: A,
      fromTabs: ['T2024-01', 'T2024-05'],
    });
    expect(r.get(line('2024-03', 1))).toMatchObject({ state: 'certain', identity: B });
    const why = r.get(line('2024-03', 0))!.why;
    expect(why).toContain('Same position (1st of 2)');
    expect(why).toContain('Sample Bank - Asha');
    expect(why).toContain('T2024-01 and T2024-05');
    expect(why).toContain('NRE account Cash-NRE-1111');
  });

  it('leaves identified lines alone', () => {
    expect(r.has(line('2024-01', 0))).toBe(false);
  });

  it('uses the nearest tab on each side, not a far one', () => {
    const far = [
      ...tab('2023-01', [{ id: B }, { id: A }]),
      ...lines,
      ...tab('2025-01', [{ id: B }, { id: A }]),
    ];
    expect(inferIdentities(far, opts).get(line('2024-03', 0))).toMatchObject({
      state: 'certain',
      identity: A,
    });
  });

  it('is only likely when a tab on one side only names the accounts', () => {
    const oneSide = [
      ...tab('2024-03', [{ id: null }, { id: null }]),
      ...tab('2024-05', [{ id: A }, { id: B }]),
    ];
    const x = inferIdentities(oneSide, opts).get(line('2024-03', 0))!;
    expect(x).toMatchObject({ state: 'likely', identity: A });
    expect(x.why).toContain('Only one tab on that side');
  });

  it('is only likely when the two sides list the accounts in a different order', () => {
    const flip = [
      ...tab('2024-01', [{ id: A }, { id: B }]),
      ...tab('2024-03', [{ id: null }, { id: null }]),
      ...tab('2024-05', [{ id: B }, { id: A }]),
    ];
    const x = inferIdentities(flip, opts);
    // the sides disagree on the order, so no way of giving the lines accounts fits both: at least one is kept
    expect(['likely', 'ambiguous', 'blocked']).toContain(x.get(line('2024-03', 0))!.state);
    expect(x.get(line('2024-03', 0))!.state).not.toBe('certain');
  });
});

describe('an account opened part-way', () => {
  it('takes the account that exists on both sides and says so', () => {
    const lines = [
      ...tab('2024-01', [{ id: A }]),
      ...tab('2024-03', [{ id: null, cand: [A, B] }]),
      ...tab('2024-05', [{ id: A }, { id: B }]),
    ];
    const x = inferIdentities(lines, opts).get(line('2024-03', 0))!;
    expect(x).toMatchObject({ state: 'likely', basis: 'order', identity: A });
    expect(x.why).toContain('1 line here against 1 in T2024-01 and 2 in T2024-05');
    expect(x.why).toContain('opened or closed in between');
    expect(x.why).toContain('Cash-NRO-2222');
  });

  it('keeps a new account out of an older tab that has only one line, even with no tab before it', () => {
    const lines = [
      ...tab('2024-03', [{ id: null, cand: [A, B] }]),
      ...tab('2024-05', [{ id: A }, { id: B }]),
      ...tab('2024-07', [{ id: A }, { id: B }]),
    ];
    // nothing says which of the two was open: two accounts fit
    const x = inferIdentities(lines, opts).get(line('2024-03', 0))!;
    expect(x.state).toBe('ambiguous');
    expect(x.candidates.sort()).toEqual([A, B]);
  });
});

describe('an account closed part-way', () => {
  it('takes the account that exists on both sides when the other is gone after', () => {
    const lines = [
      ...tab('2024-01', [{ id: A }, { id: B }]),
      ...tab('2024-03', [{ id: null, cand: [A, B] }]),
      ...tab('2024-05', [{ id: A }]),
    ];
    expect(inferIdentities(lines, opts).get(line('2024-03', 0))).toMatchObject({
      state: 'likely',
      basis: 'order',
      identity: A,
    });
  });

  it('uses the listed order to place the surviving line among three', () => {
    // before: A B C; after: A C (B closed); here two lines [?, C]: the first is A, the one in front of C
    const lines = [
      ...tab('2024-01', [{ id: A }, { id: B }, { id: C }]),
      ...tab('2024-03', [{ id: null, cand: [A, B] }, { id: C }]),
      ...tab('2024-05', [{ id: A }, { id: C }]),
    ];
    expect(inferIdentities(lines, opts).get(line('2024-03', 0))).toMatchObject({
      state: 'likely',
      identity: A,
    });
  });
});

describe('balance continuity is only a tie-break', () => {
  const witnesses = (a1: number, b1: number, a2: number, b2: number) => [
    ...tab('2024-01', [
      { id: A, amount: a1 },
      { id: B, amount: b1 },
    ]),
    ...tab('2024-05', [
      { id: A, amount: a2 },
      { id: B, amount: b2 },
    ]),
  ];

  it('picks the account whose balances next door are clearly closer, and calls it likely', () => {
    // the tab lists one line where the neighbours list two: order alone cannot say which
    const lines = [
      ...witnesses(100_000, 5_000, 110_000, 5_200),
      ...tab('2024-03', [{ id: null, amount: 5_100 }]),
    ];
    const x = inferIdentities(lines, opts).get(line('2024-03', 0))!;
    expect(x).toMatchObject({ state: 'likely', basis: 'balance', identity: B });
    expect(x.why).toContain('much closer');
    expect(x.why).toContain('T2024-01');
  });

  it('does not pick when the balances do not tell the accounts apart', () => {
    const lines = [
      ...witnesses(5_000, 5_000, 5_000, 5_000),
      ...tab('2024-03', [{ id: null, amount: 5_000 }]),
    ];
    const x = inferIdentities(lines, opts).get(line('2024-03', 0))!;
    expect(x.state).toBe('ambiguous');
    expect(x.candidates.sort()).toEqual([A, B]);
    expect(x.why).toContain('Choose the account yourself');
  });

  it('needs the closer balance to be closer by the configured ratio', () => {
    const lines = [
      ...witnesses(5_000, 4_000, 5_000, 4_000),
      ...tab('2024-03', [{ id: null, amount: 4_700 }]),
    ];
    expect(inferIdentities(lines, opts).get(line('2024-03', 0))!.state).toBe('ambiguous');
    expect(inferIdentities(lines, { ...opts, tieRatio: 1 }).get(line('2024-03', 0))!.state).toBe(
      'likely',
    );
  });
});

describe('contradictions block the inference', () => {
  it('a line that states a different kind than its position is blocked, with the reason', () => {
    // both lines say NRE (they could only be A), but the tabs have A then B at those positions
    const lines = [
      ...tab('2024-01', [{ id: A }, { id: B }]),
      ...tab('2024-03', [
        { id: null, cand: [A] },
        { id: null, cand: [A] },
      ]),
      ...tab('2024-05', [{ id: A }, { id: B }]),
    ];
    const r = inferIdentities(lines, opts);
    const second = r.get(line('2024-03', 1))!;
    expect(second.state).toBe('blocked');
    expect(second.identity).toBeNull();
    expect(second.contradiction).toContain('Cash-NRO-2222');
    expect(second.why).toContain('Not inferred');
  });

  it('a balance far from what the account held next door is blocked, with the reason', () => {
    const lines = [
      ...tab('2024-01', [
        { id: A, amount: 100 },
        { id: B, amount: 200 },
      ]),
      ...tab('2024-03', [
        { id: null, amount: 9_000_000 },
        { id: null, amount: 150 },
      ]),
      ...tab('2024-05', [
        { id: A, amount: 120 },
        { id: B, amount: 220 },
      ]),
    ];
    const r = inferIdentities(lines, opts);
    expect(r.get(line('2024-03', 0))).toMatchObject({ state: 'blocked', identity: null });
    expect(r.get(line('2024-03', 0))!.contradiction).toContain('is far from what');
    expect(r.get(line('2024-03', 0))!.contradiction).toContain('₹100 in T2024-01');
    expect(r.get(line('2024-03', 0))!.candidates[0]).toBe(A);
    // the other line is fine
    expect(r.get(line('2024-03', 1))).toMatchObject({ state: 'certain', identity: B });
  });

  it('small differences are never a jump, whatever the ratio', () => {
    const lines = [
      ...tab('2024-01', [
        { id: A, amount: 1 },
        { id: B, amount: 2 },
      ]),
      ...tab('2024-03', [
        { id: null, amount: 5_000 },
        { id: null, amount: 3 },
      ]),
      ...tab('2024-05', [
        { id: A, amount: 1 },
        { id: B, amount: 2 },
      ]),
    ];
    expect(inferIdentities(lines, opts).get(line('2024-03', 0))!.state).toBe('certain');
  });

  it('the jump limits come from the settings', () => {
    const lines = [
      ...tab('2024-01', [
        { id: A, amount: 100 },
        { id: B, amount: 200 },
      ]),
      ...tab('2024-03', [
        { id: null, amount: 9_000_000 },
        { id: null, amount: 150 },
      ]),
      ...tab('2024-05', [
        { id: A, amount: 120 },
        { id: B, amount: 220 },
      ]),
    ];
    const loose = inferIdentities(lines, { ...opts, jumpFactor: 1_000_000 });
    expect(loose.get(line('2024-03', 0))!.state).toBe('certain');
  });

  it('neighbours that disagree about the accounts block rather than guess', () => {
    const lines = [
      ...tab('2024-01', [{ id: A }, { id: B }]),
      ...tab('2024-03', [{ id: A }, { id: null, cand: [A] }]),
      ...tab('2024-05', [{ id: A }, { id: B }]),
    ];
    // the second line could only be A, which the first line already is
    expect(inferIdentities(lines, opts).get(line('2024-03', 1))!.state).toBe('blocked');
  });
});

describe('nothing to go on', () => {
  it('no tab names the accounts: ambiguous, with the candidates', () => {
    const lines = tab('2024-03', [{ id: null, cand: [A, B] }]);
    const x = inferIdentities(lines, opts).get(line('2024-03', 0))!;
    expect(x).toMatchObject({ state: 'ambiguous', identity: null, candidates: [A, B] });
    expect(x.why).toContain('nothing to work it out from');
  });

  it('a tab whose month is in doubt is not inferred', () => {
    const lines = [
      ...tab('2024-01', [{ id: A }, { id: B }]),
      ...tab('2024-03', [{ id: null }, { id: null }], { inferable: false }),
      ...tab('2024-05', [{ id: A }, { id: B }]),
    ];
    expect(inferIdentities(lines, opts).get(line('2024-03', 0))!.state).toBe('ambiguous');
  });

  it('a tab that is not itself fully identified is not a witness', () => {
    const lines = [
      ...tab('2024-01', [{ id: A }, { id: null }]),
      ...tab('2024-03', [{ id: null }, { id: null }]),
      ...tab('2024-05', [{ id: A }, { id: B }]),
    ];
    // only one side names every account
    expect(inferIdentities(lines, opts).get(line('2024-03', 0))!.state).toBe('likely');
  });

  it('copies do not count as witnesses', () => {
    const lines = [
      ...tab('2024-01', [{ id: A }, { id: B }]),
      ...tab('2024-03', [{ id: null }, { id: null }]),
      ...tab('2024-05', [{ id: A }, { id: B }], { witness: false }),
    ];
    expect(inferIdentities(lines, opts).get(line('2024-03', 0))!.state).toBe('likely');
  });

  it('groups are kept apart', () => {
    const other = tab('2024-01', [{ id: C }]).map((l) => ({ ...l, group: 'h', id: `h-${l.id}` }));
    const lines = [
      ...other,
      ...tab('2024-03', [{ id: null, cand: [A, B] }]),
      ...tab('2024-05', [{ id: A }]),
    ];
    expect(inferIdentities(lines, opts).get(line('2024-03', 0))!.identity).toBe(A);
  });
});
