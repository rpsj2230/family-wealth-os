import { SCENARIOS, type Assumptions, type OneOff, type RetirementPlan } from './retirement';
import type { ValuedAsset } from './networth';

/** What the household chooses (saved in plan_settings). None of this changes any recorded holding. */
export interface PlanSettings {
  primaryDob: string; // YYYY-MM-DD, '' until entered
  spouseDob: string;
  retireAtAge: number;
  planningEndAge: number;
  monthlySpendingToday: number; // 0 until entered
  healthcareShare: number; // 0..1
  extraMonthlyCash: number; // regular saving into FDs/cash on top of SIPs
  extraMonthlyEquity: number; // extra investing beyond current SIPs
  annualStepUp: number; // 0..1
  retirementEquityShare: number; // 0..1
  withdrawalTaxRate: number; // 0..0.5
  legacyToday: number;
  scenario: 'conservative' | 'base' | 'optimistic';
  assumptions: Assumptions;
  oneOffs: OneOff[];
}

export const DEFAULT_SETTINGS: PlanSettings = {
  primaryDob: '',
  spouseDob: '',
  retireAtAge: 60,
  planningEndAge: 95,
  monthlySpendingToday: 0,
  healthcareShare: 0.15,
  extraMonthlyCash: 0,
  extraMonthlyEquity: 0,
  annualStepUp: 0.05,
  retirementEquityShare: 0.5,
  withdrawalTaxRate: 0,
  legacyToday: 0,
  scenario: 'base',
  assumptions: SCENARIOS.base,
  oneOffs: [],
};

/**
 * Dates of birth come from the people profiles in Settings (primary person and spouse). A date saved with the plan is used only
 * when no profile has one, so there is exactly one place to change an age.
 */
export function withPeople(
  s: PlanSettings,
  people: { dob: string | null; plan_role: string | null }[],
): PlanSettings {
  const dob = (role: 'primary' | 'spouse') => people.find((p) => p.plan_role === role)?.dob ?? '';
  return {
    ...s,
    primaryDob: dob('primary') || s.primaryDob,
    spouseDob: dob('spouse') || s.spouseDob,
  };
}

const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d;
const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/** Reads saved JSON defensively: anything missing or out of range falls back to the default, never to a surprising value. */
export function settingsFromJson(raw: unknown): PlanSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const scenario =
    o.scenario === 'conservative' || o.scenario === 'optimistic' || o.scenario === 'base'
      ? o.scenario
      : d.scenario;
  const a = (o.assumptions && typeof o.assumptions === 'object' ? o.assumptions : {}) as Record<
    string,
    unknown
  >;
  const base = SCENARIOS[scenario];
  const oneOffs = Array.isArray(o.oneOffs)
    ? (o.oneOffs as Record<string, unknown>[])
        .map((x) => ({
          label: typeof x.label === 'string' ? x.label.slice(0, 60) : 'One-off cost',
          atAge: num(x.atAge, NaN, 18, 100),
          amountToday: num(x.amountToday, NaN, 0, 1e10),
          ...(typeof x.inflation === 'number' && x.inflation >= 0 && x.inflation < 0.5
            ? { inflation: x.inflation }
            : {}),
        }))
        .filter((x) => Number.isFinite(x.atAge) && Number.isFinite(x.amountToday))
        .slice(0, 30)
    : [];
  return {
    primaryDob: iso(o.primaryDob),
    spouseDob: iso(o.spouseDob),
    retireAtAge: num(o.retireAtAge, d.retireAtAge, 30, 80),
    planningEndAge: num(o.planningEndAge, d.planningEndAge, 60, 110),
    monthlySpendingToday: num(o.monthlySpendingToday, 0, 0, 1e8),
    healthcareShare: num(o.healthcareShare, d.healthcareShare, 0, 1),
    extraMonthlyCash: num(o.extraMonthlyCash, 0, 0, 1e8),
    extraMonthlyEquity: num(o.extraMonthlyEquity, 0, 0, 1e8),
    annualStepUp: num(o.annualStepUp, d.annualStepUp, 0, 0.5),
    retirementEquityShare: num(o.retirementEquityShare, d.retirementEquityShare, 0, 1),
    withdrawalTaxRate: num(o.withdrawalTaxRate, 0, 0, 0.5),
    legacyToday: num(o.legacyToday, 0, 0, 1e11),
    scenario,
    assumptions: {
      equityReturn: num(a.equityReturn, base.equityReturn, 0, 0.3),
      cashReturn: num(a.cashReturn, base.cashReturn, 0, 0.2),
      lockedReturn: num(a.lockedReturn, base.lockedReturn, 0, 0.2),
      inflation: num(a.inflation, base.inflation, 0, 0.25),
      healthcareInflation: num(a.healthcareInflation, base.healthcareInflation, 0, 0.3),
      equityVol: num(a.equityVol, base.equityVol, 0, 0.6),
      cashVol: num(a.cashVol, base.cashVol, 0, 0.2),
      inflationVol: num(a.inflationVol, base.inflationVol, 0, 0.1),
    },
    oneOffs,
  };
}

export interface Holdings {
  cash: number;
  equity: number;
  locked: number;
  /** value deliberately kept out of the retirement corpus, with the reason */
  excluded: { label: string; amount: number }[];
}

/**
 * Which assets can fund retirement spending. Bank balances and FDs -> cash; funds and stocks -> equity; ULIP/NPS -> locked.
 * Property, money lent and money held by others are NOT corpus unless you decide to sell or collect them.
 */
export function holdingsFromAssets(valued: ValuedAsset[]): Holdings {
  const h: Holdings = { cash: 0, equity: 0, locked: 0, excluded: [] };
  const ex: Record<string, number> = {};
  for (const a of valued) {
    if (!a.estimate || !['active', 'stopped'].includes(a.status)) continue;
    const v = a.estimate.estimatedAmount;
    if (a.type === 'bank_account' || a.type === 'fixed_deposit') h.cash += v;
    else if (a.type === 'mutual_fund' || a.type === 'stock') h.equity += v;
    else if (a.type === 'ulip' || a.type === 'nps') h.locked += v;
    else if (
      a.type === 'property' ||
      a.type === 'receivable' ||
      a.type === 'third_party_held' ||
      a.type === 'other'
    ) {
      const label = {
        property: 'Property (not sold)',
        receivable: 'Money lent to others',
        third_party_held: 'Money held by others',
        other: 'Other assets',
      }[a.type];
      ex[label] = (ex[label] ?? 0) + v;
    }
  }
  h.excluded = Object.entries(ex).map(([label, amount]) => ({ label, amount }));
  return h;
}

export function buildPlan(
  s: PlanSettings,
  h: Holdings,
  sipMonthly: number,
  asOf: string,
): RetirementPlan {
  return {
    asOf,
    primaryDob: s.primaryDob,
    spouseDob: s.spouseDob || null,
    retireAtAge: s.retireAtAge,
    planningEndAge: s.planningEndAge,
    holdings: { cash: h.cash, equity: h.equity, locked: h.locked },
    lockedUnlockAge: 60,
    contributions: {
      monthlyEquity: sipMonthly + s.extraMonthlyEquity,
      monthlyCash: s.extraMonthlyCash,
      annualStepUp: s.annualStepUp,
    },
    spending: { monthlyToday: s.monthlySpendingToday, healthcareShare: s.healthcareShare },
    pensions: [],
    oneOffs: s.oneOffs,
    legacyToday: s.legacyToday,
    retirementEquityShare: s.retirementEquityShare,
    withdrawalTaxRate: s.withdrawalTaxRate,
    withdrawalSequence: ['cash', 'equity', 'locked'],
  };
}
