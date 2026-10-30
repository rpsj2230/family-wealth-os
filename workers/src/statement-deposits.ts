/* eslint-disable no-console */
/**
 * Deposits the bank statements show (a booking and a pay-back with the same deposit number) that the portal has no record of
 * (core statement-deposits.ts). MODE=plan lists them, with any deposit on file of the same person at the same bank whose dates
 * overlap (a record from the diary or the workbook that may be the same money); MODE=apply adds them as matured deposits and
 * rebuilds the movements, so both lines are explained. Run by hand (Actions > Deposits from statements). Prints dates, deposit
 * numbers' last four digits and ratios, never an amount.
 */
import {
  depositNumbers,
  depositsFromStatements,
  matchDepositRecords,
  type DepositLine,
  type DepositRecord,
} from '@fwos/core';
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
  const interest = t.lines
    .filter((l) => t.classified.get(l.id)?.cls === 'fd_interest')
    .map((l) => ({
      id: l.id,
      assetId: l.asset_id,
      date: l.txn_on,
      amount: l.amount,
      narration: l.narration,
    }));
  const last4 = new Map(loaded.assetRows.map((a) => [a.id, a.identifier_last4 ?? null]));
  const keyOf = (id: string) => `${asset.get(id)?.owner_id}|${bankOf(id) ?? ''}`;
  const found = depositsFromStatements(bookings, paybacks, last4, interest).map((d) => ({
    ...d,
    key: keyOf(d.accountId),
  }));
  console.log(
    `Deposit lines no deposit on file explains: ${bookings.length} bookings, ${paybacks.length} pay-backs. Deposits found: ${found.length}`,
  );
  // the lines left unpaired, with the deposit numbers they print: why a booking and its pay-back did not find each other
  if (process.env.SHOW_UNPAIRED === 'true') {
    const pairedIds = new Set(found.flatMap((d) => [d.bookingLineId, ...d.paybackLineIds]));
    for (const l of [...bookings, ...paybacks]
      .filter((x) => !pairedIds.has(x.id))
      .sort((a, b) => a.assetId.localeCompare(b.assetId) || a.date.localeCompare(b.date)))
      console.log(
        `  ${l.amount < 0 ? 'booked' : 'paid back'} ${l.date} ${name(l.assetId)} numbers [${depositNumbers(l.narration, last4.get(l.assetId) ?? null).join(' ')}] "${l.narration.toLowerCase().replace(/\d/g, '#').slice(0, 60)}"`,
      );
  }

  // the deposits on file they may already be (merged records are not loaded)
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
  const nums = (ds: { last4: string }[]) => ds.map((d) => `…${d.last4}`).join(' ');
  console.log(`\n== Records on file that are these deposits: ${matches.length}`);
  for (const m of matches) {
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
  console.log(`\n== Deposits no record stands for, to be added: ${rest.length}`);
  for (const d of rest)
    console.log(
      `- ${name(d.accountId)}: FD …${d.last4} booked ${d.bookedOn}, paid back ${d.endedOn} (${d.paybackLineIds.length} line${d.paybackLineIds.length === 1 ? '' : 's'}), back ${(d.paidBack / d.principal).toFixed(3)}× the principal, ${(d.rate * 100).toFixed(2)}% a year`,
    );
  const toAdd = [
    ...rest,
    ...matches.filter((m) => m.deposits.length > 1).flatMap((m) => m.deposits),
  ];
  if (!write) {
    console.log(
      `\nPlan only: ${toAdd.length} deposits would be added, ${matches.filter((m) => m.deposits.length === 1).length} records given their number (and dates), ${matches.filter((m) => m.deposits.length > 1).length} records kept as history. Run again with mode "apply" to do it.`,
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
    must(
      await db
        .from('fixed_deposits')
        .update({ ended_estimated: false, fd_ref_last4: d.last4 })
        .eq('asset_id', (r as { id: string }).id)
        .eq('household_id', hh)
        .select('asset_id'),
      'deposit dates',
    );
    added++;
  }
  let numbered = 0;
  let kept = 0;
  for (const m of matches) {
    if (m.deposits.length === 1) {
      const d = m.deposits[0]!;
      const f = fdRow.get(m.recordId)!;
      const change: Record<string, unknown> = {
        fd_ref_last4: d.last4,
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
      numbered++;
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
      kept++;
    }
  }
  console.log(
    `Added ${added} deposits; ${numbered} records given their number (and dates); ${kept} records kept as history.`,
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
