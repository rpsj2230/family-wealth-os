import { notFound } from 'next/navigation';
import {
  buildBankBlocks,
  capacityLabel,
  filterBlocksByOwner,
  tenureText,
  formatInr,
  personStyles,
  type BankBlock,
  type BankRow,
  type PersonStyle,
} from '@fwos/core';
import type { ActivityItem } from '@/components/ActivityLog';
import type { DetailTableData } from '@/components/DetailTable';
import type { Fact } from '@/components/AssetFacts';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext, type Ctx } from './data';
import {
  bankHistory,
  buildActivity,
  buildAssetView,
  type AssetView,
  type AssetViewInput,
  type AuditIn,
  type ImportIn,
  type InboxIn,
  type ObsIn,
} from './detail-view';
import { loadPortfolio } from './portfolio-data';
import { cashRatesFor, loadOffers } from './rates-view';
import { buildDeposits } from './deposits';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Supabase = Ctx['supabase'];

const AUDIT_TABLES = [
  'assets',
  'fixed_deposits',
  'mf_positions',
  'observations',
  'receivables',
  'receivable_payments',
  'institutions',
  'tasks',
  'policies',
];

async function auditRows(supabase: Supabase): Promise<AuditIn[]> {
  const r = await supabase
    .from('audit_events')
    .select('actor, table_name, row_id, action, before, after, at')
    .in('table_name', AUDIT_TABLES)
    .order('at', { ascending: false })
    .limit(800);
  return (r.data ?? []) as unknown as AuditIn[];
}

const assetOf = (r: AuditIn) =>
  (r.after?.asset_id ?? r.before?.asset_id ?? r.row_id) as string | null | undefined;

export interface DetailBase {
  person: PersonStyle | undefined;
  view: AssetView;
  activity: ActivityItem[];
  bank: { id: string; name: string } | null;
  type: string;
}

/** Everything for one asset, or a 404 when it is not one of the signed-in person's. */
export async function loadAssetDetail(id: string): Promise<DetailBase> {
  if (!UUID.test(id)) notFound();
  const { supabase, householdId, userId } = await loadContext();
  if (!householdId) notFound();
  const l = await loadPortfolio(supabase);
  const asset = l.assetRows.find((a) => a.id === id);
  if (!asset) notFound();
  const yearAgo = new Date(l.today);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const [obs, pos, tx, rec, pays, owners, insts, allocs, goals, audit, inbox, offers] =
    await Promise.all([
      supabase
        .from('observations')
        .select(
          'id, amount, currency, fx_rate, as_of, confidence, source, note, created_at, superseded_by',
        )
        .eq('asset_id', id)
        .order('as_of', { ascending: false })
        .limit(500),
      supabase
        .from('mf_positions')
        .select(
          'fund_name, invested, started_on, sip_monthly, sip_stopped, folio_last4, isin, amfi_code, plan_type',
        )
        .eq('asset_id', id)
        .maybeSingle(),
      supabase
        .from('mf_transactions')
        .select('id, txn_on, kind, amount, units, nav, balance_units, description')
        .eq('asset_id', id)
        .order('txn_on')
        .limit(5000),
      supabase
        .from('receivables')
        .select('counterparty, lent, lent_on, expected_on, interest_note')
        .eq('asset_id', id)
        .maybeSingle(),
      supabase
        .from('receivable_payments')
        .select('amount, paid_on, note')
        .eq('asset_id', id)
        .order('paid_on'),
      supabase.from('owners').select('id, display_name').order('created_at'),
      supabase.from('institutions').select('id, name, notes'),
      supabase.from('goal_allocations').select('goal_id').eq('asset_id', id),
      supabase.from('goals').select('id, name'),
      auditRows(supabase),
      supabase
        .from('inbox_messages')
        .select('received_on, created_at, from_domain, subject, outcome, reason')
        .eq('asset_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      loadOffers(supabase),
    ]);
  const ownerList = ((owners.data ?? []) as unknown as { id: string; display_name: string }[]).map(
    (o) => ({ id: o.id, name: o.display_name }),
  );
  const styles = personStyles(ownerList);
  const instRows = (insts.data ?? []) as unknown as {
    id: string;
    name: string;
    notes: string | null;
  }[];
  const instNames = Object.fromEntries(instRows.map((i) => [i.id, i.name]));
  const bank =
    asset.institution_id && instNames[asset.institution_id]
      ? { id: asset.institution_id, name: instNames[asset.institution_id]! }
      : null;

  const blocks = buildBankBlocks({
    assets: l.assetRows,
    observations: l.obsRows,
    fds: l.fdRows,
    portfolio: l.portfolio,
    institutionNames: instNames,
    today: l.today,
  });
  let row: BankRow | undefined;
  for (const b of blocks) for (const s of b.sections) row ??= s.rows.find((r) => r.assetId === id);
  const valued = l.portfolio.valued.find((v) => v.assetId === id);
  const line = l.portfolio.lines[id];
  const fd = l.fdRows.find((f) => f.asset_id === id) ?? null;
  const position = (pos.data as AssetViewInput['position']) ?? null;
  let navs: AssetViewInput['navs'] = [];
  if (position?.amfi_code) {
    const r = await supabase
      .from('mf_navs')
      .select('nav_date, nav')
      .eq('amfi_code', position.amfi_code)
      .gte('nav_date', yearAgo.toISOString().slice(0, 10))
      .order('nav_date')
      .limit(400);
    navs = ((r.data ?? []) as unknown as { nav_date: string; nav: number }[]).map((n) => ({
      nav_date: n.nav_date,
      nav: Number(n.nav),
    }));
  }
  const linkedAsset = asset.linked_last4
    ? l.assetRows.find(
        (a) =>
          a.type === 'bank_account' &&
          a.institution_id === asset.institution_id &&
          a.identifier_last4 === asset.linked_last4,
      )
    : undefined;
  const linkedRow = linkedAsset
    ? blocks
        .flatMap((b) => b.sections.flatMap((s) => s.rows))
        .find((r) => r.assetId === linkedAsset.id)
    : undefined;
  const goalNames = new Map(
    ((goals.data ?? []) as unknown as { id: string; name: string }[]).map((g) => [g.id, g.name]),
  );
  const myBank = bank?.name ?? '';
  const cashRate =
    asset.type === 'bank_account' && row
      ? cashRatesFor(
          [{ ...row, bank: myBank }],
          new Map([[id, asset.interest_rate ?? null]]),
          offers,
          (await loadSettings(supabase as unknown as SupabaseClient)).config.estimates.savingsRate,
        )[id]
      : undefined;
  const bestFd = offers
    .filter((o) => o.product === 'fd' && o.accountKind !== 'NRO' && o.accountKind !== 'resident')
    .reduce<(typeof offers)[number] | null>((m, o) => (!m || o.rate > m.rate ? o : m), null);
  const siblings = blocks
    .flatMap((b) =>
      b.sections.filter((sct) => sct.ownerId === asset.owner_id && b.key === asset.institution_id),
    )
    .flatMap((sct) => sct.rows)
    .filter((r) => r.assetId !== id)
    .map((r) => ({ id: r.assetId, label: r.code, value: r.current }));
  const input: AssetViewInput = {
    rateInfo: cashRate ?? null,
    market: bestFd
      ? {
          bank: bestFd.bank,
          rate: bestFd.rate,
          tenure: tenureText(bestFd),
          checkedOn: bestFd.checkedOn,
        }
      : null,
    related: siblings,
    today: l.today.toISOString().slice(0, 10),
    asset: {
      id,
      type: asset.type,
      nickname: asset.nickname,
      label: asset.label ?? null,
      status: asset.status,
      currency: asset.currency,
      account_kind: asset.account_kind,
      is_joint: asset.is_joint ?? false,
      identifier_last4: asset.identifier_last4 ?? null,
      linked_last4: asset.linked_last4 ?? null,
      notes: asset.notes ?? null,
      holder_name: asset.holder_name ?? null,
    },
    ownerName: styles[asset.owner_id]?.name ?? '',
    bankName: bank?.name ?? null,
    code: row?.code ?? null,
    current: {
      amount: valued?.estimate?.estimatedAmount ?? null,
      basis: line?.basis ?? null,
      ageDays: line?.ageDays ?? null,
      asOf: line?.asOf ?? null,
    },
    observations: ((obs.data ?? []) as unknown as ObsIn[]).map((o) => ({
      ...o,
      amount: Number(o.amount),
      fx_rate: o.fx_rate === null ? null : Number(o.fx_rate),
    })),
    fd: fd
      ? {
          principal: Number(fd.principal),
          rate: Number(fd.rate),
          booked_on: fd.booked_on,
          maturity_on: fd.maturity_on,
          compounding: fd.compounding,
          bank_maturity_amount:
            fd.bank_maturity_amount === null ? null : Number(fd.bank_maturity_amount),
          fd_ref_last4: fd.fd_ref_last4 ?? null,
        }
      : null,
    position: position
      ? {
          ...position,
          invested: Number(position.invested),
          sip_monthly: position.sip_monthly === null ? null : Number(position.sip_monthly),
        }
      : null,
    txns: ((tx.data ?? []) as unknown as AssetViewInput['txns']).map((t) => ({
      ...t,
      amount: Number(t.amount),
      units: Number(t.units),
      nav: t.nav === null ? null : Number(t.nav),
      balance_units: t.balance_units === null ? null : Number(t.balance_units),
    })),
    navs,
    receivable: rec.data
      ? {
          ...(rec.data as unknown as NonNullable<AssetViewInput['receivable']>),
          lent: Number((rec.data as { lent: number }).lent),
        }
      : null,
    payments: ((pays.data ?? []) as unknown as AssetViewInput['payments']).map((p) => ({
      ...p,
      amount: Number(p.amount),
    })),
    goalNames: ((allocs.data ?? []) as unknown as { goal_id: string }[])
      .map((a) => goalNames.get(a.goal_id))
      .filter((n): n is string => !!n),
    linked: linkedAsset
      ? {
          id: linkedAsset.id,
          label: `${bank?.name ?? ''} ${linkedRow?.code ?? linkedAsset.nickname}`.trim(),
        }
      : null,
  };
  let imports: ImportIn[] = [];
  if (position) {
    const r = await supabase
      .from('cas_imports')
      .select('created_at, outcome, schemes, transactions, detail')
      .eq('owner_id', asset.owner_id)
      .order('created_at', { ascending: false })
      .limit(10);
    imports = (r.data ?? []) as unknown as ImportIn[];
  }
  const mine = audit.filter((r) => assetOf(r) === id);
  const names = { ...Object.fromEntries(ownerList.map((o) => [o.id, o.name])), ...instNames };
  return {
    person: styles[asset.owner_id],
    view: buildAssetView(input),
    activity: buildActivity({
      audit: mine,
      inbox: (inbox.data ?? []) as unknown as InboxIn[],
      imports,
      viewerId: userId,
      names,
    }),
    bank,
    type: asset.type,
  };
}

// ------------------------------------------------------------------------------------------------
export interface BankDetail {
  name: string;
  note: string | null;
  block: BankBlock | null;
  styles: Record<string, PersonStyle>;
  /** set on a person's page within the bank */
  person: PersonStyle | null;
  facts: Fact[];
  tables: DetailTableData[];
  history: { date: string; value: number }[];
  activity: ActivityItem[];
}

const inr = (n: number | null) => (n === null ? '–' : formatInr(Math.round(n)));

export async function loadBankDetail(id: string, ownerId?: string): Promise<BankDetail> {
  if (!UUID.test(id)) notFound();
  const { supabase, householdId, userId } = await loadContext();
  if (!householdId) notFound();
  if (ownerId && !UUID.test(ownerId)) notFound();
  const [l, insts, owners, audit, depAssets, st] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name, notes'),
    supabase.from('owners').select('id, display_name').order('created_at'),
    auditRows(supabase),
    supabase
      .from('assets')
      .select(
        'id, owner_id, institution_id, type, status, nickname, account_kind, is_joint, joint_holder_id',
      ),
    loadSettings(supabase as unknown as SupabaseClient),
  ]);
  const instRows = (insts.data ?? []) as unknown as {
    id: string;
    name: string;
    notes: string | null;
  }[];
  const inst = instRows.find((i) => i.id === id);
  if (!inst) notFound();
  const ownerList = ((owners.data ?? []) as unknown as { id: string; display_name: string }[]).map(
    (o) => ({ id: o.id, name: o.display_name }),
  );
  const styles = personStyles(ownerList);
  const blocks = buildBankBlocks({
    assets: l.assetRows,
    observations: l.obsRows,
    fds: l.fdRows,
    portfolio: l.portfolio,
    institutionNames: Object.fromEntries(instRows.map((i) => [i.id, i.name])),
    today: l.today,
  });
  const block0 = blocks.find((b) => b.key === id) ?? null;
  if (ownerId && !ownerList.some((o) => o.id === ownerId)) notFound();
  const block = ownerId && block0 ? (filterBlocksByOwner([block0], ownerId)[0] ?? null) : block0;
  if (ownerId && !block) notFound();
  const mineAssets = l.assetRows.filter(
    (a) => a.institution_id === id && (!ownerId || a.owner_id === ownerId),
  );
  const ids = new Set(mineAssets.map((a) => a.id));
  const todayIso = l.today.toISOString().slice(0, 10);
  const counted = (s: string) => s === 'active' || s === 'stopped';
  const history = bankHistory({
    today: todayIso,
    cash: l.obsRows
      .filter(
        (o) =>
          !o.superseded_by &&
          mineAssets.some((a) => a.id === o.asset_id && a.type === 'bank_account'),
      )
      .map((o) => ({ assetId: o.asset_id, as_of: o.as_of, value: o.amount * (o.fx_rate ?? 1) })),
    deposits: l.fdRows
      .filter((f) => ids.has(f.asset_id))
      .map((f) => ({
        principal: Number(f.principal),
        rate: Number(f.rate),
        booked_on: f.booked_on,
        maturity_on: f.maturity_on,
        compounding: f.compounding,
        counted: counted(mineAssets.find((a) => a.id === f.asset_id)?.status ?? ''),
      })),
  });
  const inbox = ids.size
    ? await supabase
        .from('inbox_messages')
        .select('asset_id, received_on, created_at, from_domain, subject, outcome, reason')
        .in('asset_id', [...ids])
        .order('created_at', { ascending: false })
        .limit(60)
    : { data: [] };
  const rows = block ? block.sections.flatMap((s) => s.rows) : [];
  const t = block?.totals;
  const facts: Fact[] = [
    { label: 'Total today', value: inr(t?.current ?? 0) },
    { label: 'Savings and cash', value: inr(t?.cash ?? 0) },
    { label: 'Deposits invested', value: inr(t?.fdInvested ?? 0) },
    { label: 'Deposits at maturity', value: inr(t?.fdMaturity ?? 0) },
    { label: 'Deposits worth today', value: inr(t?.fdCurrent ?? 0) },
    { label: 'Accounts and deposits', value: String(rows.length) },
    {
      label: 'People',
      value:
        (block?.owners ?? [])
          .map((o) => styles[o]?.name ?? '')
          .filter(Boolean)
          .join(', ') || '–',
    },
    { label: 'Bank note', value: inst.notes ?? 'None yet', note: undefined },
  ];
  if (block?.lastUpdated) facts.push({ label: 'Last updated', value: block.lastUpdated });
  const tables: DetailTableData[] = [];
  tables.push({
    title: 'Accounts and deposits',
    hint: 'Open one to see its history and log.',
    columns: [
      'Account',
      'Person',
      'Rate',
      'Maturity',
      'Balance or invested',
      'Current value',
      'Status',
    ],
    numeric: [2, 4, 5],
    rows: rows.map((r) => ({
      href: `/asset/${r.assetId}`,
      dim: r.status !== 'active',
      cells: [
        r.code,
        styles[r.ownerId]?.name ?? '',
        r.fd ? `${(r.fd.rate * 100).toFixed(2).replace(/\.?0+$/, '')}%` : '',
        r.fd ? r.fd.maturityOn : '',
        inr(r.fd ? r.fd.principal : r.recorded),
        inr(r.current),
        r.status.replace(/_/g, ' '),
      ],
    })),
    empty: 'No accounts are recorded for this bank.',
  });
  if (block)
    tables.unshift({
      title: 'By person',
      columns: ['Person', 'Savings and cash', 'Deposits invested', 'Deposits worth today', 'Total'],
      numeric: [1, 2, 3, 4],
      rows: block.sections.map((s) => ({
        cells: [
          styles[s.ownerId]?.name ?? '',
          inr(s.totals.cash),
          inr(s.totals.fdInvested),
          inr(s.totals.fdCurrent),
          inr(s.totals.current),
        ],
      })),
    });
  const names = {
    ...Object.fromEntries(ownerList.map((o) => [o.id, o.name])),
    ...Object.fromEntries(instRows.map((i) => [i.id, i.name])),
  };
  const fdLines = rows.filter((r) => r.fd && r.status === 'active');
  if (fdLines.length > 0) {
    const sorted = [...fdLines].sort((a, b) => a.fd!.maturityOn.localeCompare(b.fd!.maturityOn));
    const principal = sorted.reduce((s2, r) => s2 + r.fd!.principal, 0);
    const avg =
      principal > 0
        ? sorted.reduce((s2, r) => s2 + r.fd!.rate * r.fd!.principal, 0) / principal
        : 0;
    facts.push(
      {
        label: 'Next maturity',
        value: sorted[0]!.fd!.maturityOn,
        note: `${sorted[0]!.fd!.daysLeft} days`,
      },
      {
        label: 'Average deposit rate',
        value: `${(avg * 100).toFixed(2)}%`,
        note: 'weighted by amount invested',
      },
    );
    tables.push({
      title: 'Maturities, soonest first',
      hint: 'Open one for its full history and interest by year.',
      columns: [
        'Deposit',
        'Person',
        'Rate',
        'Matures',
        'Days left',
        'Invested',
        'Interest to come',
        'At maturity',
      ],
      numeric: [2, 4, 5, 6, 7],
      rows: sorted.map((r) => ({
        href: `/asset/${r.assetId}`,
        cells: [
          r.code,
          styles[r.ownerId]?.name ?? '',
          `${(r.fd!.rate * 100).toFixed(2).replace(/\.?0+$/, '')}%`,
          r.fd!.maturityOn,
          String(r.fd!.daysLeft),
          inr(r.fd!.principal),
          inr(Math.max(0, r.fd!.maturityAmount - (r.current ?? r.fd!.principal))),
          inr(r.fd!.maturityAmount),
        ],
      })),
    });
  }
  const cover = buildDeposits(
    ((depAssets.data ?? []) as unknown as Record<string, unknown>[]).map((a) => ({
      id: a.id as string,
      ownerId: a.owner_id as string,
      institutionId: (a.institution_id as string | null) ?? null,
      type: a.type as string,
      status: a.status as string,
      nickname: a.nickname as string,
      accountKind: (a.account_kind as string | null) ?? null,
      isJoint: !!a.is_joint,
      jointHolderId: (a.joint_holder_id as string | null) ?? null,
    })),
    l.portfolio.valued,
    l.fdRows,
    new Map(instRows.map((i) => [i.id, i.name])),
    new Map(ownerList.map((o) => [o.id, o.name])),
    l.today,
    st.config.deposits.insuranceLimit,
  ).cover;
  const coverRows = cover.rows.filter(
    (r) => r.bankId === id && (!ownerId || r.capacityKey.split(/[:+]/).includes(ownerId)),
  );
  if (coverRows.length > 0)
    tables.push({
      title: 'Deposit insurance by name',
      hint: `Cover is ${inr(cover.limit)} per bank for each ownership name as written; interest counts. A joint account in the order A & B is a different name from B & A.`,
      columns: ['Held in the name of', 'Total at this bank', 'Insured', 'Above the limit'],
      numeric: [1, 2, 3],
      rows: coverRows.map((r) => ({
        cells: [
          capacityLabel(r.capacityKey, cover.ownerNames),
          inr(r.total),
          inr(r.insured),
          r.uninsured > 0 ? inr(r.uninsured) : '–',
        ],
      })),
    });
  const mine = audit.filter((r) =>
    r.table_name === 'institutions' ? !ownerId && r.row_id === id : ids.has(String(assetOf(r))),
  );
  return {
    name: inst.name,
    note: inst.notes,
    block,
    styles,
    person: ownerId ? (styles[ownerId] ?? null) : null,
    facts,
    tables,
    history,
    activity: buildActivity({
      audit: mine,
      inbox: (inbox.data ?? []) as unknown as InboxIn[],
      viewerId: userId,
      names,
    }),
  };
}

// ------------------------------------------------------------------------------------------------
export async function loadTaskDetail(id: string) {
  if (!UUID.test(id)) notFound();
  const { supabase, householdId, userId } = await loadContext();
  if (!householdId) notFound();
  const [t, audit, owners, assets, insts] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, due_on, created_at, done_at, asset_id, institution_id')
      .eq('id', id)
      .maybeSingle(),
    auditRows(supabase),
    supabase.from('owners').select('id, display_name'),
    supabase.from('assets').select('id, nickname, label'),
    supabase.from('institutions').select('id, name'),
  ]);
  if (!t.data) notFound();
  const task = t.data as unknown as {
    id: string;
    title: string;
    status: string;
    due_on: string | null;
    created_at: string;
    done_at: string | null;
    asset_id: string | null;
    institution_id: string | null;
  };
  const asset = (
    (assets.data ?? []) as unknown as { id: string; nickname: string; label: string | null }[]
  ).find((a) => a.id === task.asset_id);
  const inst = ((insts.data ?? []) as unknown as { id: string; name: string }[]).find(
    (i) => i.id === task.institution_id,
  );
  const names = Object.fromEntries(
    ((owners.data ?? []) as unknown as { id: string; display_name: string }[]).map((o) => [
      o.id,
      o.display_name,
    ]),
  );
  const facts: Fact[] = [
    {
      label: 'Status',
      value: task.status === 'open' ? 'Open' : task.status === 'done' ? 'Done' : 'Dropped',
    },
    { label: 'Due', value: task.due_on ?? 'No date' },
    { label: 'Added', value: task.created_at.slice(0, 10) },
  ];
  if (task.done_at) facts.push({ label: 'Completed', value: task.done_at.slice(0, 10) });
  if (asset)
    facts.push({
      label: 'About the account',
      value: asset.label ?? asset.nickname,
      href: `/asset/${asset.id}`,
    });
  if (inst) facts.push({ label: 'About the bank', value: inst.name, href: `/bank/${inst.id}` });
  return {
    title: task.title,
    facts,
    activity: buildActivity({
      audit: audit.filter((r) => r.table_name === 'tasks' && r.row_id === id),
      viewerId: userId,
      names,
    }),
  };
}

export async function loadPolicyDetail(id: string) {
  if (!UUID.test(id)) notFound();
  const { supabase, householdId, userId } = await loadContext();
  if (!householdId) notFound();
  const [p, ins, audit, owners] = await Promise.all([
    supabase
      .from('policies')
      .select(
        'id, kind, insurer, coverage_text, policy_ref_last4, paid_by, renewal_on, expires_on, nominee_note, documents_note, notes',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase.from('policy_insured').select('owner_id').eq('policy_id', id),
    auditRows(supabase),
    supabase.from('owners').select('id, display_name').order('created_at'),
  ]);
  if (!p.data) notFound();
  const pol = p.data as unknown as Record<string, string | null>;
  const ownerList = ((owners.data ?? []) as unknown as { id: string; display_name: string }[]).map(
    (o) => ({ id: o.id, name: o.display_name }),
  );
  const names = Object.fromEntries(ownerList.map((o) => [o.id, o.name]));
  const facts: Fact[] = [
    { label: 'Insurer', value: pol.insurer ?? '' },
    { label: 'Kind', value: (pol.kind ?? '').replace(/_/g, ' ') },
  ];
  const add = (label: string, v: string | null | undefined) => v && facts.push({ label, value: v });
  add('Cover', pol.coverage_text);
  if (pol.policy_ref_last4)
    facts.push({ label: 'Policy number', value: `…${pol.policy_ref_last4}` });
  add('Paid by', pol.paid_by);
  add('Renewal', pol.renewal_on);
  add('Cover ends', pol.expires_on);
  const insured = ((ins.data ?? []) as unknown as { owner_id: string }[])
    .map((x) => names[x.owner_id])
    .filter(Boolean)
    .join(', ');
  add('Insured', insured);
  add('Nominee', pol.nominee_note);
  add('Documents', pol.documents_note);
  add('Notes', pol.notes);
  return {
    title: `${pol.insurer ?? 'Policy'}${pol.coverage_text ? ` · ${pol.coverage_text}` : ''}`,
    facts,
    /** the stored values, for the edit form */
    edit: {
      id,
      kind: pol.kind ?? 'other',
      insurer: pol.insurer ?? '',
      coverage: pol.coverage_text ?? '',
      ref: pol.policy_ref_last4 ?? '',
      paidBy: pol.paid_by ?? '',
      renewalOn: pol.renewal_on ?? '',
      expiresOn: pol.expires_on ?? '',
      nominee: pol.nominee_note ?? '',
      documents: pol.documents_note ?? '',
      notes: pol.notes ?? '',
      insuredIds: ((ins.data ?? []) as unknown as { owner_id: string }[]).map((x) => x.owner_id),
      people: ownerList,
    },
    activity: buildActivity({
      audit: audit.filter((r) => r.table_name === 'policies' && r.row_id === id),
      viewerId: userId,
      names,
    }),
  };
}
