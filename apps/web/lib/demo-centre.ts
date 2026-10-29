import { isCounted, isEstimatedTxn, type CentreHolding, type HoldingClass } from '@fwos/core';
import { demoHomeInput } from './demo-home';
import { centreGoal, foreignOf, type CentreData } from './report-centre-data';

const CLASS_OF: Record<string, HoldingClass> = {
  bank_account: 'cash',
  fixed_deposit: 'fd',
  mutual_fund: 'funds',
};

/** The Report Centre's input for the public sample: the same invented household, holdings and history as the sample Home. */
export function demoCentreData(): CentreData {
  const h = demoHomeInput('1Y');
  const rows = h.blocks.flatMap((b) =>
    b.sections.flatMap((s) => s.rows.map((r) => ({ r, bank: b.name }))),
  );
  const rowOf = new Map(rows.map((x) => [x.r.assetId, x]));
  const funds = (h.inv?.groups ?? []).flatMap((g) =>
    g.funds.map((f) => ({ f, ownerId: g.ownerId })),
  );
  const fundOf = new Map(funds.map((x) => [x.f.assetId, x.f]));
  const holdings: CentreHolding[] = h.portfolio.valued.filter(isCounted).map((v) => {
    const row = rowOf.get(v.assetId);
    const line = h.portfolio.lines[v.assetId];
    const currency = row?.r.currency ?? h.currencyOf[v.assetId] ?? 'INR';
    const fund = fundOf.get(v.assetId);
    return {
      id: v.assetId,
      name: row?.r.code ?? v.name,
      ownerId: v.ownerId,
      cls: CLASS_OF[v.type] ?? 'others',
      type: v.type,
      bank: row?.bank ?? null,
      currency,
      value: v.estimate!.estimatedAmount,
      native: currency !== 'INR' ? (row?.r.recorded ?? null) : null,
      cost: row?.r.fd ? row.r.fd.principal : fund ? fund.invested : null,
      asOf: line?.asOf ?? null,
      estimated: v.estimate!.basis !== 'calculated' || !!line?.usedAssumption,
      stale: line?.freshness === 'stale' || line?.freshness === 'missing',
    };
  });
  const deposits = rows
    .filter((x) => x.r.fd)
    .map(({ r, bank }) => ({
      id: r.assetId,
      name: r.code,
      bank,
      ownerId: r.ownerId,
      principal: r.fd!.principal,
      rate: r.fd!.rate,
      bookedOn: r.fd!.bookedOn,
      maturityOn: r.fd!.maturityOn,
      maturityAmount: r.fd!.maturityAmount,
      compounding: r.fd!.compounding,
      running: r.status === 'active' && r.fd!.daysLeft >= 0,
    }));
  return {
    input: {
      today: h.today,
      first: h.snapshots[0]?.date ?? null,
      people: Object.fromEntries(Object.entries(h.styles).map(([id, s]) => [id, s.name])),
      holdings,
      deposits,
      funds: funds.map(({ f, ownerId }) => ({
        id: f.assetId,
        name: f.name,
        ownerId,
        amc: f.amc,
        category: f.category.label,
        plan: f.plan,
        value: f.value,
        cost: f.invested,
        units: f.units,
        hasStatement: f.hasStatement,
        txns: f.txns.map((t) => ({
          date: t.date,
          kind: t.kind,
          units: t.units,
          amount: t.amount,
          estimated: isEstimatedTxn(t),
        })),
        realised: f.realised,
      })),
      fx: foreignOf(holdings, (id) => h.portfolio.lines[id]?.marketDate ?? null),
      snapshots: h.snapshots,
      receivables: h.receivables.map((r) => ({ ...r })),
      goals: h.goals.map(centreGoal),
      financialQuarters: h.config.funds.financialQuarters,
      quality: { toAnswer: null, fundsNoPrice: h.fundsNoPrice },
    },
    banks: [...new Set(holdings.map((x) => x.bank).filter((b): b is string => !!b))].sort(),
    amcs: [...new Set(funds.map((x) => x.f.amc).filter((a): a is string => !!a))].sort(),
    saved: [],
  };
}
