/**
 * What follows by itself from the bank statement lines, so nothing is entered by hand: the deposits a booking and its pay-back show
 * (core statement-deposits.ts), and every loan the statements built brought up to date with the lines linked to it. Used by the
 * daily job after the mail has been read (workers/src/digest.ts) and by the hand-run jobs (Actions > Deposits from statements,
 * Statement rules). Both are safe to run again and again: a deposit once on file explains its lines, so it is never found twice, and
 * a loan whose lines have not changed is not written. The log lines carry dates, counts and the last four digits of a deposit
 * number; a loan's totals only when the caller asks for them.
 */
import {
  depositsFromStatements,
  matchDepositRecords,
  type DepositLine,
  type DepositRecord,
  type StatementDeposit,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { historyIo } from './history';
import { loadPortfolioData, type LoadedPortfolio } from './index';
import { loadMoneyTrail } from './trail-store';

type Log = (line: string) => void;
type Trail = Awaited<ReturnType<typeof loadMoneyTrail>>;

/** A loan record the statements built: its notes start so (workers/src/statement-rules.ts). */
export const STATEMENT_LOAN = /^From the bank statements/;
/** said when the loan was recorded: what was owed after the last repayment was forgiven (a gift) */
export const LOAN_FORGIVEN = 'The rest was forgiven (a gift).';
/** said when the loan was recorded: the rest came back outside these statements */
export const LOAN_REPAID_OUTSIDE = 'The rest was paid back outside these statements.';

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

export interface DepositPairing {
  bookings: number;
  paybacks: number;
  /** deposits a booking and its pay-back show */
  found: StatementDeposit[];
  /** of them, those no record on file stands for (added on apply) */
  toAdd: StatementDeposit[];
  matches: ReturnType<typeof matchDepositRecords>['matches'];
  added: number;
  numbered: number;
  kept: number;
}

/**
 * The deposits the statements show that the portal has no record of: added as matured deposits with the bank's own dates; a record
 * on file that is one of them takes its number (and the bank's dates when its own were guessed); a record that stood for several
 * is kept as history, counted nowhere. With write false nothing is written.
 */
export async function pairStatementDeposits(
  db: SupabaseClient,
  hh: string,
  opts: {
    write: boolean;
    /**
     * only deposits whose booking and pay-back print the same deposit number (the daily job): a pair found by its dates and amounts
     * alone waits for the hand-run job, where the plan is read first
     */
    numberedOnly?: boolean;
    loaded?: LoadedPortfolio;
    trail?: Trail;
    log?: Log;
  },
): Promise<DepositPairing> {
  const log = opts.log ?? (() => undefined);
  const loaded = opts.loaded ?? (await loadPortfolioData(db, { householdId: hh }));
  const t = opts.trail ?? (await loadMoneyTrail(db, hh, loaded));
  const asset = new Map(loaded.assetRows.map((a) => [a.id, a]));
  const bankOf = (id: string) => {
    const inst = asset.get(id)?.institution_id;
    return inst ? (loaded.institutionName?.get(inst) ?? null) : null;
  };
  const name = (id: string) => {
    const a = asset.get(id);
    return a
      ? [bankOf(id), a.account_kind, a.identifier_last4 ? `…${a.identifier_last4}` : null]
          .filter(Boolean)
          .join(' ')
      : '(not on file)';
  };
  const asLine = (l: Trail['lines'][number]): DepositLine => ({
    id: l.id,
    assetId: l.asset_id,
    date: l.txn_on,
    amount: l.amount,
    narration: l.narration,
  });
  // the deposit lines no deposit on file explains
  const unexplained = (cls: string) =>
    t.lines
      .filter((l) => {
        const c = t.classified.get(l.id);
        return c?.cls === cls && !c.counterpart;
      })
      .map(asLine);
  const bookings = unexplained('fd_funding');
  const paybacks = unexplained('fd_proceeds');
  const interest = t.lines.filter((l) => t.classified.get(l.id)?.cls === 'fd_interest').map(asLine);
  const last4 = new Map(loaded.assetRows.map((a) => [a.id, a.identifier_last4 ?? null]));
  const keyOf = (id: string) => `${asset.get(id)?.owner_id}|${bankOf(id) ?? ''}`;
  const found = depositsFromStatements(bookings, paybacks, last4, interest)
    .filter((d) => !opts.numberedOnly || d.last4 !== '')
    .map((d) => ({ ...d, key: keyOf(d.accountId) }));
  const fdRow = new Map(loaded.fdRows.map((f) => [f.asset_id, f]));
  const records: DepositRecord[] = loaded.fdRows.map((f) => ({
    id: f.asset_id,
    key: keyOf(f.asset_id),
    principal: Number(f.principal),
    bookedOn: f.booked_on,
    endedOn: f.ended_on ?? f.maturity_on,
    estimated: !!(f.start_estimated || f.ended_estimated),
  }));
  const { matches, rest } = matchDepositRecords(found, records);
  const toAdd = [
    ...rest,
    ...matches.filter((m) => m.deposits.length > 1).flatMap((m) => m.deposits),
  ];
  const out: DepositPairing = {
    bookings: bookings.length,
    paybacks: paybacks.length,
    found,
    toAdd,
    matches,
    added: 0,
    numbered: 0,
    kept: 0,
  };
  if (!opts.write) return out;

  const io = historyIo(db, hh);
  for (const d of toAdd) {
    const acct = asset.get(d.accountId)!;
    const nick = d.last4 ? `FD …${d.last4}` : `FD of ${d.bookedOn}`;
    const r = await io.createAsset({
      type: 'fixed_deposit',
      ownerName: loaded.ownerName.get(acct.owner_id) ?? '',
      bank: bankOf(d.accountId),
      nickname: nick,
      label: `${nick} (from the statements)`,
      accountKind: (acct.account_kind as 'NRE' | 'NRO' | null) ?? null,
      joint: !!acct.is_joint,
      last4: d.last4 || null,
      currency: 'INR',
      holderName: acct.holder_name ?? null,
      status: 'matured',
      notes: `Found on the statement of ${name(d.accountId)}: booked ${d.bookedOn}, paid back ${d.endedOn}. The rate is what grew the principal into what was paid back.`,
      fd: {
        principal: d.principal,
        rate: d.rate,
        bookedOn: d.bookedOn,
        startEstimated: false,
        maturityOn: d.endedOn,
        maturityAmount: d.paidBack,
        ref: null,
        endedOn: d.endedOn,
      },
    });
    if ('error' in r && r.error) {
      log(`  ${nick} (${d.bookedOn}) could not be added: ${r.error}`);
      continue;
    }
    // the dates are the bank's own, not estimates
    must(
      await db
        .from('fixed_deposits')
        .update({ ended_estimated: false, fd_ref_last4: d.last4 || null })
        .eq('asset_id', (r as { id: string }).id)
        .eq('household_id', hh)
        .select('asset_id'),
      'deposit dates',
    );
    out.added++;
  }
  const nums = (ds: { last4: string; bookedOn: string }[]) =>
    ds.map((d) => (d.last4 ? `…${d.last4}` : `of ${d.bookedOn}`)).join(' ');
  for (const m of matches) {
    if (m.deposits.length === 1) {
      const d = m.deposits[0]!;
      const f = fdRow.get(m.recordId)!;
      const change: Record<string, unknown> = {
        fd_ref_last4: d.last4 || null,
        ended_on: d.endedOn,
        ended_estimated: false,
        bank_maturity_amount: d.paidBack,
      };
      if (m.datesFixed)
        Object.assign(change, {
          booked_on: d.bookedOn,
          maturity_on: d.endedOn,
          start_estimated: false,
          ...(d.rate > 0 ? { rate: d.rate } : {}),
        });
      else if (f.maturity_on <= d.bookedOn) change.maturity_on = d.endedOn;
      must(
        await db
          .from('fixed_deposits')
          .update(change)
          .eq('asset_id', m.recordId)
          .eq('household_id', hh)
          .select('asset_id'),
        'deposit record',
      );
      out.numbered++;
    } else {
      // the deposits it stood for are on file now, each with its number: the record stays as history, counted nowhere
      const note = `Stood for ${m.deposits.length} deposits on the statements (${nums(m.deposits)}), now on file one by one.`;
      const prior = asset.get(m.recordId)?.notes;
      must(
        await db
          .from('assets')
          .update({ status: 'merged', notes: prior ? `${prior}\n${note}` : note })
          .eq('id', m.recordId)
          .eq('household_id', hh)
          .select('id'),
        'record kept as history',
      );
      out.kept++;
    }
  }
  return out;
}

export interface LoanSync {
  loans: number;
  /** loans whose repayments or amounts owed were written in this run */
  updated: number;
}

/**
 * Every loan the statements built, brought up to date with the lines now linked to it: what was lent, each repayment, and what was
 * owed after each day (the earlier amounts owed are superseded, never changed). Interest a loan pays is earnings, so it is not a
 * repayment. A loan whose lines are as last written is left alone. `waived`: loans whose rest is forgiven from this run on (the
 * note on the loan keeps it so for later runs).
 */
export async function syncStatementLoans(
  db: SupabaseClient,
  hh: string,
  opts: { loaded?: LoadedPortfolio; trail?: Trail; waived?: Set<string>; log?: Log } = {},
): Promise<LoanSync> {
  const log = opts.log ?? (() => undefined);
  const loaded = opts.loaded ?? (await loadPortfolioData(db, { householdId: hh }));
  const t = opts.trail ?? (await loadMoneyTrail(db, hh, loaded));
  const loans = loaded.assetRows.filter(
    (a) => a.type === 'receivable' && a.status !== 'merged' && STATEMENT_LOAN.test(a.notes ?? ''),
  );
  const res: LoanSync = { loans: loans.length, updated: 0 };
  for (const loan of loans) {
    const linked = t.lines
      .filter((l) => {
        const c = t.classified.get(l.id);
        return c?.cls === 'own_transfer' && c.counterpart === loan.id;
      })
      .sort((a, b) => a.txn_on.localeCompare(b.txn_on));
    if (!linked.length) continue;
    const lent = -linked.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0);
    const back = linked.filter((l) => l.amount > 0);
    const steps: { date: string; owed: number }[] = [];
    let owed = 0;
    for (const l of linked) {
      owed = Math.max(0, Math.round((owed - l.amount) * 100) / 100);
      const last = steps[steps.length - 1];
      if (last && last.date === l.txn_on) last.owed = owed;
      else steps.push({ date: l.txn_on, owed });
    }
    // paid back in full outside the statements, or forgiven: nothing owed after the last line
    const outside = (loan.notes ?? '').includes(LOAN_REPAID_OUTSIDE);
    const forgive = !!opts.waived?.has(loan.id) || (loan.notes ?? '').includes(LOAN_FORGIVEN);
    if ((outside || forgive) && owed > 1) steps[steps.length - 1]!.owed = 0;
    const final = steps[steps.length - 1]!.owed;
    const lakh = (n: number) => `₹${(n / 100_000).toFixed(2)} L`;
    log(
      `  ${loan.nickname}: lent ${lakh(lent)}, paid back ${lakh(back.reduce((s, l) => s + l.amount, 0))} in ${back.length}, still owed ${lakh(final)}${forgive && owed > 1 ? ` (${lakh(owed)} forgiven)` : ''}`,
    );

    // what is on file now: the repayments and amounts owed an earlier run wrote
    const [paid, owedRows] = await Promise.all([
      db
        .from('receivable_payments')
        .select('amount, paid_on')
        .eq('asset_id', loan.id)
        .eq('household_id', hh)
        .like('note', 'From the bank statement%'),
      db
        .from('observations')
        .select('id, amount, as_of')
        .eq('asset_id', loan.id)
        .eq('source', 'statement')
        .is('superseded_by', null),
    ]);
    const paidNow = must(paid, 'repayments') as { amount: number; paid_on: string }[];
    const old = must(owedRows, 'amounts owed') as { id: string; amount: number; as_of: string }[];
    const sig = (xs: { d: string; a: number }[]) =>
      xs
        .map((x) => `${x.d}:${Math.round(Number(x.a) * 100)}`)
        .sort()
        .join(',');
    const same =
      sig(paidNow.map((p) => ({ d: p.paid_on, a: p.amount }))) ===
        sig(back.map((l) => ({ d: l.txn_on, a: l.amount }))) &&
      sig(old.map((o) => ({ d: o.as_of, a: o.amount }))) ===
        sig(steps.map((s) => ({ d: s.date, a: s.owed })));
    const status = final <= Math.max(1, lent * 0.01) ? 'closed' : 'active';
    if (same && status === loan.status) continue;

    if (!same) {
      must(
        await db
          .from('receivables')
          .update({
            lent: Math.max(1, Math.round(lent * 100) / 100),
            lent_on: linked.find((l) => l.amount < 0)?.txn_on ?? null,
          })
          .eq('asset_id', loan.id)
          .eq('household_id', hh)
          .select('asset_id'),
        'loan',
      );
      must(
        await db
          .from('receivable_payments')
          .delete()
          .eq('asset_id', loan.id)
          .eq('household_id', hh)
          .like('note', 'From the bank statement%')
          .select('id'),
        'old repayments',
      );
      if (back.length)
        must(
          await db
            .from('receivable_payments')
            .insert(
              back.map((l) => ({
                household_id: hh,
                asset_id: loan.id,
                amount: l.amount,
                paid_on: l.txn_on,
                note: 'From the bank statement',
              })),
            )
            .select('id'),
          'repayments',
        );
      // the amounts owed: earlier ones from the statements are superseded by these
      const made = must(
        await db
          .from('observations')
          .insert(
            steps.map((s) => ({
              household_id: hh,
              asset_id: loan.id,
              kind: 'valuation',
              amount: s.owed,
              currency: 'INR',
              as_of: s.date,
              source: 'statement',
              source_ref: `loan:${loan.id}:${s.date}:${Date.now()}`,
              confidence: 'verified',
              note:
                forgive && s === steps[steps.length - 1] && owed > 1
                  ? 'The rest was forgiven (a gift)'
                  : 'Still owed, from the bank statements',
            })),
          )
          .select('id'),
        'amounts owed',
      ) as { id: string }[];
      for (const o of old)
        must(
          await db
            .from('observations')
            .update({ superseded_by: made[made.length - 1]!.id })
            .eq('id', o.id)
            .select('id'),
          'earlier amount owed',
        );
    }
    if (status !== loan.status)
      must(
        await db
          .from('assets')
          .update({ status })
          .eq('id', loan.id)
          .eq('household_id', hh)
          .select('id'),
        'loan status',
      );
    res.updated++;
  }
  return res;
}
