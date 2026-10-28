/* eslint-disable no-console */
/**
 * Transfers from Singapore into the Indian accounts (run by hand: Actions > Transfers from Singapore). The transfers arrive as the run's
 * input (REMIT_B64: base64 JSON), never from the repository. Each is stored once (table remittances, keyed by day and amount), the
 * account it reached is worked out where the transfer record does not say (core remittance.ts: opening dates and the balances on
 * either side), and a confirmed movement from the Singapore account to that Indian account is written for the ledger (idem key
 * wise:<id>). A destination you or a statement settled is never changed. MODE=plan writes nothing. Prints counts and bank names only.
 *
 * Input: { provider: 'wise', from: { bank: 'DBS' }, to: { bank, person, last4 }[], transfers: { ref, at: 'YYYY-MM-DDTHH:MM', amount }[] }
 */
import { remittanceDestinations, type DestinationAccount } from '@fwos/core';
import { pageAll } from '@fwos/data';
import { bankOnFile } from '@fwos/ingest';
import { connectDb, householdId, must, need } from './shared';

interface Input {
  provider: 'wise';
  from: { bank: string };
  to: { bank: string; person: string; last4: string }[];
  transfers: { ref: string; at: string; amount: number }[];
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
    idem_key: `${input.provider}:${t.at.slice(0, 10)}:${Math.round(t.amount * 100)}`,
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

  // where each went
  const rows = write
    ? await pageAll<Row>((a, b) =>
        db
          .from('remittances')
          .select('id, received_on, amount_inr, to_asset_id, to_basis, from_asset_id, idem_key')
          .eq('household_id', hh)
          .range(a, b),
      )
    : [
        ...before,
        ...fresh.map((f, i) => ({ ...f, id: `new-${i}`, to_asset_id: null, to_basis: null })),
      ];
  const open = rows.filter((r) => r.to_basis !== 'statement' && r.to_basis !== 'person');
  const ids = dests.map((d) => d.assetId);
  const [obs, fds] = await Promise.all([
    pageAll<{ asset_id: string; as_of: string; amount: number }>((a, b) =>
      db
        .from('observations')
        .select('asset_id, as_of, amount')
        .eq('household_id', hh)
        .eq('kind', 'balance')
        .is('superseded_by', null)
        .in('asset_id', ids)
        .order('as_of')
        .order('id')
        .range(a, b),
    ),
    pageAll<{ asset_id: string; booked_on: string; principal: number }>((a, b) =>
      db
        .from('fixed_deposits')
        .select('asset_id, booked_on, principal')
        .eq('household_id', hh)
        .range(a, b),
    ),
  ]);
  const fdAsset = new Map(
    (
      must(
        await db
          .from('assets')
          .select('id, owner_id, institution_id')
          .eq('household_id', hh)
          .eq('type', 'fixed_deposit'),
        'deposits',
      ) as { id: string; owner_id: string; institution_id: string | null }[]
    ).map((a) => [a.id, a]),
  );
  const found = remittanceDestinations({
    transfers: open.map((r) => ({ id: r.id, date: r.received_on, amount: Number(r.amount_inr) })),
    accounts: dests,
    balances: obs.map((o) => ({ assetId: o.asset_id, date: o.as_of, amount: Number(o.amount) })),
    deposits: fds
      .filter((f) => fdAsset.has(f.asset_id))
      .map((f) => ({
        ownerId: fdAsset.get(f.asset_id)!.owner_id,
        institutionId: fdAsset.get(f.asset_id)!.institution_id,
        bookedOn: f.booked_on,
        principal: Number(f.principal),
      })),
  });
  const tally = new Map<string, { n: number; sum: number }>();
  for (const d of found) {
    const r = open.find((x) => x.id === d.id)!;
    const k = d.assetId
      ? `${bankName.get(d.assetId)} (${d.basis === 'only_open' ? 'only one open' : 'from balances'})`
      : 'not yet known';
    const t = tally.get(k) ?? { n: 0, sum: 0 };
    t.n++;
    t.sum += Number(r.amount_inr);
    tally.set(k, t);
    if (!d.assetId)
      console.log(
        `    ${r.received_on}: not yet known (could be ${d.alternatives.map((a) => bankName.get(a)).join(' or ') || 'none open'})`,
      );
    if (write && (d.assetId ?? null) !== r.to_asset_id)
      must(
        await db
          .from('remittances')
          .update({
            to_asset_id: d.assetId,
            to_basis: d.basis,
            to_note: d.assetId ? d.reason.slice(0, 300) : null,
          })
          .eq('id', r.id)
          .select('id'),
        'destination',
      );
  }
  for (const [k, t] of tally) console.log(`Reached ${k}: ${t.n} transfers, ${lakh(t.sum)}`);

  if (!write) {
    console.log('Plan only: nothing was written. Run again with mode "apply" to write it.');
    return;
  }

  // the ledger's movements: one transfer from the Singapore account to the Indian account for each transfer whose account is known
  const final = await pageAll<Row>((a, b) =>
    db
      .from('remittances')
      .select('id, received_on, amount_inr, to_asset_id, to_basis, from_asset_id, idem_key')
      .eq('household_id', hh)
      .range(a, b),
  );
  const moves = final
    .filter((r) => r.to_asset_id && r.from_asset_id)
    .map((r) => ({
      household_id: hh,
      moved_on: r.received_on,
      amount: Number(r.amount_inr),
      from_asset_id: r.from_asset_id,
      to_asset_id: r.to_asset_id,
      kind: 'transfer',
      status: 'confirmed',
      source: 'import',
      note: 'Transfer from Singapore (Wise)',
      idem_key: `wise:${r.id}`,
    }));
  const existing = await pageAll<{
    id: string;
    idem_key: string;
    to_asset_id: string | null;
    amount: number;
  }>((a, b) =>
    db
      .from('money_moves')
      .select('id, idem_key, to_asset_id, amount')
      .eq('household_id', hh)
      .like('idem_key', 'wise:%')
      .range(a, b),
  );
  const wantKey = new Map(moves.map((m) => [m.idem_key, m]));
  const drop = existing.filter((e) => {
    const w = wantKey.get(e.idem_key);
    return !w || w.to_asset_id !== e.to_asset_id || Math.abs(w.amount - Number(e.amount)) > 0.005;
  });
  if (drop.length)
    must(
      await db
        .from('money_moves')
        .delete()
        .in(
          'id',
          drop.map((d) => d.id),
        )
        .select('id'),
      'old movements',
    );
  const kept = new Set(existing.filter((e) => !drop.includes(e)).map((e) => e.idem_key));
  const add = moves.filter((m) => !kept.has(m.idem_key));
  if (add.length) must(await db.from('money_moves').insert(add).select('id'), 'movements');
  console.log(
    `Ledger movements: ${add.length} added, ${drop.length} replaced, ${kept.size} unchanged.`,
  );
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
