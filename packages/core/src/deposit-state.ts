/**
 * What a fixed deposit whose date has passed means, in one place. Pure: dates are YYYY-MM-DD text, "today" is the app's today.
 *
 * Two questions, one answer each:
 *  - Is its money still counted? Only while the deposit is running, and a deposit maturing TODAY still counts until tomorrow.
 *    Once the date has passed the money has left the deposit: it went into a savings account or another deposit, which are counted
 *    on their own. So an active deposit past its date is valued as "matured, not confirmed" and is left out of every total.
 *  - Is it shown in the lists? Within the window (Settings: deposits.hideMaturedAfterDays) a deposit that matured and was not
 *    confirmed stays, with a "Confirm matured" action; a confirmed one, or one whose date is older than the window, is hidden
 *    (a link on the page shows it again, so nothing is lost).
 */

import { isoDaysBetween } from './automation';
import { DEFAULT_CONFIG } from './config';

/** Statuses that say the person already settled the deposit: it left the lists at once. */
const SETTLED = new Set(['matured', 'renewed', 'closed']);

export type DepositListState = 'show' | 'confirm' | 'hidden';

/** The deposit's date has passed: from the day after it matured. A deposit maturing today has not passed yet. */
export function isPastMaturity(maturityOn: string, today: string): boolean {
  return maturityOn.slice(0, 10) < today.slice(0, 10);
}

/**
 * The status to value a deposit with. An "active" deposit whose maturity date is before today is "matured_unconfirmed": it is not
 * counted in net worth or any total, and it stays on the needs-you list until the person confirms it.
 */
export function effectiveDepositStatus(status: string, maturityOn: string, today: string): string {
  return status === 'active' && isPastMaturity(maturityOn, today) ? 'matured_unconfirmed' : status;
}

/** A deposit that is waiting to be confirmed: the status says so, or it is running on paper but its date has passed. */
export function isAwaitingConfirmation(status: string, maturityOn: string, today: string): boolean {
  return effectiveDepositStatus(status, maturityOn, today) === 'matured_unconfirmed';
}

export interface DepositListInput {
  status: string;
  maturityOn: string;
  /** the day a deposit that is no longer held left (the History import writes it); null: its maturity date is used */
  endedOn?: string | null;
  today: string;
  /** Settings: deposits.hideMaturedAfterDays */
  hideAfterDays: number;
}

/**
 * Whether a deposit is listed:
 *  - "hidden": confirmed matured, renewed or closed; or its end date (the day it ended, else its maturity date) is MORE than
 *    `hideAfterDays` days before today, whatever its status. Exactly N days ago is still listed.
 *  - "confirm": it matured (or is marked matured, not confirmed) within the window and nobody has confirmed it.
 *  - "show": anything else.
 */
export function depositListState(i: DepositListInput): DepositListState {
  if (SETTLED.has(i.status)) return 'hidden';
  const end = (i.endedOn ?? i.maturityOn).slice(0, 10);
  if (isoDaysBetween(end, i.today) > i.hideAfterDays) return 'hidden';
  return isAwaitingConfirmation(i.status, i.maturityOn, i.today) ? 'confirm' : 'show';
}

/**
 * The rule in plain words, for the "?" explainers: when a deposit stops being counted and when it leaves the lists. The number of
 * days is the Setting; the built-in value is named so the sentence reads on its own.
 */
export function maturedRuleText(
  hideAfterDays: number = DEFAULT_CONFIG.deposits.hideMaturedAfterDays,
): string {
  return `A deposit is counted until its maturity date (one maturing today still counts). After that its money has gone into a savings account or a new deposit, which are counted on their own, so it is left out of every total. It stays on the Accounts list for ${hideAfterDays} days (Settings > Deposits > “Hide a matured deposit from the lists after (days)”) with a Confirm matured button; once confirmed, or older than that, it is hidden, and Show matured brings it back.`;
}
