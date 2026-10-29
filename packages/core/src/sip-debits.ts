/**
 * The money a SIP takes out of the savings account it is paid from: one debit on each instalment date, for the amount in force that day
 * (the SIP's dated history decides, so a raise, a stop or a pause is followed). The savings estimate takes them off the balance after its
 * last recorded value (savings-accrual.ts ignores anything on or before it), so between bank updates the money is no longer counted both
 * in the account and in the fund. A debit already recorded as a confirmed movement from that account into that fund (a bank statement
 * line) is not added again.
 */
import { addDaysIso } from './harvest-lots';
import { plannedInstalments, type SipPlan } from './estimate';
import type { SavingsTxn } from './savings-accrual';

export interface SipPayer {
  fundId: string;
  /** the savings account the instalments are paid from */
  accountId: string;
  plan: SipPlan;
}

export interface RecordedMove {
  date: string;
  amount: number;
  fromAssetId: string | null;
  toAssetId: string | null;
}

/** Days either side of an instalment date in which a recorded movement of about the same amount is taken to be that instalment. */
export const SIP_MATCH_DAYS = 5;
const SAME_AMOUNT = 0.01;

const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export function sipDebits(
  payers: SipPayer[],
  recorded: RecordedMove[],
  today: string,
): Record<string, SavingsTxn[]> {
  const out: Record<string, SavingsTxn[]> = {};
  for (const p of payers) {
    const after = new Date(`${addDaysIso(p.plan.startedOn, -1)}T00:00:00Z`);
    const until = new Date(`${today}T00:00:00Z`);
    const known = recorded.filter((m) => m.fromAssetId === p.accountId && m.toAssetId === p.fundId);
    for (const i of plannedInstalments(p.plan, after, until)) {
      const seen = known.some(
        (m) =>
          dayGap(m.date, i.date) <= SIP_MATCH_DAYS &&
          Math.abs(m.amount - i.amount) <= i.amount * SAME_AMOUNT,
      );
      if (!seen) (out[p.accountId] ??= []).push({ date: i.date, amount: -i.amount });
    }
  }
  return out;
}

/** Two sets of movements per account as one, oldest first. */
export function mergeSavingsTxns(
  a: Record<string, SavingsTxn[]>,
  b: Record<string, SavingsTxn[]>,
): Record<string, SavingsTxn[]> {
  const out: Record<string, SavingsTxn[]> = {};
  for (const [id, list] of [...Object.entries(a), ...Object.entries(b)])
    (out[id] ??= []).push(...list);
  for (const list of Object.values(out)) list.sort((x, y) => x.date.localeCompare(y.date));
  return out;
}
