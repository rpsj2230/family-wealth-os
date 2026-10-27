import type { HistoryExisting } from '../src/history';
import type { ImportPlan } from '../src/workbook';

/** What the database holds after a plan has been imported the ordinary way (ids are the plan's keys). */
export function existingFromPlan(plan: ImportPlan, onlyTypes?: string[]): HistoryExisting {
  const owner = new Map(plan.owners.map((o) => [o.key, o.displayName]));
  const inst = new Map(plan.institutions.map((i) => [i.key, i.name]));
  const fd = new Map(plan.fixedDeposits.map((f) => [f.assetKey, f]));
  const fund = new Map(plan.funds.map((f) => [f.assetKey, f]));
  const assets = plan.assets
    .filter((a) => !onlyTypes || onlyTypes.includes(a.type))
    .map((a) => {
      const f = fd.get(a.key);
      const m = fund.get(a.key);
      return {
        id: a.key,
        type: a.type,
        status: a.status === 'matured_unconfirmed' ? 'matured_unconfirmed' : a.status,
        nickname: a.nickname,
        label: a.label ?? null,
        last4: a.identifierLast4 ?? null,
        accountKind: a.accountKind ?? null,
        joint: !!a.isJoint,
        holderName: a.holderName ?? null,
        currency: a.currency,
        ownerName: owner.get(a.ownerKey) ?? '',
        bank: a.institutionKey ? (inst.get(a.institutionKey) ?? null) : null,
        fd: f
          ? {
              principal: f.principal,
              rate: f.rate,
              bookedOn: f.bookedOn,
              maturityOn: f.maturityOn,
              ref: f.ref ?? null,
              refLast4: f.refLast4 ?? null,
            }
          : null,
        fundName: m?.fundName ?? null,
        startedOn: m?.startedOn ?? null,
        goal: m?.goalTag ?? null,
      };
    });
  const ids = new Set(assets.map((a) => a.id));
  return {
    assets,
    observations: plan.observations
      .filter((o) => ids.has(o.assetKey))
      .map((o, i) => ({
        id: `obs-${i}`,
        assetId: o.assetKey,
        asOf: o.asOf,
        amount: o.amount,
        currency: o.currency,
        source: 'workbook',
        sourceRef: o.sourceRef,
        confidence: o.confidence,
        supersededBy: null,
      })),
  };
}
