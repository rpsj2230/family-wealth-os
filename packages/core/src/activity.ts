/**
 * Turns an audit-log row (what the database recorded when a row was added, changed or removed) into plain words and a
 * field-by-field list of what changed. Pure: the pages fetch the rows and only draw what this returns.
 * Noise (ids, creation times, sheet order) is left out; amounts, rates, dates and yes/no values are written the way the app writes them.
 */
export interface AuditRow {
  table_name: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ActivityChange {
  label: string;
  before: string | null;
  after: string | null;
}

export interface ActivityDescription {
  title: string;
  changes: ActivityChange[];
}

const LABEL: Record<string, string> = {
  nickname: 'Name',
  label: 'Sheet label',
  account_kind: 'Account type',
  is_joint: 'Joint account',
  identifier_last4: 'Last 4 digits',
  linked_last4: 'Linked savings (last 4)',
  status: 'Status',
  notes: 'Notes',
  holder_name: 'Held by',
  owner_id: 'Person',
  institution_id: 'Bank',
  currency: 'Currency',
  expected_freshness_days: 'Update reminder (days)',
  interest_rate: 'Interest rate',
  tds_rate: 'Tax at source',
  principal: 'Principal',
  rate: 'Rate',
  booked_on: 'Start date',
  maturity_on: 'Maturity date',
  compounding: 'Compounding',
  bank_maturity_amount: 'Amount at maturity',
  fd_ref_last4: 'Deposit number (last 4)',
  invested: 'Invested',
  started_on: 'Started',
  sip_monthly: 'SIP a month',
  sip_stopped: 'SIP stopped',
  folio_last4: 'Folio (last 4)',
  isin: 'ISIN',
  amfi_code: 'Fund code',
  fund_name: 'Fund',
  plan_type: 'Plan',
  counterparty: 'Borrower',
  lent: 'Lent',
  lent_on: 'Lent on',
  expected_on: 'Expected back',
  interest_note: 'Interest note',
  title: 'Task',
  due_on: 'Due',
  done_at: 'Completed',
  kind: 'Kind',
  insurer: 'Insurer',
  coverage_text: 'Cover',
  renewal_on: 'Renewal',
  expires_on: 'Cover ends',
  nominee_note: 'Nominee',
  documents_note: 'Documents',
  paid_by: 'Paid by',
  policy_ref_last4: 'Policy (last 4)',
  amount: 'Amount',
  paid_on: 'Paid on',
  note: 'Note',
  as_of: 'As of',
  confidence: 'Confidence',
  source: 'Source',
};

/** Fields never shown: they say nothing a person would care about. */
const HIDDEN = new Set([
  'id',
  'household_id',
  'created_at',
  'updated_at',
  'received_at',
  'sort_order',
  'asset_id',
  'superseded_by',
  'fx_rate',
  'kind_inferred',
]);

const MONEY = new Set([
  'principal',
  'bank_maturity_amount',
  'invested',
  'sip_monthly',
  'lent',
  'amount',
]);
const PERCENT = new Set(['interest_rate', 'tds_rate', 'rate']);
const DATES = new Set([
  'booked_on',
  'maturity_on',
  'started_on',
  'lent_on',
  'expected_on',
  'due_on',
  'renewal_on',
  'expires_on',
  'paid_on',
  'as_of',
  'done_at',
]);

const SOURCE: Record<string, string> = {
  email: 'a bank e-mail',
  statement: 'a statement',
  cas: 'a fund statement',
  api: 'an automatic update',
  workbook: 'the imported sheet',
  calculated: 'a calculation',
  manual: 'typed in',
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function niceDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : v;
}

export interface DescribeOptions {
  /** ids to names, for people, banks and the like */
  names?: Record<string, string>;
}

function show(key: string, v: unknown, o: DescribeOptions): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && o.names?.[v]) return o.names[v]!;
  const n = typeof v === 'number' ? v : Number(v);
  if (PERCENT.has(key) && Number.isFinite(n))
    return `${(n * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  if (MONEY.has(key) && Number.isFinite(n)) return inr(n);
  if (DATES.has(key) && typeof v === 'string') return niceDate(v);
  if (key === 'source' && typeof v === 'string') return SOURCE[v] ?? v;
  if (typeof v === 'string') return v.replace(/_/g, ' ');
  return String(v);
}

export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  o: DescribeOptions = {},
): ActivityChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: ActivityChange[] = [];
  for (const k of keys) {
    if (HIDDEN.has(k)) continue;
    const a = before?.[k] ?? null;
    const b = after?.[k] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const x = show(k, a, o);
    const y = show(k, b, o);
    if (x === y) continue;
    out.push({ label: LABEL[k] ?? k.replace(/_/g, ' '), before: x, after: y });
  }
  return out;
}

/** The values a new row starts with, as a list (nothing before). */
function startingValues(
  after: Record<string, unknown> | null,
  o: DescribeOptions,
): ActivityChange[] {
  return diffFields(null, after, o).filter((c) => c.after !== null);
}

const TXN_WORD: Record<string, string> = {
  purchase: 'Purchase',
  sip: 'SIP instalment',
  redeem: 'Sale',
  switch_in: 'Switch in',
  switch_out: 'Switch out',
  dividend_reinvest: 'Dividend reinvested',
  bonus: 'Bonus units',
  other: 'Transaction',
};

export function describeAudit(row: AuditRow, o: DescribeOptions = {}): ActivityDescription {
  const t = row.table_name;
  const a = row.after;
  const b = row.before;
  const cur = (a ?? b) as Record<string, unknown> | null;
  const insert = row.action === 'INSERT';
  const remove = row.action === 'DELETE';

  if (t === 'observations') {
    const amount = Number(cur?.amount);
    const day = typeof cur?.as_of === 'string' ? niceDate(cur.as_of) : 'a date';
    const money = Number.isFinite(amount) ? inr(amount) : 'a value';
    const cc =
      typeof cur?.currency === 'string' && cur.currency !== 'INR' ? `${cur.currency} ` : '';
    const src = typeof cur?.source === 'string' ? (SOURCE[cur.source] ?? cur.source) : null;
    const text = cc
      ? `${cc}${Number.isFinite(amount) ? amount.toLocaleString('en-IN') : ''}`
      : money;
    if (insert)
      return {
        title: `Balance ${text} recorded for ${day}${src ? ` (from ${src})` : ''}`,
        changes: [],
      };
    if (remove) return { title: `Balance ${text} for ${day} was removed`, changes: [] };
    if (a?.superseded_by && !b?.superseded_by)
      return { title: `Balance ${text} for ${day} was replaced by a newer entry`, changes: [] };
    return { title: `Balance for ${day} changed`, changes: diffFields(b, a, o) };
  }
  if (t === 'assets')
    return insert
      ? { title: `Added: ${String(a?.nickname ?? 'an account')}`, changes: startingValues(a, o) }
      : remove
        ? { title: `Removed: ${String(b?.nickname ?? 'an account')}`, changes: [] }
        : { title: 'Details changed', changes: diffFields(b, a, o) };
  if (t === 'fixed_deposits')
    return insert
      ? { title: 'Deposit terms recorded', changes: startingValues(a, o) }
      : remove
        ? { title: 'Deposit terms removed', changes: [] }
        : { title: 'Deposit terms changed', changes: diffFields(b, a, o) };
  if (t === 'mf_positions')
    return insert
      ? { title: 'Fund position recorded', changes: startingValues(a, o) }
      : remove
        ? { title: 'Fund position removed', changes: [] }
        : { title: 'Fund position updated', changes: diffFields(b, a, o) };
  if (t === 'mf_transactions') {
    const line = (r: Record<string, unknown> | null) => {
      const amount = Math.abs(Number(r?.amount));
      const day = typeof r?.txn_on === 'string' ? niceDate(r.txn_on) : 'a date';
      const kind = TXN_WORD[String(r?.kind)] ?? 'Transaction';
      return `${kind} of ${Number.isFinite(amount) ? inr(amount) : 'an amount'} on ${day}`;
    };
    if (insert) return { title: `Transaction typed in: ${line(a)}`, changes: [] };
    if (remove)
      return {
        title: `Transaction deleted: ${line(b)}${b?.source === 'cas' ? ' (a fund statement line)' : ''}`,
        changes: [],
      };
    if (a?.superseded_on && !b?.superseded_on)
      return { title: `Set aside, replaced by a fund statement: ${line(b)}`, changes: [] };
    if (b?.superseded_on && !a?.superseded_on)
      return { title: `Brought back by a fund statement: ${line(a)}`, changes: [] };
    const changes = (
      [
        ['txn_on', 'Date', (v: unknown) => (typeof v === 'string' ? niceDate(v) : '–')],
        ['kind', 'Type', (v: unknown) => TXN_WORD[String(v)] ?? String(v)],
        ['amount', 'Amount', (v: unknown) => inr(Math.abs(Number(v)))],
        ['units', 'Units', (v: unknown) => Math.abs(Number(v)).toLocaleString('en-IN')],
        ['nav', 'Price per unit', (v: unknown) => (v === null ? '–' : `₹${Number(v)}`)],
      ] as const
    )
      .filter(([k]) => String(b?.[k] ?? '') !== String(a?.[k] ?? ''))
      .map(([k, label, f]) => ({ label, before: f(b?.[k] ?? null), after: f(a?.[k] ?? null) }));
    return { title: `Transaction corrected: ${line(a)}`, changes };
  }
  if (t === 'mf_sip_changes') {
    const day = (r: Record<string, unknown> | null) =>
      typeof r?.effective_on === 'string' ? niceDate(r.effective_on) : 'a date';
    const amount = (r: Record<string, unknown> | null) => Number(r?.monthly);
    const what = (r: Record<string, unknown> | null) =>
      amount(r) > 0
        ? `SIP of ${inr(amount(r))} a month from ${day(r)}`
        : `SIP stopped from ${day(r)}`;
    if (remove) return { title: `Taken back: ${what(b)}`, changes: [] };
    return { title: insert ? what(a) : `Changed: ${what(a)}`, changes: [] };
  }
  if (t === 'receivables')
    return insert
      ? {
          title: `Loan recorded: ${inr(Number(a?.lent))} to ${String(a?.counterparty ?? 'someone')}`,
          changes: [],
        }
      : remove
        ? { title: 'Loan removed', changes: [] }
        : { title: 'Loan details changed', changes: diffFields(b, a, o) };
  if (t === 'receivable_payments')
    return insert
      ? {
          title: `Repayment of ${inr(Number(a?.amount))} recorded${typeof a?.paid_on === 'string' ? ` for ${niceDate(a.paid_on)}` : ''}`,
          changes: [],
        }
      : remove
        ? { title: 'A repayment was removed', changes: [] }
        : { title: 'A repayment was changed', changes: diffFields(b, a, o) };
  if (t === 'tasks') {
    if (insert) return { title: `Task added: ${String(a?.title ?? '')}`, changes: [] };
    if (remove) return { title: `Task removed: ${String(b?.title ?? '')}`, changes: [] };
    const ch = diffFields(b, a, o);
    if (b?.status !== a?.status)
      return {
        title:
          a?.status === 'done'
            ? 'Task marked done'
            : a?.status === 'dropped'
              ? 'Task dropped'
              : 'Task reopened',
        changes: ch.filter((c) => c.label !== 'Status' && c.label !== 'Completed'),
      };
    return { title: 'Task changed', changes: ch };
  }
  if (t === 'policies')
    return insert
      ? { title: `Policy added: ${String(a?.insurer ?? '')}`, changes: startingValues(a, o) }
      : remove
        ? { title: 'Policy removed', changes: [] }
        : { title: 'Policy details changed', changes: diffFields(b, a, o) };
  if (t === 'institutions') {
    const ch = diffFields(b, a, o);
    if (!insert && !remove && ch.length === 1 && ch[0]!.label === 'Notes')
      return { title: 'Bank note changed', changes: ch };
    return insert
      ? { title: `Bank added: ${String(a?.name ?? '')}`, changes: [] }
      : remove
        ? { title: 'Bank removed', changes: [] }
        : { title: 'Bank details changed', changes: ch };
  }
  return {
    title: `${insert ? 'Added to' : remove ? 'Removed from' : 'Changed in'} ${t.replace(/_/g, ' ')}`,
    changes: insert ? startingValues(a, o) : diffFields(b, a, o),
  };
}
