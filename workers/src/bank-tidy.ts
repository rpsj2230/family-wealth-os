/* eslint-disable no-console */
/**
 * Two tidy-ups of banks and accounts, asked for by the household (Actions > Tidy banks):
 *  1. A bank that changed its name is one bank: AU Small Finance Bank took over Fincare Small Finance Bank in 2024, so whatever is
 *     filed under "Fincare" (AU Fincare, Fincare AU) moves to the AU Small Finance bank on file, and the old name goes.
 *  2. Accounts opened and closed the same day with nothing ever in them are not kept at all: the FCNR accounts at DBS and UOB. An
 *     account with any balance, statement line or deposit on file is left alone and reported.
 * MODE=plan lists what would change; MODE=apply does it. Prints names and counts only.
 */
import { connectDb, householdId, must } from './shared';

async function main() {
  const write = process.env.MODE === 'apply';
  const db = connectDb();
  const hh = await householdId(db);
  const insts = must(
    await db.from('institutions').select('id, name').eq('household_id', hh),
    'banks',
  ) as { id: string; name: string }[];
  const assets = must(
    await db
      .from('assets')
      .select('id, type, status, account_kind, institution_id, nickname, owner_id')
      .eq('household_id', hh),
    'assets',
  ) as {
    id: string;
    type: string;
    status: string;
    account_kind: string | null;
    institution_id: string | null;
    nickname: string;
    owner_id: string;
  }[];
  const owners = new Map(
    (
      must(await db.from('owners').select('id, display_name').eq('household_id', hh), 'people') as {
        id: string;
        display_name: string;
      }[]
    ).map((o) => [o.id, o.display_name]),
  );
  const instName = new Map(insts.map((i) => [i.id, i.name]));

  // 1. Fincare is AU Small Finance
  const au = insts.filter((i) => /\bau\b/i.test(i.name) && !/fincare/i.test(i.name));
  const fincare = insts.filter((i) => /fincare/i.test(i.name));
  console.log(
    `== Fincare is AU Small Finance: AU on file ${au.map((i) => `"${i.name}"`).join(', ') || 'none'}; Fincare names ${fincare.map((i) => `"${i.name}"`).join(', ') || 'none'}`,
  );
  if (au.length !== 1 && fincare.length) {
    console.log('  Not one AU Small Finance bank on file to move them to: nothing changed here.');
  } else
    for (const f of fincare) {
      const moving = assets.filter((a) => a.institution_id === f.id);
      const tasks = must(
        await db.from('tasks').select('id').eq('household_id', hh).eq('institution_id', f.id),
        'tasks',
      ) as { id: string }[];
      for (const a of moving)
        console.log(
          `  ${a.type} ${a.account_kind ?? ''} ${owners.get(a.owner_id)} (${a.status}) "${a.nickname}": "${f.name}" → "${au[0]!.name}"`,
        );
      console.log(
        `  ${moving.length} records and ${tasks.length} tasks move; the name "${f.name}" goes`,
      );
      if (!write) continue;
      must(
        await db
          .from('assets')
          .update({ institution_id: au[0]!.id })
          .eq('household_id', hh)
          .eq('institution_id', f.id)
          .select('id'),
        'move records',
      );
      must(
        await db
          .from('tasks')
          .update({ institution_id: au[0]!.id })
          .eq('household_id', hh)
          .eq('institution_id', f.id)
          .select('id'),
        'move tasks',
      );
      must(
        await db.from('institutions').delete().eq('household_id', hh).eq('id', f.id).select('id'),
        'old bank name',
      );
    }

  // a Fincare deposit record that is the same money as deposits now on file from the AU statements (several deposits kept as one
  // row) is kept as history, counted nowhere, like the other records the statements split
  if (au.length === 1) {
    const fds = must(
      await db
        .from('fixed_deposits')
        .select('asset_id, principal, booked_on')
        .eq('household_id', hh),
      'deposits',
    ) as { asset_id: string; principal: number; booked_on: string }[];
    const fdOf = new Map(fds.map((f) => [f.asset_id, f]));
    const atAu = (a: (typeof assets)[number]) =>
      a.institution_id === au[0]!.id || fincare.some((f) => f.id === a.institution_id);
    const days = (x: string, y: string) => Math.abs(Date.parse(x) - Date.parse(y)) / 86_400_000;
    for (const r of assets.filter(
      (a) =>
        a.type === 'fixed_deposit' &&
        a.status !== 'merged' &&
        fincare.some((f) => f.id === a.institution_id),
    )) {
      const rf = fdOf.get(r.id);
      if (!rf) continue;
      const parts = assets.filter((a) => {
        const f = fdOf.get(a.id);
        return (
          a.id !== r.id &&
          a.type === 'fixed_deposit' &&
          a.owner_id === r.owner_id &&
          atAu(a) &&
          a.status !== 'merged' &&
          /^FD …\d{4}$/.test(a.nickname) &&
          f &&
          days(f.booked_on, rf.booked_on) <= 3
        );
      });
      const sum = parts.reduce((t, a) => t + Number(fdOf.get(a.id)!.principal), 0);
      const same =
        parts.length > 0 && Math.abs(sum - Number(rf.principal)) <= Number(rf.principal) * 0.005;
      console.log(
        `  ${owners.get(r.owner_id)} "${r.nickname}": ${parts.length} deposits from the AU statements booked within 3 days${same ? `, adding up to it — kept as history (${parts.map((a) => a.nickname).join(', ')})` : ' — not the same money, left as it is'}`,
      );
      if (!write || !same) continue;
      must(
        await db
          .from('assets')
          .update({
            status: 'merged',
            notes: `Stood for ${parts.length} deposits on the AU statements (${parts.map((a) => a.nickname.replace('FD ', '')).join(' ')}), now on file one by one.`,
          })
          .eq('household_id', hh)
          .eq('id', r.id)
          .select('id'),
        'record kept as history',
      );
    }
  }

  // 2. FCNR accounts at DBS and UOB that never held anything
  console.log('\n== FCNR accounts at DBS and UOB, opened and closed the same day');
  const fcnr = assets.filter(
    (a) =>
      a.type === 'bank_account' &&
      a.account_kind === 'FCNR' &&
      /\b(dbs|uob)\b/i.test(instName.get(a.institution_id ?? '') ?? ''),
  );
  for (const a of fcnr) {
    const count = async (table: string, col = 'asset_id') => {
      const { count: n, error } = await db
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq(col, a.id);
      if (error) throw new Error(`${table}: ${error.message}`);
      return n ?? 0;
    };
    const [obs, lines, tasks, remitTo, remitFrom] = await Promise.all([
      count('observations'),
      count('statement_lines'),
      count('tasks'),
      count('remittances', 'to_asset_id'),
      count('remittances', 'from_asset_id'),
    ]);
    const label = `${instName.get(a.institution_id ?? '')} FCNR ${owners.get(a.owner_id)} "${a.nickname}"`;
    const used = obs + lines + remitTo + remitFrom;
    console.log(
      `  ${label}: ${obs} balances, ${lines} statement lines, ${remitTo + remitFrom} transfers, ${tasks} tasks${used ? ' — has history, left alone' : ' — removed'}`,
    );
    if (!write || used) continue;
    if (tasks)
      must(
        await db.from('tasks').delete().eq('household_id', hh).eq('asset_id', a.id).select('id'),
        'its tasks',
      );
    must(
      await db.from('assets').delete().eq('household_id', hh).eq('id', a.id).select('id'),
      'the account',
    );
  }
  console.log(write ? '\nDone.' : '\nPlan only: nothing was written. Run again with mode "apply".');
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
