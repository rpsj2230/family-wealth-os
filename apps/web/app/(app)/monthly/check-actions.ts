'use server';

import type { AccountCheck } from '@fwos/data';
import { loadAccountChecks } from '@/lib/account-checks';

/**
 * Each account's check for Monthly update, asked for once the page is on screen: sorting every statement line takes a moment, and
 * the grid is usable before it arrives (the hints and Check buttons appear when it does).
 */
export async function accountChecksNow(): Promise<{
  checks: Record<string, AccountCheck>;
  ownNames: string[];
}> {
  return loadAccountChecks();
}
