'use server';

import { revalidatePath } from 'next/cache';
import { parseAmount, parseRateNotes, sameBank } from '@fwos/core';
import { diagnoseMisread, type CorrectionReason, type ParsedOffer } from '@fwos/ingest';
import { loadContext } from '@/lib/data';

export interface RateResult {
  ok: boolean;
  message: string;
}

type Db = Awaited<ReturnType<typeof loadContext>>['supabase'];
const today = () => new Date().toISOString().slice(0, 10);
const uuid = /^[0-9a-f-]{36}$/;
const REASONS: CorrectionReason[] = [
  'senior_citizen',
  'wrong_tenure',
  'wrong_slab',
  'nro_nre',
  'outdated',
  'other',
];

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').replace(/[%\s,]/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

const refresh = () => {
  revalidatePath('/rates', 'layout');
  revalidatePath('/new-money');
  revalidatePath('/accounts');
};

interface OfferRow {
  id: string;
  household_id: string;
  bank: string;
  product: 'savings' | 'fd';
  account_kind: string;
  tenure_from_months: number;
  tenure_to_months: number;
  balance_from: number | null;
  balance_to: number | null;
  rate: number;
  source_kind: 'manual' | 'ai';
  ai_rate: number | null;
}

const COLS =
  'id, household_id, bank, product, account_kind, tenure_from_months, tenure_to_months, balance_from, balance_to, rate, source_kind, ai_rate';

async function sameBankOffers(db: Db, bank: string): Promise<OfferRow[]> {
  const r = await db.from('rate_offers').select(COLS);
  return ((r.data ?? []) as unknown as OfferRow[])
    .map((o) => ({
      ...o,
      rate: Number(o.rate),
      ai_rate: o.ai_rate === null ? null : Number(o.ai_rate),
      balance_from: o.balance_from === null ? null : Number(o.balance_from),
      balance_to: o.balance_to === null ? null : Number(o.balance_to),
    }))
    .filter((o) => sameBank(o.bank, bank));
}

const asParsed = (o: OfferRow): ParsedOffer => ({
  bank: o.bank,
  product: o.product,
  accountKind: o.account_kind as ParsedOffer['accountKind'],
  tenureFromMonths: o.tenure_from_months,
  tenureToMonths: o.tenure_to_months,
  rate: o.rate,
  conditions: null,
  balanceFrom: o.balance_from,
  balanceTo: o.balance_to,
});

/**
 * You changed a rate. When the reader had read it, that is a correction: the reader's figure is remembered, the likely reason is
 * worked out and written down as a rule, and the next refresh is told the rule and checked against your figure.
 */
async function setRate(
  db: Db,
  ex: OfferRow,
  newRate: number,
  reason: CorrectionReason | null,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    rate: newRate,
    checked_on: today(),
    source_note: 'Edited by you',
    ...extra,
  };
  if (ex.source_kind === 'ai' && Math.abs(ex.rate - newRate) > 0.00005) {
    patch.source_kind = 'manual';
    patch.ai_rate = ex.rate;
    patch.correction_reason = reason ?? 'other';
    patch.corrected_on = today();
    patch.misread_count = 0;
    patch.page_rate = null;
    patch.page_seen_on = null;
    const others = (await sameBankOffers(db, ex.bank)).filter((o) => o.id !== ex.id).map(asParsed);
    const d = diagnoseMisread({
      slot: {
        bank: ex.bank,
        product: ex.product,
        accountKind: ex.account_kind,
        tenureFromMonths: ex.tenure_from_months,
        tenureToMonths: ex.tenure_to_months,
        balanceFrom: ex.balance_from,
        balanceTo: ex.balance_to,
      },
      wrong: ex.rate,
      right: newRate,
      fetched: others,
      reason,
    });
    patch.correction_reason = d.cause;
    const known = await db
      .from('rate_hints')
      .select('id')
      .eq('household_id', ex.household_id)
      .eq('hint', d.hint)
      .limit(1);
    if (!known.error && (known.data ?? []).length === 0)
      await db
        .from('rate_hints')
        .insert({ household_id: ex.household_id, bank: ex.bank, cause: d.cause, hint: d.hint });
  }
  const u = await db.from('rate_offers').update(patch).eq('id', ex.id);
  return !u.error;
}

/** A rate typed in the form. Saving a slot that exists changes it in place, so its history stays in one line. */
export async function addRateOffer(_p: RateResult | null, f: FormData): Promise<RateResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const bank = String(f.get('bank') ?? '')
    .trim()
    .slice(0, 80);
  const product = String(f.get('product') ?? '');
  const kind = String(f.get('kind') ?? 'any');
  const pct = num(f.get('rate'));
  const from = num(f.get('from')) ?? 0;
  const to = num(f.get('to')) ?? from;
  if (
    !bank ||
    !['savings', 'fd'].includes(product) ||
    !['NRE', 'NRO', 'resident', 'any'].includes(kind)
  )
    return { ok: false, message: 'Choose a bank, product and account type.' };
  if (pct === null || pct < 0.5 || pct > 20)
    return { ok: false, message: 'Rate is a percentage such as 7.25.' };
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > 240)
    return { ok: false, message: 'Tenure is in whole months, from the shortest to the longest.' };
  const balFrom = String(f.get('balfrom') ?? '').trim()
    ? parseAmount(String(f.get('balfrom')))
    : null;
  const balTo = String(f.get('balto') ?? '').trim() ? parseAmount(String(f.get('balto'))) : null;
  if (product === 'savings' && balTo !== null && balTo <= (balFrom ?? 0))
    return { ok: false, message: 'The balance limit must be above the start of the slab.' };
  const rate = Math.round(pct * 100) / 10_000;
  const mine = await sameBankOffers(supabase, bank);
  const canon = mine[0]?.bank ?? bank;
  const tf = product === 'savings' ? 0 : from;
  const tt = product === 'savings' ? 0 : to;
  const bf = product === 'savings' ? (balFrom === 0 ? null : balFrom) : null;
  const bt = product === 'savings' ? balTo : null;
  const ex = mine.find(
    (o) =>
      o.product === product &&
      o.account_kind === kind &&
      o.tenure_from_months === tf &&
      o.tenure_to_months === tt &&
      (o.balance_from ?? 0) === (bf ?? 0) &&
      (o.balance_to ?? -1) === (bt ?? -1),
  );
  const conditions =
    String(f.get('conditions') ?? '')
      .trim()
      .slice(0, 200) || null;
  if (ex) {
    const ok = await setRate(supabase, ex, rate, 'other', { conditions });
    if (!ok) return { ok: false, message: 'That could not be saved.' };
  } else {
    const ins = await supabase.from('rate_offers').insert({
      household_id: householdId,
      bank: canon,
      product,
      account_kind: kind,
      tenure_from_months: tf,
      tenure_to_months: tt,
      balance_from: bf,
      balance_to: bt,
      rate,
      conditions,
      source_kind: 'manual',
      source_url: null,
      source_note: 'Typed in the form',
      checked_on: today(),
    });
    if (ins.error) return { ok: false, message: 'That could not be saved.' };
  }
  refresh();
  return { ok: true, message: 'Saved.' };
}

/** Changing the rate of an existing row from the bank's page. */
export async function saveRate(_p: RateResult | null, f: FormData): Promise<RateResult> {
  const { supabase } = await loadContext();
  const id = String(f.get('id') ?? '');
  const pct = num(f.get('rate'));
  const reasonRaw = String(f.get('reason') ?? '');
  const reason = (REASONS as string[]).includes(reasonRaw) ? (reasonRaw as CorrectionReason) : null;
  if (!uuid.test(id)) return { ok: false, message: 'Not a valid row.' };
  if (pct === null || pct < 0.5 || pct > 20)
    return { ok: false, message: 'Rate is a percentage such as 7.25.' };
  const r = await supabase.from('rate_offers').select(COLS).eq('id', id).maybeSingle();
  const row = r.data as unknown as OfferRow | null;
  if (!row) return { ok: false, message: 'That rate no longer exists.' };
  const ok = await setRate(
    supabase,
    {
      ...row,
      rate: Number(row.rate),
      ai_rate: row.ai_rate === null ? null : Number(row.ai_rate),
      balance_from: row.balance_from === null ? null : Number(row.balance_from),
      balance_to: row.balance_to === null ? null : Number(row.balance_to),
    },
    Math.round(pct * 100) / 10_000,
    reason,
  );
  if (!ok) return { ok: false, message: 'That could not be saved.' };
  refresh();
  return { ok: true, message: 'Saved.' };
}

/** Take the figure the bank's page shows now and let the automatic refresh own the rate again. */
export async function acceptPageRate(f: FormData): Promise<void> {
  const id = String(f.get('id') ?? '');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  const r = await supabase.from('rate_offers').select('page_rate').eq('id', id).maybeSingle();
  const page = (r.data as { page_rate: number | null } | null)?.page_rate;
  if (page === null || page === undefined) return;
  await supabase
    .from('rate_offers')
    .update({
      rate: page,
      source_kind: 'ai',
      ai_rate: null,
      correction_reason: null,
      corrected_on: null,
      misread_count: 0,
      page_rate: null,
      page_seen_on: null,
      checked_on: today(),
    })
    .eq('id', id);
  refresh();
}

export async function deleteRateOffer(f: FormData): Promise<void> {
  const id = String(f.get('id') ?? '');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  await supabase.from('rate_offers').delete().eq('id', id);
  refresh();
}

export async function toggleHint(f: FormData): Promise<void> {
  const id = String(f.get('id') ?? '');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  const r = await supabase.from('rate_hints').select('active').eq('id', id).maybeSingle();
  if (!r.data) return;
  await supabase
    .from('rate_hints')
    .update({ active: !(r.data as { active: boolean }).active })
    .eq('id', id);
  refresh();
}

/**
 * Rates pasted as notes, one bank per line (see parseRateNotes). Each bank is matched to the bank name already used, existing
 * slots are changed in place, new ones added, and typed slots for the pasted bank and product that are no longer in the paste
 * are removed, so pasting an updated list never leaves old slabs behind.
 */
export async function importRateNotes(_p: RateResult | null, f: FormData): Promise<RateResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const text = String(f.get('notes') ?? '').slice(0, 20_000);
  const { offers, problems } = parseRateNotes(text);
  if (offers.length === 0)
    return {
      ok: false,
      message: `No rates could be read. ${problems.slice(0, 3).join(' ')}`.trim(),
    };
  const inst = await supabase.from('institutions').select('name');
  const names = ((inst.data ?? []) as { name: string }[]).map((i) => i.name);
  const allOffers = ((await supabase.from('rate_offers').select(COLS)).data ??
    []) as unknown as OfferRow[];
  const canonOf = (b: string) =>
    allOffers.find((o) => sameBank(o.bank, b))?.bank ?? names.find((n) => sameBank(n, b)) ?? b;
  let added = 0;
  let changed = 0;
  let removed = 0;
  const kept = new Set<string>();
  const pairs = new Set<string>();
  for (const o of offers) {
    const bank = canonOf(o.bank);
    pairs.add(`${bank}|${o.product}`);
    const ex = allOffers.find(
      (e) =>
        sameBank(e.bank, bank) &&
        e.product === o.product &&
        e.account_kind === o.accountKind &&
        e.tenure_from_months === o.tenureFromMonths &&
        e.tenure_to_months === o.tenureToMonths &&
        Number(e.balance_from ?? 0) === (o.balanceFrom ?? 0) &&
        Number(e.balance_to ?? -1) === (o.balanceTo ?? -1),
    );
    if (ex) {
      kept.add(ex.id);
      const ok = await setRate(
        supabase,
        {
          ...ex,
          rate: Number(ex.rate),
          ai_rate: ex.ai_rate === null ? null : Number(ex.ai_rate),
          balance_from: ex.balance_from === null ? null : Number(ex.balance_from),
          balance_to: ex.balance_to === null ? null : Number(ex.balance_to),
        },
        o.rate,
        'other',
        { tenure_days: o.tenureDays, source_note: 'Pasted notes' },
      );
      if (!ok) return { ok: false, message: 'Some rates could not be saved.' };
      if (Math.abs(Number(ex.rate) - o.rate) > 0.00005) changed++;
    } else {
      const ins = await supabase.from('rate_offers').insert({
        household_id: householdId,
        bank,
        product: o.product,
        account_kind: o.accountKind,
        tenure_from_months: o.tenureFromMonths,
        tenure_to_months: o.tenureToMonths,
        tenure_days: o.tenureDays,
        balance_from: o.balanceFrom,
        balance_to: o.balanceTo,
        rate: o.rate,
        conditions: null,
        source_kind: 'manual',
        source_url: null,
        source_note: 'Pasted notes',
        checked_on: today(),
      });
      if (ins.error) return { ok: false, message: 'Some rates could not be saved.' };
      added++;
    }
  }
  for (const e of allOffers)
    if (
      e.source_kind === 'manual' &&
      !kept.has(e.id) &&
      [...pairs].some((p) => {
        const [b, pr] = p.split('|') as [string, string];
        return sameBank(e.bank, b) && e.product === pr;
      })
    ) {
      await supabase.from('rate_offers').delete().eq('id', e.id);
      removed++;
    }
  refresh();
  const banks = new Set([...pairs].map((p) => p.split('|')[0]));
  return {
    ok: true,
    message: `${banks.size} banks: ${added} added, ${changed} changed${removed ? `, ${removed} removed` : ''}.${problems.length ? ` Could not read: ${problems.slice(0, 3).join('; ')}.` : ''}`,
  };
}
