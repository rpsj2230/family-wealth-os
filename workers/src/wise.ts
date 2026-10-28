/* eslint-disable no-console */
/**
 * Transfers from Singapore into the Indian accounts (run by hand: Actions > Transfers from Singapore). The transfers arrive as the run's
 * input (REMIT_B64: base64 JSON), never from the repository. Each is stored once (table remittances, keyed by day and amount), the
 * account it reached is worked out where the transfer record does not say (core remittance.ts: opening dates and the balances on
 * either side), and a confirmed movement from the Singapore account to that Indian account is written for the ledger (idem key
 * wise:<id>). A destination you or a statement settled is never changed. MODE=plan writes nothing. Prints counts and bank names only.
 *
 * Input: { provider: 'wise', from: { bank: 'DBS' }, to: { bank, person, last4 }[], transfers: { ref, at: 'YYYY-MM-DDTHH:MM', amount, toLast4? }[] }
 * A transfer whose receiving account the Wise history gives (toLast4) is placed from it: that is the record, not an inference.
 */
import type { DestinationAccount } from '@fwos/core';
import { pageAll, rebuildStatementMoves } from '@fwos/data';
import { bankOnFile } from '@fwos/ingest';
import { connectDb, householdId, must, need } from './shared';

interface Input {
  provider: 'wise';
  from: { bank: string };
  to: { bank: string; person: string; last4: string }[];
  transfers: { ref: string; at: string; amount: number; toLast4?: string }[];
}

const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const lakh = (n: number) => `₹${(n / 100000).toFixed(2)} L`;

function read(): Input {
  const input = JSON.parse(Buffer.from(need('REMIT_B64'), 'base64').toString('utf8')) as Input;
  if (!Array.isArray(input.transfers) || input.transfers.length === 0)
    throw new Error('No transfers.');
  for (const t of input.transfers)
    if (!ISO_AT.test(t.at) || !(t.amount > 0))
      throw new Error('A transfer needs a time and an amount.');
  return input;
}

interface Row {
  id: string;
  received_on: string;
  amount_inr: number;
  to_asset_id: string | null;
  to_basis: string | null;
  from_asset_id: string | null;
  idem_key: string;
}

async function main() {
  const input = read();
  const write = process.env.MODE === 'apply';
  const db = connectDb();
  const hh = await householdId(db);
  const [owners, insts, assets] = await Promise.all([
    db.from('owners').select('id, display_name').eq('household_id', hh),
    db.from('institutions').select('id, name').eq('household_id', hh),
    db
      .from('assets')
      .select(
        'id, owner_id, institution_id, account_kind, identifier_last4, currency, opened_on, opened_after, status',
      )
      .eq('household_id', hh)
      .eq('type', 'bank_account'),
  ]);
  const ownerId = new Map(
    must(owners, 'owners').map((o) => [String(o.display_name).toLowerCase(), o.id as string]),
  );
  const instRows = must(insts, 'institutions') as { id: string; name: string }[];
  const accts = must(assets, 'assets') as Record<string, unknown>[];
  const instOf = (raw: string) => {
    const name = /^dbs$/i.test(raw)
      ? (instRows.find((i) => /^dbs\b/i.test(i.name))?.name ?? null)
      : bankOnFile(
          raw,
          instRows.map((i) => i.name),
        );
    return instRows.find((i) => i.name === name) ?? null;
  };

  // the Singapore account the money left
  const fromInst = instOf(input.from.bank);
  const fromCands = accts.filter((a) => a.institution_id === fromInst?.id && a.currency !== 'INR');
  const from = fromCands.length === 1 ? fromCands[0]! : null;
  console.log(
    `Singapore account (${input.from.bank}): ${from ? 'found' : `${fromCands.length} candidates, not set`}`,
  );

  // the Indian accounts it is sent to
  const dests: DestinationAccount[] = [];
  const destByLast4 = new Map<string, string>();
  for (const t of input.to) {
    const inst = instOf(t.bank);
    const owner = ownerId.get(t.person.toLowerCase());
    const cands = accts.filter(
      (a) => a.institution_id === inst?.id && a.owner_id === owner && a.currency === 'INR',
    );
    const byDigits = cands.filter((a) => a.identifier_last4 === t.last4);
    const nre = cands.filter((a) => a.account_kind === 'NRE');
    const pick =
      byDigits.length === 1
        ? byDigits[0]
        : nre.length === 1
          ? nre[0]
          : cands.length === 1
            ? cands[0]
            : undefined;
    console.log(
      `Indian account at ${inst?.name ?? t.bank}: ${pick ? 'found' : `${cands.length} candidates, left out`}`,
    );
    if (!pick) continue;
    destByLast4.set(t.last4, pick.id as string);
    dests.push({
      assetId: pick.id as string,
      ownerId: pick.owner_id as string,
      institutionId: (pick.institution_id as string | null) ?? null,
      openedAfter: (pick.opened_after as string | null) ?? null,
    });
    // the account's last four digits, when not on file yet
    if (write && !pick.identifier_last4)
      must(
        await db
          .from('assets')
          .update({ identifier_last4: t.last4 })
          .eq('id', pick.id as string)
          .select('id'),
        'last four digits',
      );
  }
  const bankName = new Map(
    dests.map((d) => [d.assetId, instRows.find((i) => i.id === d.institutionId)?.name ?? '?']),
  );

  // store each transfer once
  const want = input.transfers.map((t) => ({
    household_id: hh,
    provider: input.provider,
    provider_ref: t.ref,
    sent_at: `${t.at}:00+08:00`,
    received_on: t.at.slice(0, 10),
    amount_inr: Math.round(t.amount * 100) / 100,
    from_asset_id: (from?.id as string | undefined) ?? null,
    candidate_asset_ids: dests.map((d) => d.assetId),
    idem_key: `${input.provider}:${t.at.slice(0, 10)}:${Math.round(t.amount * 100)}`,
    // the receiving account, when the Wise history names it
    ...(t.toLast4 && destByLast4.has(t.toLast4)
      ? {
          to_asset_id: destByLast4.get(t.toLast4)!,
          to_basis: 'statement',
          to_note: 'From the Wise transfer history (the receiving account)',
        }
      : {}),
  }));
  const before = await pageAll<Row>((a, b) =>
    db
      .from('remittances')
      .select('id, received_on, amount_inr, to_asset_id, to_basis, from_asset_id, idem_key')
      .eq('household_id', hh)
      .range(a, b),
  );
  const have = new Set(before.map((r) => r.idem_key));
  const fresh = want.filter((w) => !have.has(w.idem_key));
  const total = want.reduce((s, w) => s + w.amount_inr, 0);
  console.log(
    `Transfers in the input: ${want.length} (${lakh(total)}), ${want[0] ? `${[...want].sort((x, y) => x.received_on.localeCompare(y.received_on))[0]!.received_on} to ${[...want].sort((x, y) => y.received_on.localeCompare(x.received_on))[0]!.received_on}` : ''}; new: ${fresh.length}`,
  );
  if (write && fresh.length)
    must(await db.from('remittances').insert(fresh).select('id'), 'store transfers');
  // a transfer already stored whose receiving account the history now gives
  const named = want.filter((w) => 'to_asset_id' in w && have.has(w.idem_key));
  console.log(
    `Receiving account given by the history: ${want.filter((w) => 'to_asset_id' in w).length}`,
  );
  if (write)
    for (const w of named)
      must(
        await db
          .from('remittances')
          .update({ to_asset_id: w.to_asset_id, to_basis: 'statement', to_note: w.to_note })
          .eq('household_id', hh)
          .eq('idem_key', w.idem_key)
          .select('id'),
        'receiving account',
      );

  // the Singapore account was open by the first transfer
  const first = [...want].sort((x, y) => x.received_on.localeCompare(y.received_on))[0]!
    .received_on;
  if (from) {
    const after = from.opened_after as string | null;
    const on = from.opened_on as string | null;
    if ((after && after >= first) || !on || on > first) {
      console.log(`Singapore account: open by ${first} (its first transfer)`);
      if (write)
        must(
          await db
            .from('assets')
            .update({
              opened_on: on && on < first ? on : first,
              opened_after: after && after < first ? after : null,
              opened_note: 'Transfers to India from it since then (Wise)',
            })
            .eq('id', from.id as string)
            .select('id'),
          'Singapore opening',
        );
    }
  }

  if (!write) {
    console.log('Plan only: nothing was written. Run again with mode "apply" to write it.');
    return;
  }
  // where each went (statements first, then what rules accounts out and the balances), and the ledger's movements
  const rb = await rebuildStatementMoves(db, hh);
  await report(db, hh, bankName);
  console.log(`Statement lines still to answer: ${rb.toAnswer}`);
}

/** How many transfers reached each account, and how that is known. */
export async function report(
  db: ReturnType<typeof connectDb>,
  hh: string,
  bankName: Map<string, string>,
) {
  const rows = await pageAll<{
    received_on: string;
    amount_inr: number;
    to_asset_id: string | null;
    to_basis: string | null;
  }>((a, b) =>
    db
      .from('remittances')
      .select('received_on, amount_inr, to_asset_id, to_basis')
      .eq('household_id', hh)
      .range(a, b),
  );
  const tally = new Map<string, { n: number; sum: number }>();
  for (const r of rows) {
    const k = r.to_asset_id
      ? `${bankName.get(r.to_asset_id) ?? '?'} (${r.to_basis})`
      : 'not yet known';
    const t = tally.get(k) ?? { n: 0, sum: 0 };
    t.n++;
    t.sum += Number(r.amount_inr);
    tally.set(k, t);
  }
  for (const [k, t] of [...tally].sort())
    console.log(`Reached ${k}: ${t.n} transfers, ${lakh(t.sum)}`);
  const moves = must(
    await db.from('money_moves').select('id').eq('household_id', hh).like('idem_key', 'wise:%'),
    'movements',
  );
  console.log(`Ledger movements for the transfers: ${moves.length}`);
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
