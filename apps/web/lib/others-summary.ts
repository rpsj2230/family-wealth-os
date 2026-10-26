import {
  receivableStatus,
  sourceTag,
  type AssetRow,
  type ObservationRow,
  type SourceTag,
} from '@fwos/core';
import { latestObservations } from './accounts-summary';
import { daysBetweenIso } from './dates';

export interface LoanInput {
  assetId: string;
  counterparty: string;
  ownerId: string | null;
  lent: number;
  lentOn: string | null;
  expectedOn: string | null;
  repayments: { amount: number; on: string }[];
}

export interface LoanLine extends LoanInput {
  repaid: number;
  outstanding: number;
  status: 'outstanding' | 'overdue' | 'settled' | 'overpaid';
  daysOverdue: number;
  /** days until the expected date (negative when it has passed); null when no date is set */
  daysToExpected: number | null;
}

/** One line per loan with what is still owed. Open loans come first, the largest amount owed at the top. */
export function loanLines(loans: LoanInput[], today: string): LoanLine[] {
  const t = new Date(`${today}T00:00:00Z`);
  return loans
    .map((l) => {
      const s = receivableStatus(
        {
          id: l.assetId,
          lent: l.lent,
          repayments: l.repayments.map((r) => ({
            amount: r.amount,
            on: new Date(`${r.on}T00:00:00Z`),
          })),
          expectedOn: l.expectedOn ? new Date(`${l.expectedOn}T00:00:00Z`) : null,
        },
        t,
      );
      return {
        ...l,
        repaid: s.repaid,
        outstanding: s.outstanding,
        status: s.status,
        daysOverdue: s.daysOverdue,
        daysToExpected: l.expectedOn ? daysBetweenIso(today, l.expectedOn) : null,
      } satisfies LoanLine;
    })
    .sort((a, b) => {
      const open = (x: LoanLine) => (x.status === 'settled' || x.status === 'overpaid' ? 1 : 0);
      return open(a) - open(b) || b.outstanding - a.outstanding;
    });
}

export function loanTotals(lines: LoanLine[]) {
  const open = lines.filter((l) => l.status === 'outstanding' || l.status === 'overdue');
  return {
    openCount: open.length,
    owed: open.reduce((s, l) => s + l.outstanding, 0),
    overdueCount: open.filter((l) => l.status === 'overdue').length,
    overdueAmount: open
      .filter((l) => l.status === 'overdue')
      .reduce((s, l) => s + l.outstanding, 0),
    settledCount: lines.filter((l) => l.status === 'settled').length,
  };
}

export type PolicyState = 'none' | 'ok' | 'soon' | 'lapsed';

export interface PolicyDue {
  state: PolicyState;
  /** the date that matters: the next renewal or end date, or the latest one that has already passed */
  on: string | null;
  what: 'renewal' | 'end' | null;
  /** days until it (negative when passed) */
  days: number | null;
}

/**
 * Which date of a policy needs attention. The nearest renewal or end date still to come is used; when both have passed the most
 * recent one is shown as lapsed so the person updates it (after a renewal) or renews the cover. `withinDays` is the reminder
 * window from Settings.
 */
export function policyDue(
  p: { renewalOn: string | null; expiresOn: string | null },
  today: string,
  withinDays: number,
): PolicyDue {
  const dates = [
    ...(p.renewalOn ? [{ on: p.renewalOn, what: 'renewal' as const }] : []),
    ...(p.expiresOn ? [{ on: p.expiresOn, what: 'end' as const }] : []),
  ].map((d) => ({ ...d, days: daysBetweenIso(today, d.on) }));
  if (dates.length === 0) return { state: 'none', on: null, what: null, days: null };
  const upcoming = dates.filter((d) => d.days >= 0).sort((a, b) => a.days - b.days)[0];
  if (upcoming)
    return {
      state: upcoming.days <= withinDays ? 'soon' : 'ok',
      on: upcoming.on,
      what: upcoming.what,
      days: upcoming.days,
    };
  const last = dates.sort((a, b) => b.days - a.days)[0]!;
  return { state: 'lapsed', on: last.on, what: last.what, days: last.days };
}

export const POLICY_KIND: Record<string, string> = {
  term: 'Term life',
  health_sg: 'Health (Singapore)',
  health_in: 'Health (India)',
  ulip: 'ULIP',
  nps: 'NPS',
  other: 'Other',
};

export const policyKindLabel = (k: string) => POLICY_KIND[k] ?? k.replace(/_/g, ' ');

/** Only plain numbers: the form lets people type "₹ 12,50,000". Returns null when it is not a positive amount. */
export function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const HOLDING_KIND: Record<string, string> = {
  property: 'Property',
  nps: 'NPS',
  ulip: 'ULIP and pension plans',
  third_party_held: 'Held by someone else',
  other: 'Other',
};

export interface HoldingLine {
  assetId: string;
  ownerId: string;
  name: string;
  type: string;
  kind: string;
  /** worth in rupees today; null when no value was ever recorded (never counted as zero) */
  value: number | null;
  asOf: string | null;
  source: SourceTag;
  notes: string | null;
}

/** Property, NPS, ULIP and other holdings that are not bank, fund or loan accounts, largest first. */
export function holdingLines(
  assets: AssetRow[],
  obs: ObservationRow[],
  valueInr: Map<string, number | null>,
): HoldingLine[] {
  const latest = latestObservations(obs);
  return assets
    .filter((a) => a.type in HOLDING_KIND && a.status === 'active')
    .map((a) => {
      const o = latest.get(a.id);
      return {
        assetId: a.id,
        ownerId: a.owner_id,
        name: a.label ?? a.nickname,
        type: a.type,
        kind: HOLDING_KIND[a.type]!,
        value: valueInr.get(a.id) ?? null,
        asOf: o?.as_of ?? null,
        source: sourceTag(o?.source ?? null, o?.as_of ?? null, false),
        notes: a.notes ?? null,
      };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}
