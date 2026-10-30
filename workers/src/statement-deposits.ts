/* eslint-disable no-console */
/**
 * Deposits the bank statements show (a booking and a pay-back with the same deposit number) that the portal has no record of
 * (core statement-deposits.ts). MODE=plan lists them, with any deposit on file of the same person at the same bank whose dates
 * overlap (a record from the diary or the workbook that may be the same money); MODE=apply adds them as matured deposits and
 * rebuilds the movements, so both lines are explained. Run by hand (Actions > Deposits from statements). Prints dates, deposit
 * numbers' last four digits and ratios, never an amount.
 */
import { depositNumbers } from '@fwos/core';
import {
  loadMoneyTrail,
  loadPortfolioData,
  pairStatementDeposits,
  rebuildStatementMoves,
} from '@fwos/data';
import { connectDb, householdId } from './shared';

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
  const p = await pairStatementDeposits(db, hh, {
    write,
    loaded,
    trail: t,
    log: (l) => console.log(l),
  });
  console.log(
    `Deposit lines no deposit on file explains: ${p.bookings} bookings, ${p.paybacks} pay-backs. Deposits found: ${p.found.length}`,
  );
  // the lines left unpaired, with the deposit numbers they print: why a booking and its pay-back did not find each other
  if (process.env.SHOW_UNPAIRED === 'true') {
    const last4 = new Map(loaded.assetRows.map((a) => [a.id, a.identifier_last4 ?? null]));
    const pairedIds = new Set(p.found.flatMap((d) => [d.bookingLineId, ...d.paybackLineIds]));
    for (const l of t.lines
      .filter((x) => {
        const c = t.classified.get(x.id);
        return (
          (c?.cls === 'fd_funding' || c?.cls === 'fd_proceeds') &&
          !c.counterpart &&
          !pairedIds.has(x.id)
        );
      })
      .sort((a, b) => a.asset_id.localeCompare(b.asset_id) || a.txn_on.localeCompare(b.txn_on)))
      console.log(
        `  ${l.amount < 0 ? 'booked' : 'paid back'} ${l.txn_on} ${name(l.asset_id)} numbers [${depositNumbers(l.narration, last4.get(l.asset_id) ?? null).join(' ')}] "${l.narration.toLowerCase().replace(/\d/g, '#').slice(0, 60)}"`,
      );
  }

  const fdRow = new Map(loaded.fdRows.map((f) => [f.asset_id, f]));
  const nums = (ds: { last4: string; bookedOn: string }[]) =>
    ds.map((d) => (d.last4 ? `…${d.last4}` : `of ${d.bookedOn}`)).join(' ');
  console.log(`\n== Records on file that are these deposits: ${p.matches.length}`);
  for (const m of p.matches) {
    const f = fdRow.get(m.recordId)!;
    const ds = m.deposits;
    const what =
      ds.length === 1
        ? `takes its number${m.datesFixed ? ' and the bank’s dates' : ''}`
        : `is ${ds.length} deposits: they are added and this record is kept as history (counted nowhere)`;
    console.log(
      `- ${name(m.recordId)} booked ${f.booked_on} ends ${f.ended_on ?? f.maturity_on} (${f.start_estimated || f.ended_estimated ? 'dates guessed' : 'dates on file'}) ← ${nums(ds)} booked ${ds[0]!.bookedOn} paid back ${ds[ds.length - 1]!.endedOn}: ${what}`,
    );
  }
  const single = p.matches.filter((m) => m.deposits.length === 1).length;
  console.log(`\n== Deposits to be added: ${p.toAdd.length}`);
  for (const d of p.toAdd)
    console.log(
      `- ${name(d.accountId)}: FD …${d.last4} booked ${d.bookedOn}, paid back ${d.endedOn} (${d.paybackLineIds.length} line${d.paybackLineIds.length === 1 ? '' : 's'}), back ${(d.paidBack / d.principal).toFixed(3)}× the principal, ${(d.rate * 100).toFixed(2)}% a year`,
    );
  if (!write) {
    console.log(
      `\nPlan only: ${p.toAdd.length} deposits would be added, ${single} records given their number (and dates), ${p.matches.length - single} records kept as history. Run again with mode "apply" to do it.`,
    );
    return;
  }
  console.log(
    `Added ${p.added} deposits; ${p.numbered} records given their number (and dates); ${p.kept} records kept as history.`,
  );
  const rb = await rebuildStatementMoves(db, hh);
  console.log(
    `Movements from statements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}`,
  );
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
