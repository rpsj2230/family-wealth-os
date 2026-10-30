import {
  DEFAULT_CONFIG,
  moneyChain,
  moneyTrail,
  parseHomeRange,
  type Classified,
  type TrailLine,
} from '@fwos/core';
import type { MoneyTrailData, StoredLine } from '@fwos/data';
import { demoModel } from '@/lib/demo-fixture';
import { demoHomeInput } from '@/lib/demo-home';
import { holdingLabels } from '@/lib/holding-label';

/**
 * The money trail of the invented sample household: two accounts of different people and a deposit of the second, with invented
 * statement lines through them (money from Singapore, a transfer, a deposit booked, interest). The same shape the signed-in pages
 * read, so the sample pages use the same components.
 */
export function demoTrail(): {
  data: MoneyTrailData;
  labels: Record<string, string>;
  names: Record<string, string>;
  accounts: { a: string; b: string; dep: string };
  banks: Record<string, string>;
  meta: Record<string, { owner: string; type: string }>;
} {
  const input = demoHomeInput(parseHomeRange('1y'));
  const position = input.position!;
  const today = position.config.today;
  const names = Object.fromEntries(Object.entries(input.styles).map(([id, s]) => [id, s.name]));
  const people = Object.keys(names);
  const accounts = position.assets.filter((a) => a.type === 'bank_account' && a.currency === 'INR');
  const a = accounts.find((x) => x.ownerId === people[0]) ?? accounts[0]!;
  const b = accounts.find((x) => x.ownerId !== a.ownerId) ?? accounts[1] ?? a;
  const dep =
    position.assets.find((x) => x.type === 'fixed_deposit' && x.ownerId === b.ownerId) ??
    position.assets.find((x) => x.type === 'fixed_deposit')!;
  const y = Number(today.slice(0, 4)) - 1;
  const d = (m: number, day: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  let n = 0;
  const ln = (
    assetId: string,
    date: string,
    amount: number,
    cls: TrailLine['cls'],
    counterpart: string | null,
    narration: string,
  ): TrailLine => ({ id: `s${++n}`, assetId, date, amount, cls, counterpart, narration });
  const lines: TrailLine[] = [
    ln(
      a.assetId,
      d(4, 2),
      1_000_000,
      'own_transfer',
      'singapore',
      'Transfer from Singapore (Wise)',
    ),
    ln(a.assetId, d(4, 5), -600_000, 'own_transfer', b.assetId, 'Transfer to the second account'),
    ln(b.assetId, d(4, 5), 600_000, 'own_transfer', a.assetId, 'Transfer from the first account'),
    ln(b.assetId, d(4, 8), -500_000, 'fd_funding', dep.assetId, 'Deposit booked'),
    ln(a.assetId, d(6, 30), 4_000, 'interest', null, 'Interest'),
    ln(b.assetId, d(6, 30), 1_500, 'interest', null, 'Interest'),
  ];
  const openings = new Map([[b.assetId, 50_000]]);
  const assets = [
    { id: a.assetId, ownerId: a.ownerId, kind: 'account' as const },
    { id: b.assetId, ownerId: b.ownerId, kind: 'account' as const },
    { id: dep.assetId, ownerId: dep.ownerId, kind: 'deposit' as const },
  ];
  const trails = moneyTrail({ lines, assets, openings, ownershipFrom: d(4, 1) });
  const st = DEFAULT_CONFIG.statements;
  const chain = moneyChain({
    lines,
    assets,
    deposits: [
      {
        assetId: dep.assetId,
        ownerId: dep.ownerId,
        principal: 500_000,
        bookedOn: d(4, 8),
        maturityOn: `${y + 2}-04-08`,
        endedOn: null,
        maturityAmount: null,
      },
    ],
    openings,
    method: st.trailRecentFirst ? 'recent' : 'mix',
    pairDays: DEFAULT_CONFIG.estimates.transferPairDays,
    remittanceOf: new Map([['s1', 'sample-wise']]),
  });
  // the lines as stored, with each account's running balance
  const run = new Map(openings);
  const stored: StoredLine[] = lines.map((l) => {
    const bal = (run.get(l.assetId) ?? 0) + l.amount;
    run.set(l.assetId, bal);
    return {
      id: l.id,
      statement_id: `st-${l.assetId}`,
      asset_id: l.assetId,
      txn_on: l.date,
      amount: l.amount,
      balance: bal,
      narration: l.narration,
      answer: null,
    };
  });
  const why: Partial<Record<TrailLine['cls'], string>> = {
    own_transfer: 'The same sum left one of your accounts and reached another the same day',
    fd_funding: 'A deposit of this amount was booked that day',
    interest: 'Interest credited by the bank',
  };
  const classified = new Map<string, Classified>(
    lines.map((l) => [
      l.id,
      {
        id: l.id,
        cls: l.cls,
        counterpart: l.counterpart === 'singapore' ? null : l.counterpart,
        reason: why[l.cls] ?? '',
      },
    ]),
  );
  const bankNames: Record<string, string> = demoModel().institutionNames;
  const labels = holdingLabels(
    position.assets.map((x) => ({
      id: x.assetId,
      nickname: x.name,
      owner: names[x.ownerId] ?? '',
      bank: x.institutionId ? (bankNames[x.institutionId] ?? null) : null,
      last4: x.last4 ?? null,
      fd: x.fd ? { principal: x.fd.principal, maturityOn: x.fd.maturityOn } : null,
    })),
  );
  const data: MoneyTrailData = {
    trails,
    holdings: [
      { id: a.assetId, ownerId: a.ownerId, kind: 'account', statements: true },
      { id: b.assetId, ownerId: b.ownerId, kind: 'account', statements: true },
      { id: dep.assetId, ownerId: dep.ownerId, kind: 'deposit', statements: false },
    ],
    remittances: { count: 1, amount: 1_000_000, proven: 1, placed: 1 },
    ownershipFrom: d(4, 1),
    lines: stored,
    statements: [a.assetId, b.assetId].map((id) => ({
      id: `st-${id}`,
      asset_id: id,
      from_on: d(4, 1),
      to_on: d(6, 30),
      opening: openings.get(id) ?? 0,
      closing: run.get(id) ?? 0,
      line_count: stored.filter((l) => l.asset_id === id).length,
      breaks: 0,
      layout: 'debit-credit',
      file_label: 'Sample statement.csv',
      uploaded_at: `${today}T00:00:00Z`,
    })),
    classified,
    remitById: new Map([['sample-wise', { receivedOn: d(4, 2), amount: 1_000_000 }]]),
    chain,
    traceOptions: { smallest: st.trailSmallest, depth: st.trailDepth, budget: st.trailSteps },
  };
  const banks = Object.fromEntries(
    position.assets
      .filter((x) => x.institutionId && bankNames[x.institutionId])
      .map((x) => [x.assetId, bankNames[x.institutionId!]!]),
  );
  const meta = Object.fromEntries(
    position.assets.map((x) => [x.assetId, { owner: x.ownerId, type: x.type }]),
  );
  return {
    data,
    labels,
    names,
    accounts: { a: a.assetId, b: b.assetId, dep: dep.assetId },
    banks,
    meta,
  };
}
