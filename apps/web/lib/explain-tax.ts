import {
  buildTaxExplain,
  type ExplainSet,
  type HarvestPlan,
  type HarvestView,
  type TaxExplainInput,
} from '@fwos/core';

export interface TaxRefundFacts {
  expected_gain: number;
  expected_refund: number;
  refund_received: number | null;
  status: string;
}

/** The "?" explainers of the Tax pages, from the same plan and view the page draws. */
export function taxExplain(a: {
  view: HarvestView;
  plan: Pick<HarvestPlan, 'fy' | 'status' | 'rulesVerified' | 'rulesCarriedForward'>;
  today: string;
  refunds: TaxRefundFacts[];
  incomeLimit: number;
  sample: boolean;
}): ExplainSet<'tax'> {
  const to = (p: string) => (a.sample ? `/demo${p}` : p);
  return buildTaxExplain({
    fy: a.plan.fy,
    today: a.today,
    deadline: a.view.deadline,
    daysLeft: a.view.daysLeft,
    orderBy: a.view.orderBy,
    status: a.plan.status,
    rulesVerified: a.plan.rulesVerified,
    rulesCarriedForward: a.plan.rulesCarriedForward,
    people: a.view.people.map((p) => ({
      name: p.name,
      meter: p.meter,
      sell: p.sell.map((s) => ({
        fund: s.fund,
        worth: s.worth,
        gain: s.gain,
        estimated: s.estimated,
      })),
      losses: p.losses.rows.map((l) => ({
        fund: l.fund,
        loss: l.loss,
        shortLoss: l.shortLoss,
        longLoss: l.longLoss,
        estimated: l.estimated,
      })),
    })),
    costs: a.view.costs,
    refunds: {
      count: a.refunds.length,
      open: a.refunds.filter((r) => r.status !== 'received').length,
      expectedGain: a.refunds.reduce((s, r) => s + r.expected_gain, 0),
      expectedRefund: a.refunds.reduce((s, r) => s + r.expected_refund, 0),
      received: a.refunds.reduce((s, r) => s + (r.refund_received ?? 0), 0),
      incomeLimit: a.incomeLimit,
    },
    links: {
      settings: to('/settings'),
      investments: to('/investments'),
      filing: a.sample ? '' : '/tax/filing',
      import: to('/import'),
    },
  } satisfies TaxExplainInput);
}

/** The explainers when there is no plan to read (the standalone simulator): only the simulator's own is meaningful. */
export function taxExplainBare(sample: boolean): ExplainSet<'tax'> {
  const to = (p: string) => (sample ? `/demo${p}` : p);
  return buildTaxExplain({
    fy: '',
    today: '',
    deadline: '',
    daysLeft: 0,
    orderBy: '',
    status: 'ok',
    rulesVerified: true,
    rulesCarriedForward: false,
    people: [],
    costs: { stt: 0, stampDuty: 0, exitLoad: 0, total: 0 },
    refunds: { count: 0, open: 0, expectedGain: 0, expectedRefund: 0, received: 0, incomeLimit: 0 },
    links: {
      settings: to('/settings'),
      investments: to('/investments'),
      filing: '',
      import: to('/import'),
    },
  });
}
