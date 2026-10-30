/* eslint-disable no-console */
/**
 * Deposits the bank statements show (a booking and a pay-back with the same deposit number) that the portal has no record of
 * (core statement-deposits.ts). MODE=plan lists them, with any deposit on file of the same person at the same bank whose dates
 * overlap (a record from the diary or the workbook that may be the same money); MODE=apply adds them as matured deposits and
 * rebuilds the movements, so both lines are explained. Run by hand (Actions > Deposits from statements). Prints dates, deposit
 * numbers' last four digits and ratios, never an amount.
 */
import { depositsFromStatements, type DepositLine } from '@fwos/core';
import { historyIo, loadMoneyTrail, loadPortfolioData, rebuildStatementMoves } from '@fwos/data';
import { connectDb, householdId, must } from './shared';

async function main() {
  const write = process.env.MODE === 'apply';
  const db = connectDb();
  const hh = await householdId(db);
  const loaded = await loadPortfolioData(db, { householdId: hh });
  const t = await loadMoneyTrail(db, hh, loaded);
  const asset = new Map(loaded.assetRows.map((a) => [a.id, a]));
  const bankOf = (id: string) => {
    const inst = asset.get(id)?.institution_id;
    return inst ? (loaded.institutionName?.get(inst) ?? null) : null;
  };
  const name = (id: string) => {
    const a = asset.get(id);
    return a
      ? [
          bankOf(id),
          a.account_kind,
          a.identifier_last4 ? `…${a.identifier_last4}` : null,
          loaded.ownerName.get(a.owner_id),
        ]
          .filter(Boolean)
          .join(' ')
      : '(not on file)';
  };

  // the deposit lines no deposit on file explains
  const unexplained = (cls: string): DepositLine[] =>
    t.lines
      .filter((l) => {
        const c = t.classified.get(l.id);
        return c?.cls === cls && !c.counterpart;
      })
      .map((l) => ({
        id: l.id,
        assetId: l.asset_id,
        date: l.txn_on,
        amount: l.amount,
        narration: l.narration,
      }));
  const bookings = unexplained('fd_funding');
  const paybacks = unexplained('fd_proceeds');
  const last4 = new Map(loaded.assetRows.map((a) => [a.id, a.identifier_last4 ?? null]));
  const found = depositsFromStatements(bookings, paybacks, last4);
  console.log(
    `Deposit lines no deposit on file explains: ${bookings.length} bookings, ${paybacks.length} pay-backs. Pairs found: ${found.length}`,
  );

  const fds = loaded.fdRows;
  const fdAsset = (id: string) => asset.get(id);
  const toAdd: typeof found = [];
  for (const d of found) {
    const acct = asset.get(d.accountId)!;
    const bank = bankOf(d.accountId);
    // deposits on file of the same person at the same bank: the same number, or dates that overlap
    const same = fds.filter((f) => {
      const a = fdAsset(f.asset_id);
      return a && a.owner_id === acct.owner_id && bankOf(f.asset_id) === bank;
    });
    const sameNumber = same.find((f) => f.fd_ref_last4 === d.last4);
    const overlap = same.filter((f) => {
      const end = f.ended_on ?? f.maturity_on;
      return f.booked_on <= d.endedOn && end >= d.bookedOn && f.fd_ref_last4 !== d.last4;
    });
    console.log(
      `- ${name(d.accountId)}: FD …${d.last4} booked ${d.bookedOn}, paid back ${d.endedOn} (${d.paybackLineIds.length} line${d.paybackLineIds.length === 1 ? '' : 's'}), back ${(d.paidBack / d.principal).toFixed(3)}× the principal, ${(d.rate * 100).toFixed(2)}% a year${sameNumber ? ' — already on file with this number (dates differ); not added' : ''}`,
    );
    for (const f of overlap)
      console.log(
        `    on file, dates overlap: ${name(f.asset_id).replace(/^/, 'FD ')} booked ${f.booked_on} ends ${f.ended_on ?? f.maturity_on}, ${(Number(f.principal) / d.principal).toFixed(2)}× this one's principal${fdAsset(f.asset_id)?.status === 'merged' ? ' (merged)' : ''}`,
      );
    if (!sameNumber) toAdd.push(d);
  }
  if (!write) {
    console.log(
      `Plan only: ${toAdd.length} deposits would be added. Run again with mode "apply" to add them.`,
    );
    return;
  }

  const io = historyIo(db, hh);
  let added = 0;
  for (const d of toAdd) {
    const acct = asset.get(d.accountId)!;
    const r = await io.createAsset({
      type: 'fixed_deposit',
      ownerName: loaded.ownerName.get(acct.owner_id) ?? '',
      bank: bankOf(d.accountId),
      nickname: `FD …${d.last4}`,
      label: `FD …${d.last4} (from the statements)`,
      accountKind: (acct.account_kind as 'NRE' | 'NRO' | null) ?? null,
      joint: !!acct.is_joint,
      last4: d.last4,
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
      console.log(`  FD …${d.last4} (${d.bookedOn}) could not be added: ${r.error}`);
      continue;
    }
    // the dates are the bank's own, not estimates
    const id = (r as { id: string }).id;
    must(
      await db
        .from('fixed_deposits')
        .update({ ended_estimated: false, fd_ref_last4: d.last4 })
        .eq('asset_id', id)
        .eq('household_id', hh)
        .select('asset_id'),
      'deposit dates',
    );
    added++;
  }
  console.log(`Added ${added} deposits.`);
  const rb = await rebuildStatementMoves(db, hh);
  console.log(
    `Movements from statements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}`,
  );
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
