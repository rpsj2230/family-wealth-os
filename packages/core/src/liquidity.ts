/**
 * "I need ₹X": where the money can come from, by when, and what it costs.
 *
 * Every holding becomes a source with the date its money could be in the bank and what getting it out costs
 * (interest lost on an early deposit break, exit load, tax on gains). The planner then picks sources for an amount,
 * for a chosen deadline, ranked by cost, by speed or by your own order of preference. Pure: no I/O.
 *
 * Honest limits, shown with each plan: costs are estimates from what is recorded (a fund's invested amount and first
 * purchase, a deposit's terms), bank and fund-house rules differ, and the app never moves money.
 */
import { rowCode, type AccountKind } from './accounts-view';
import { DEFAULT_CONFIG, effectiveRules, type AppConfig } from './config';
import { fdValueOn } from './fd';
import type { AssetRow, FdRow } from './portfolio';
import type { ValuedAsset } from './networth';
import { RULES, type TaxRuleSet } from './tax';
import { KIND_LABEL, LIQUIDITY_KINDS, type LiquidityKind } from './liquidity-kinds';

export { KIND_LABEL, LIQUIDITY_KINDS, type LiquidityKind };

export interface FundForRaise {
  assetId: string;
  invested: number;
  startedOn: string | null;
  sipActive: boolean;
}

export interface RaiseSource {
  /** an asset appears once per way of getting at it; only one way can be used */
  assetId: string;
  kind: LiquidityKind;
  name: string;
  /** the bank or institution holding it */
  bank: string;
  /** the sheet-style account code, e.g. FD-NRE-5076 */
  code: string;
  /** for a deposit: the savings account its money is paid into */
  creditTo: string | null;
  ownerId: string;
  joint: boolean;
  /** most that can be taken out (gross, in rupees) */
  max: number;
  availableOn: string;
  divisible: boolean;
  /** share of the amount lost to a fixed cost (interest lost, selling costs) */
  fixedCostRate: number;
  /** present for funds and shares */
  sale?: { gainRatio: number; long: boolean; estimated: boolean; exitLoad: number };
  steps: string[];
  notes: string[];
}

export interface RaiseBuildInput {
  valued: ValuedAsset[];
  assetRows: AssetRow[];
  fds: FdRow[];
  funds: FundForRaise[];
  today: string;
  institutionNames?: Record<string, string>;
  rules?: TaxRuleSet[];
  config?: AppConfig['liquidity'];
  nri?: boolean;
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function addWorkingDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

const monthsBack = (iso: string, m: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString().slice(0, 10);
};
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Turns holdings into sources. Assets without a usable value, and policies, are left out. */
export function buildSources(input: RaiseBuildInput): RaiseSource[] {
  const cfg = input.config ?? DEFAULT_CONFIG.liquidity;
  const today = input.today;
  const eff = effectiveRules(today, input.rules ?? RULES)?.rules ?? null;
  const rowOf = new Map(input.assetRows.map((a) => [a.id, a]));
  const fdOf = new Map(input.fds.map((f) => [f.asset_id, f]));
  const fundOf = new Map(input.funds.map((f) => [f.assetId, f]));
  const out: RaiseSource[] = [];

  for (const v of input.valued) {
    const row = rowOf.get(v.assetId);
    const value = v.estimate?.estimatedAmount ?? 0;
    if (!row || value <= 0) continue;
    const bank = row.institution_id
      ? (input.institutionNames?.[row.institution_id] ?? 'Other')
      : 'Other holdings';
    const fdRow = fdOf.get(v.assetId);
    const code = rowCode({
      type: row.type,
      label: row.label ?? null,
      kind: (row.account_kind === 'NRE' || row.account_kind === 'NRO'
        ? row.account_kind
        : null) as AccountKind | null,
      joint: !!row.is_joint,
      last4: fdRow?.fd_ref_last4 ?? row.identifier_last4 ?? null,
      currency: row.currency,
    });
    const linked = row.linked_last4
      ? input.assetRows.find(
          (a) =>
            a.type === 'bank_account' &&
            a.institution_id === row.institution_id &&
            a.identifier_last4 === row.linked_last4,
        )
      : undefined;
    const creditTo = linked
      ? `${bank} ${rowCode({
          type: linked.type,
          label: linked.label ?? null,
          kind: (linked.account_kind === 'NRE' || linked.account_kind === 'NRO'
            ? linked.account_kind
            : null) as AccountKind | null,
          joint: !!linked.is_joint,
          last4: linked.identifier_last4 ?? null,
          currency: linked.currency,
        })}`
      : null;
    const base = {
      assetId: v.assetId,
      name: v.name,
      bank,
      code,
      creditTo,
      ownerId: v.ownerId,
      joint: !!row.is_joint,
    };
    const into = creditTo ?? 'the linked savings account';
    const countedStatus = v.status === 'active' || v.status === 'stopped';

    if (v.type === 'bank_account' && countedStatus) {
      const usable = value - cfg.keepInBank;
      if (usable <= 0) continue;
      const foreign = row.currency !== 'INR';
      const kind = row.account_kind ? ` (${row.account_kind})` : '';
      out.push({
        ...base,
        kind: 'cash',
        max: usable,
        availableOn: addDays(today, foreign ? cfg.foreignCashDays : 0),
        divisible: true,
        fixedCostRate: 0,
        steps: [
          `Transfer {amt} out of ${bank} ${code}${kind && !code.includes(row.account_kind ?? '') ? kind : ''}${foreign ? ', converting from ' + row.currency : ''}, to the account you need it in.`,
        ],
        notes: [
          `${inr(cfg.keepInBank)} is left in the account (Settings).`,
          ...(row.account_kind === 'NRE'
            ? ['NRE balances can be moved freely, in India or abroad.']
            : []),
          ...(row.account_kind === 'NRO'
            ? [
                'Sending NRO money abroad is limited per year and needs a form; spending it in India is free.',
              ]
            : []),
        ],
      });
      continue;
    }

    if (v.type === 'fixed_deposit') {
      const fd = fdOf.get(v.assetId);
      if (!fd) continue;
      const matured = fd.maturity_on <= today;
      const atMaturity =
        fd.bank_maturity_amount ??
        fdValueOn({
          principal: fd.principal,
          annualRate: fd.rate,
          bookedOn: utc(fd.booked_on),
          asOf: utc(fd.maturity_on),
          maturityOn: utc(fd.maturity_on),
          compounding: fd.compounding,
        });
      if (!countedStatus && !(v.status === 'matured' || matured)) continue;
      if (matured || v.status === 'matured') {
        out.push({
          ...base,
          kind: 'fd_maturing',
          max: Math.max(value, atMaturity),
          availableOn: today,
          divisible: false,
          fixedCostRate: 0,
          steps: [
            `${bank} ${code} has matured (about {amt}): ask for it to be paid into ${into} and do not renew it.`,
          ],
          notes: [
            'Confirm the credit with the bank; the record is not updated until you confirm it.',
          ],
        });
        continue;
      }
      out.push({
        ...base,
        kind: 'fd_maturing',
        max: Math.max(value, atMaturity),
        availableOn: fd.maturity_on,
        divisible: false,
        fixedCostRate: 0,
        steps: [
          `Let ${bank} ${code} mature on ${fd.maturity_on} (about {amt}) and do not renew it. It is paid into ${into}.`,
        ],
        notes: ['No penalty: the money arrives on the maturity date.'],
      });
      const heldDays = Math.max(
        0,
        (utc(today).getTime() - utc(fd.booked_on).getTime()) / 86_400_000,
      );
      const years = heldDays / 365;
      const early = fdValueOn({
        principal: fd.principal,
        annualRate: Math.max(0, fd.rate - cfg.fdPenaltyPoints),
        bookedOn: utc(fd.booked_on),
        asOf: utc(today),
        maturityOn: utc(fd.maturity_on),
        compounding: fd.compounding,
      });
      const received = Math.min(value, early);
      out.push({
        ...base,
        kind: 'fd_break',
        max: value,
        availableOn: addDays(today, cfg.fdBreakDays),
        divisible: cfg.fdPartialBreak,
        fixedCostRate: value > 0 ? Math.max(0, (value - received) / value) : 0,
        steps: [
          `Break ${bank} ${code} early ({amt}) through net banking, the branch or phone banking, and ask for the money to go to ${into}.`,
        ],
        notes: [
          `Held ${heldDays < 1 ? 'under a day' : Math.round(heldDays) + ' days'}; about ${inr(value - received)} of interest is lost to the early-break rate (${(cfg.fdPenaltyPoints * 100).toFixed(2)} points lower).`,
          ...(years < 7 / 365
            ? ['Many banks pay no interest on a deposit broken within 7 days.']
            : []),
          ...(cfg.fdPartialBreak
            ? []
            : [
                'The whole deposit is used; anything beyond what you need returns to the savings account.',
              ]),
        ],
      });
      continue;
    }

    if ((v.type === 'mutual_fund' || v.type === 'stock') && countedStatus) {
      const fund = fundOf.get(v.assetId);
      const longMonths = eff?.equity.holdingMonthsLong ?? 12;
      const knownCost = fund && fund.invested > 0;
      const gainRatio = knownCost
        ? Math.max(0, (value - fund.invested) / value)
        : cfg.assumedGainShare;
      const long =
        !!fund?.startedOn && fund.startedOn <= monthsBack(today, longMonths) && !fund.sipActive;
      const isFund = v.type === 'mutual_fund';
      out.push({
        ...base,
        kind: isFund ? 'mf' : 'stock',
        max: value,
        availableOn: addWorkingDays(today, isFund ? cfg.mfSettlementDays : cfg.stockSettlementDays),
        divisible: true,
        fixedCostRate: 0,
        sale: {
          gainRatio,
          long,
          estimated: !knownCost,
          exitLoad: long || !isFund ? 0 : cfg.exitLoadPct,
        },
        steps: [
          isFund
            ? `Redeem {amt} of ${v.name}${bank !== 'Other' && bank !== 'Other holdings' ? ' on ' + bank : ''}; the money reaches your bank in about ${cfg.mfSettlementDays} working days.`
            : `Sell {amt} of ${v.name}${bank !== 'Other' && bank !== 'Other holdings' ? ' on ' + bank : ''}; the money reaches your bank about ${cfg.stockSettlementDays} working days after the trade.`,
        ],
        notes: [
          ...(knownCost
            ? []
            : ['Cost price not recorded: gain is assumed (Settings), so tax is a rough figure.']),
          ...(fund?.sipActive
            ? [
                'An active SIP means some units are recent and taxed as short-term; this is assumed for all of them.',
              ]
            : []),
          ...(!fund?.startedOn && isFund
            ? ['First purchase date unknown: treated as short-term.']
            : []),
        ],
      });
      continue;
    }

    if (v.type === 'receivable' && countedStatus) {
      out.push({
        ...base,
        kind: 'receivable',
        max: value,
        availableOn: addDays(today, cfg.receivableDays),
        divisible: false,
        fixedCostRate: 0,
        steps: [`Ask for {amt} owed to you (${v.name}) to be repaid.`],
        notes: ['Timing depends on the borrower; the date is only an estimate.'],
      });
      continue;
    }

    if (v.type === 'property' && countedStatus) {
      out.push({
        ...base,
        kind: 'property',
        max: value,
        availableOn: addDays(today, cfg.propertySaleDays),
        divisible: false,
        fixedCostRate: cfg.propertyCostPct,
        steps: [
          `Sell ${v.name} (about {amt} after costs). This takes months and is the last resort.`,
        ],
        notes: [
          `Selling costs are assumed at ${(cfg.propertyCostPct * 100).toFixed(1)}%. As a non-resident, tax is withheld on the sale; get an adviser's figure before listing.`,
        ],
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Costs of a sale
// ------------------------------------------------------------------------------------------------
interface TaxCtx {
  stcg: number;
  ltcg: number;
  exemption: number;
  cess: number;
  nri: boolean;
}

interface Cost {
  /** what the money costs you in the end: interest lost, exit load, tax after the refund */
  cost: number;
  /** arrives in the bank */
  cashIn: number;
  /** withheld by the fund house or broker now and recovered when you file */
  tdsNow: number;
  refundLater: number;
  usedAllowance: number;
}

function costOf(s: RaiseSource, gross: number, room: number, t: TaxCtx): Cost {
  if (!s.sale) {
    const cost = gross * s.fixedCostRate;
    return { cost, cashIn: gross - cost, tdsNow: 0, refundLater: 0, usedAllowance: 0 };
  }
  const gain = gross * s.sale.gainRatio;
  const load = gross * s.sale.exitLoad;
  const rate = (s.sale.long ? t.ltcg : t.stcg) * (1 + t.cess);
  const taxable = s.sale.long ? Math.max(0, gain - room) : gain;
  const tax = taxable * rate;
  const tds = t.nri ? gain * rate : 0;
  return {
    cost: load + tax,
    cashIn: gross - load - tds,
    tdsNow: tds,
    refundLater: Math.max(0, tds - tax),
    usedAllowance: s.sale.long ? Math.min(gain, room) : 0,
  };
}

export interface RaisePick {
  assetId: string;
  kind: LiquidityKind;
  name: string;
  bank: string;
  code: string;
  creditTo: string | null;
  ownerId: string;
  /** taken out of the holding */
  gross: number;
  /** reaches the bank */
  cashIn: number;
  /** true cost: interest lost, exit load, tax */
  cost: number;
  tdsNow: number;
  refundLater: number;
  availableOn: string;
  /** part of the unused tax-free allowance used */
  usedAllowance: number;
  steps: string[];
  notes: string[];
}

export interface RaisePlan {
  label: string;
  /** null = no deadline */
  days: number | null;
  deadline: string | null;
  picks: RaisePick[];
  cashIn: number;
  cost: number;
  refundLater: number;
  /** money arrives in full by this date */
  completeBy: string | null;
  shortfall: number;
  /** more than needed, because a whole deposit is used; it stays in your account */
  surplus: number;
  feasible: boolean;
}

export interface PlanOptions {
  /** kinds allowed, in order of preference */
  order?: LiquidityKind[];
  mode?: AppConfig['liquidity']['mode'];
  /** only these people's money (joint accounts count for both); null = whole household */
  ownerId?: string | null;
  /** tax-free allowance already used this year, by person */
  allowanceUsed?: Record<string, number>;
  rules?: TaxRuleSet[];
  nri?: boolean;
  today: string;
}

function taxCtx(o: PlanOptions): { ctx: TaxCtx; exemption: number } {
  const eff = effectiveRules(o.today, o.rules ?? RULES)?.rules ?? null;
  return {
    ctx: {
      stcg: eff?.equity.stcgRate ?? 0,
      ltcg: eff?.equity.ltcgRate ?? 0,
      exemption: eff?.equity.ltcgExemption ?? 0,
      cess: eff?.cess ?? 0,
      nri: o.nri ?? true,
    },
    exemption: eff?.equity.ltcgExemption ?? 0,
  };
}

/** One plan: the cheapest (or fastest, or preferred) way to get `need` into the bank by `days` from today. */
export function planRaise(
  need: number,
  sources: RaiseSource[],
  days: number | null,
  o: PlanOptions,
  label?: string,
): RaisePlan {
  const order = o.order ?? [...DEFAULT_CONFIG.liquidity.order];
  const mode = o.mode ?? DEFAULT_CONFIG.liquidity.mode;
  const { ctx } = taxCtx(o);
  const deadline = days === null ? null : addDays(o.today, days);
  const room: Record<string, number> = {};
  const roomOf = (owner: string) => {
    if (room[owner] === undefined)
      room[owner] = Math.max(0, ctx.exemption - (o.allowanceUsed?.[owner] ?? 0));
    return room[owner]!;
  };
  const pool = sources.filter(
    (s) =>
      order.includes(s.kind) &&
      (deadline === null || s.availableOn <= deadline) &&
      (!o.ownerId || s.ownerId === o.ownerId || s.joint),
  );
  const used = new Set<string>();
  const picks: RaisePick[] = [];
  let remaining = need;
  let rawCash = 0;
  while (remaining > 0.5) {
    let best: { s: RaiseSource; rate: number } | null = null;
    for (const s of pool) {
      if (used.has(s.assetId)) continue;
      const probe = Math.min(s.max, remaining * 1.5);
      const c = costOf(s, probe, roomOf(s.ownerId), ctx);
      const rate = probe > 0 ? c.cost / probe : 0;
      const cand = { s, rate };
      if (!best) {
        best = cand;
        continue;
      }
      const rank = (x: { s: RaiseSource; rate: number }) =>
        mode === 'order'
          ? [order.indexOf(x.s.kind), Math.round(x.rate * 1e6), x.s.availableOn, -x.s.max]
          : mode === 'fastest'
            ? [x.s.availableOn, Math.round(x.rate * 1e6), -x.s.max]
            : [Math.round(x.rate * 1e6), x.s.availableOn, -x.s.max];
      const a = rank(cand);
      const b = rank(best);
      for (let i = 0; i < a.length; i++) {
        if (a[i]! < b[i]!) {
          best = cand;
          break;
        }
        if (a[i]! > b[i]!) break;
      }
    }
    if (!best) break;
    const s = best.s;
    let gross = s.max;
    if (s.divisible) {
      gross = Math.min(s.max, remaining);
      for (let i = 0; i < 4; i++) {
        const c = costOf(s, gross, roomOf(s.ownerId), ctx);
        if (c.cashIn <= 0) break;
        gross = Math.min(s.max, gross * (remaining / c.cashIn));
      }
    }
    const c = costOf(s, gross, roomOf(s.ownerId), ctx);
    room[s.ownerId] = roomOf(s.ownerId) - c.usedAllowance;
    used.add(s.assetId);
    remaining -= c.cashIn;
    rawCash += c.cashIn;
    picks.push({
      assetId: s.assetId,
      kind: s.kind,
      name: s.name,
      bank: s.bank,
      code: s.code,
      creditTo: s.creditTo,
      ownerId: s.ownerId,
      gross: Math.round(gross),
      cashIn: Math.round(c.cashIn),
      cost: Math.round(c.cost),
      tdsNow: Math.round(c.tdsNow),
      refundLater: Math.round(c.refundLater),
      availableOn: s.availableOn,
      usedAllowance: Math.round(c.usedAllowance),
      steps: s.steps.map((t) => t.replace(/\{amt\}/g, inr(gross))),
      notes: [
        ...s.notes,
        ...(c.tdsNow > 0
          ? [
              `${inr(c.tdsNow)} is withheld at source now${c.refundLater > 0 ? `; about ${inr(c.refundLater)} comes back when you file` : ''}.`,
            ]
          : []),
        ...(c.usedAllowance > 0
          ? [
              `Uses ${inr(c.usedAllowance)} of this year's tax-free gain allowance, so it also counts as harvesting.`,
            ]
          : []),
      ],
    });
  }
  picks.sort((a, b) => a.availableOn.localeCompare(b.availableOn));
  const cashIn = Math.round(rawCash);
  const shortfall = need - rawCash < 1 ? 0 : Math.round(need - rawCash);
  return {
    label: label ?? (days === null ? 'No deadline' : days === 0 ? 'Today' : `Within ${days} days`),
    days,
    deadline,
    picks,
    cashIn,
    cost: picks.reduce((x, p) => x + p.cost, 0),
    refundLater: picks.reduce((x, p) => x + p.refundLater, 0),
    completeBy: picks.length ? picks[picks.length - 1]!.availableOn : null,
    shortfall,
    surplus: Math.max(0, Math.round(rawCash - need)),
    feasible: shortfall === 0,
  };
}

export interface RaiseAnswer {
  need: number;
  plans: RaisePlan[];
  /** the cheapest way when time does not matter */
  cheapest: RaisePlan;
  /** the fastest way, whatever it costs */
  fastest: RaisePlan;
  /** money that could reach the bank by each date, ignoring the amount asked for */
  capacity: { days: number; label: string; date: string; available: number }[];
}

const dayLabel = (d: number) => (d === 0 ? 'Today' : `Within ${d} days`);

/** What can be had by each deadline, plus the cheapest and fastest ways. */
export function answerRaise(
  need: number,
  sources: RaiseSource[],
  o: PlanOptions & { scenarioDays?: number[] },
): RaiseAnswer {
  const horizons = o.scenarioDays && o.scenarioDays.length ? o.scenarioDays : [0, 3, 14, 45, 120];
  const order = o.order ?? [...DEFAULT_CONFIG.liquidity.order];
  const { ctx } = taxCtx(o);
  const best = new Map<string, number>();
  const capacity = horizons.map((d) => {
    const date = addDays(o.today, d);
    best.clear();
    for (const s of sources) {
      if (!order.includes(s.kind) || s.availableOn > date) continue;
      if (o.ownerId && s.ownerId !== o.ownerId && !s.joint) continue;
      const c = costOf(
        s,
        s.max,
        Math.max(0, ctx.exemption - (o.allowanceUsed?.[s.ownerId] ?? 0)),
        ctx,
      );
      best.set(s.assetId, Math.max(best.get(s.assetId) ?? 0, c.cashIn));
    }
    return {
      days: d,
      label: dayLabel(d),
      date,
      available: Math.round([...best.values()].reduce((a, b) => a + b, 0)),
    };
  });
  return {
    need,
    plans: horizons.map((d) => planRaise(need, sources, d, o, dayLabel(d))),
    cheapest: planRaise(need, sources, null, { ...o, mode: 'cheapest' }, 'Cheapest, no deadline'),
    fastest: planRaise(need, sources, null, { ...o, mode: 'fastest' }, 'Fastest'),
    capacity,
  };
}

// ------------------------------------------------------------------------------------------------
// Hard need: the money must be had, whatever it costs
// ------------------------------------------------------------------------------------------------
export interface Tranche {
  date: string;
  label: string;
  picks: RaisePick[];
  cashIn: number;
  /** total in the bank once this tranche has arrived */
  cumulative: number;
}

export interface HardAnswer {
  need: number;
  /** date the money was asked for by, if any */
  by: string | null;
  /** earliest date the whole amount can be in the bank, using every source; null if it cannot be found at all */
  earliest: string | null;
  /** the asked-for date cannot be met; the plan is the best that can be done */
  deadlineMissed: boolean;
  /** the cheapest way to have it by the target date, every kind of source allowed */
  plan: RaisePlan;
  tranches: Tranche[];
  /** a cheaper plan that needs more time (your preferences, no deadline), if there is one */
  cheaperIfWaiting: RaisePlan | null;
}

const daysBetweenIso = (a: string, b: string) =>
  Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

/**
 * "I must have it": every kind of source is allowed, deposits may be broken, property may be sold. The money is
 * brought in as soon as possible, and among the ways of finishing by then the cheapest is chosen. With `byDays`,
 * the cheapest way to finish by that date; if that date cannot be met, the quickest possible is shown instead.
 */
export function answerHard(
  need: number,
  sources: RaiseSource[],
  o: PlanOptions & { preferenceOrder?: LiquidityKind[] },
  byDays: number | null,
): HardAnswer {
  const all: LiquidityKind[] = [...LIQUIDITY_KINDS];
  const hard: PlanOptions = { ...o, order: all, mode: 'cheapest' };
  const { ctx } = taxCtx(o);
  const pool = sources.filter((s) => !o.ownerId || s.ownerId === o.ownerId || s.joint);
  const capacityOn = (date: string) => {
    const best = new Map<string, number>();
    for (const s of pool) {
      if (s.availableOn > date) continue;
      const c = costOf(
        s,
        s.max,
        Math.max(0, ctx.exemption - (o.allowanceUsed?.[s.ownerId] ?? 0)),
        ctx,
      );
      best.set(s.assetId, Math.max(best.get(s.assetId) ?? 0, c.cashIn));
    }
    return [...best.values()].reduce((a, b) => a + b, 0);
  };
  const dates = [...new Set(pool.map((s) => s.availableOn))].sort();
  const earliest = dates.find((d) => capacityOn(d) >= need - 0.5) ?? null;
  const by = byDays === null ? null : addDays(o.today, byDays);
  const deadlineMissed = by !== null && (earliest === null || earliest > by);
  const target = by !== null && !deadlineMissed ? by : earliest;
  const plan =
    target === null
      ? planRaise(need, sources, null, { ...hard, mode: 'fastest' }, 'As much as can be found')
      : planRaise(
          need,
          sources,
          daysBetweenIso(o.today, target),
          hard,
          deadlineMissed ? 'Quickest possible' : by ? `By ${by}` : 'As soon as possible',
        );
  const groups = new Map<string, RaisePick[]>();
  for (const p of plan.picks) groups.set(p.availableOn, [...(groups.get(p.availableOn) ?? []), p]);
  let running = 0;
  const tranches: Tranche[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, picks]) => {
      const cashIn = picks.reduce((x, p) => x + p.cashIn, 0);
      running += cashIn;
      const d = daysBetweenIso(o.today, date);
      return {
        date,
        label: d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`,
        picks,
        cashIn,
        cumulative: running,
      };
    });
  const waiting = planRaise(
    need,
    sources,
    null,
    {
      ...o,
      order: o.preferenceOrder ?? o.order ?? [...DEFAULT_CONFIG.liquidity.order],
      mode: 'cheapest',
    },
    'If you can wait',
  );
  const cheaperIfWaiting =
    waiting.feasible &&
    plan.completeBy !== null &&
    waiting.completeBy !== null &&
    waiting.completeBy > plan.completeBy &&
    waiting.cost < plan.cost - 1
      ? waiting
      : null;
  return { need, by, earliest, deadlineMissed, plan, tranches, cheaperIfWaiting };
}
