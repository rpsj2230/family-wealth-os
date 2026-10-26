'use server';

import { revalidatePath } from 'next/cache';
import {
  configFromJson,
  fyBoundsOf,
  LIQUIDITY_KINDS,
  parseContactLines,
  profileFromJson,
} from '@fwos/core';
import { loadContext } from '@/lib/data';

const EMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;

export async function saveDigestSettings(formData: FormData): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const enabled = formData.get('enabled') === 'on';
  const includeRetirement = formData.get('include_retirement') === 'on';
  const extra = String(formData.get('extra') ?? '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => EMAIL.test(e))
    .slice(0, 5);
  await supabase.from('digest_settings').upsert({
    household_id: householdId,
    enabled,
    extra_recipients: [...new Set(extra)],
    include_retirement: includeRetirement,
    updated_at: new Date().toISOString(),
  });
  revalidatePath('/settings');
}

/** The AI key is write-only: it is saved here and read back only by the scheduled reader. */
export async function saveIntegrations(formData: FormData): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const provider = String(formData.get('provider') ?? '');
  const key = String(formData.get('key') ?? '').trim();
  const clear = formData.get('clear') === 'on';
  const label =
    String(formData.get('label') ?? '')
      .trim()
      .slice(0, 100) || 'FWOS/Inbox';
  await supabase.rpc('save_integrations', {
    p_household: householdId,
    p_provider: provider === 'groq' || provider === 'gemini' ? provider : null,
    p_key: key.length >= 8 && key.length <= 300 ? key : null,
    p_label: label,
    p_clear: clear,
  });
  revalidatePath('/settings');
}

const uuid = /^[0-9a-f-]{36}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const numeric = (f: FormData, k: string) => {
  const v = field(f, k).replace(/[₹,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
};
const pct = (f: FormData, k: string) => {
  const n = numeric(f, k.replace(/%$/, ''));
  return n === null ? null : n / 100;
};

export interface FormResult {
  ok: boolean;
  message: string;
}

/** A person's profile: date of birth, PAN (write-only), residency, guardian, role in the retirement plan. */
export async function saveOwnerProfile(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const owner = field(f, 'owner');
  if (!uuid.test(owner)) return { ok: false, message: 'Unknown person.' };
  const dob = field(f, 'dob');
  if (dob && (!isoDate.test(dob) || dob > new Date().toISOString().slice(0, 10)))
    return { ok: false, message: 'Enter a valid date of birth.' };
  const pan = field(f, 'pan').toUpperCase();
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan))
    return { ok: false, message: 'A PAN looks like ABCDE1234F.' };
  const guardian = field(f, 'guardian');
  const role = field(f, 'planRole');
  const payload: Record<string, unknown> = {
    dob,
    taxResidency: field(f, 'residency'),
    guardianId: uuid.test(guardian) ? guardian : '',
    planRole: role === 'primary' || role === 'spouse' ? role : '',
    isMinor: f.get('minor') === 'on',
    notes: field(f, 'notes').slice(0, 500),
  };
  if (pan) payload.pan = pan;
  if (f.get('clearPan') === 'on') payload.clearPan = true;
  const { error } = await supabase.rpc('save_owner_profile', {
    p_household: householdId,
    p_owner: owner,
    p: payload,
  });
  if (error)
    return {
      ok: false,
      message: /primary|spouse|unique/i.test(error.message)
        ? 'Only one person can be the primary and one the spouse.'
        : 'That could not be saved.',
    };
  revalidatePath('/settings');
  revalidatePath('/retire');
  return { ok: true, message: 'Saved.' };
}

export async function addCashflow(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const kind = field(f, 'kind');
  const label = field(f, 'label').slice(0, 80);
  const amount = numeric(f, 'amount');
  const currency = field(f, 'currency').toUpperCase() || 'INR';
  const owner = field(f, 'owner');
  if (!['income', 'expense'].includes(kind) || !label || amount === null || amount < 0)
    return { ok: false, message: 'Enter a label and an amount.' };
  if (!/^[A-Z]{3}$/.test(currency))
    return { ok: false, message: 'Currency is three letters, for example SGD.' };
  const { error } = await supabase.from('cashflow_items').insert({
    household_id: householdId,
    kind,
    label,
    amount,
    currency,
    frequency: field(f, 'frequency') === 'yearly' ? 'yearly' : 'monthly',
    owner_id: uuid.test(owner) ? owner : null,
    starts_on: isoDate.test(field(f, 'from')) ? field(f, 'from') : null,
    ends_on: isoDate.test(field(f, 'to')) ? field(f, 'to') : null,
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/settings');
  return { ok: true, message: 'Added.' };
}

export async function deleteCashflow(f: FormData): Promise<void> {
  const id = field(f, 'id');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  await supabase.from('cashflow_items').delete().eq('id', id);
  revalidatePath('/settings');
}

/** Limits and reminder windows. Values are checked and clamped by the same rules the app reads them with. */
export async function saveConfig(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const days = field(f, 'alertDays')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 365))
    return {
      ok: false,
      message: 'Alert days: whole numbers between 1 and 365, separated by commas.',
    };
  const raw = {
    deposits: { insuranceLimit: numeric(f, 'limit'), maturityAlertDays: days },
    reminders: {
      policyDays: numeric(f, 'policyDays'),
      taskDays: numeric(f, 'taskDays'),
      maturitySoonDays: numeric(f, 'soonDays'),
      harvestMonth: numeric(f, 'harvestMonth'),
      harvestDay: numeric(f, 'harvestDay'),
    },
    estimates: {
      savingsRate: pct(f, 'savingsRate'),
      interestTdsRate: pct(f, 'tdsRate'),
      includeSip: f.get('includeSip') === 'on',
    },
    rates: {
      staleDays: numeric(f, 'rateStale'),
      minRateGap: pct(f, 'rateGap'),
      minAnnualGain: numeric(f, 'rateGain'),
      nroTaxRate: pct(f, 'nroTax'),
      defaultTenureMonths: numeric(f, 'rateTenure'),
      fdLookaheadDays: numeric(f, 'rateLook'),
      savingsBuffer: numeric(f, 'rateBuffer'),
    },
    refunds: { incomeLimit: numeric(f, 'incomeLimit'), otherIncome: numeric(f, 'otherIncome') },
    harvest: {
      minSellAmount: numeric(f, 'minSell'),
      holdingMarginMonths: numeric(f, 'margin'),
      skipActiveSip: f.get('skipSip') === 'on',
      nri: f.get('nri') === 'on',
    },
  };
  const existing = await supabase.from('household_config').select('config').maybeSingle();
  const prior = (existing.data as { config?: { liquidity?: unknown } } | null)?.config;
  const clean = configFromJson({ ...raw, liquidity: prior?.liquidity });
  const { error } = await supabase
    .from('household_config')
    .upsert({ household_id: householdId, config: clean, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Saved. Everything that used these numbers now uses the new ones.' };
}

/** Tax rules for one financial year; they replace the built-in numbers for that year. */
export async function saveTaxRule(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const fy = field(f, 'fy');
  if (!fyBoundsOf(fy)) return { ok: false, message: 'Financial year looks like 2027-28.' };
  const months = numeric(f, 'months');
  const stcg = pct(f, 'stcg');
  const ltcg = pct(f, 'ltcg');
  const ex = numeric(f, 'exemption');
  const cess = pct(f, 'cess');
  if (
    months === null ||
    months < 1 ||
    months > 60 ||
    stcg === null ||
    stcg < 0 ||
    stcg >= 1 ||
    ltcg === null ||
    ltcg < 0 ||
    ltcg >= 1 ||
    ex === null ||
    ex < 0 ||
    cess === null ||
    cess < 0 ||
    cess >= 1
  )
    return {
      ok: false,
      message: 'Check the numbers: months 1–60, rates between 0 and 100%, allowance zero or more.',
    };
  const { error } = await supabase.from('tax_rules').upsert({
    household_id: householdId,
    fy,
    holding_months_long: Math.round(months),
    stcg_rate: stcg,
    ltcg_rate: ltcg,
    ltcg_exemption: ex,
    cess,
    verified: f.get('verified') === 'on',
    source_note: field(f, 'note').slice(0, 300) || null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: `Tax rules for ${fy} saved.` };
}

export async function resetTaxRule(f: FormData): Promise<void> {
  const fy = field(f, 'fy');
  if (!fyBoundsOf(fy)) return;
  const { supabase } = await loadContext();
  await supabase.from('tax_rules').delete().eq('fy', fy);
  revalidatePath('/', 'layout');
}

export async function addRateSource(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const bank = field(f, 'bank').slice(0, 80);
  const url = field(f, 'url');
  if (!bank || !/^https:\/\/[^\s]+$/.test(url) || url.length > 500)
    return {
      ok: false,
      message: 'Enter the bank and the full address of its rate page, starting with https://',
    };
  const { error } = await supabase
    .from('rate_sources')
    .insert({ household_id: householdId, bank, url });
  if (error) return { ok: false, message: 'That page is already listed, or could not be saved.' };
  revalidatePath('/settings');
  return { ok: true, message: 'Added. It is read at the next weekly refresh.' };
}

export async function deleteRateSource(f: FormData): Promise<void> {
  const id = field(f, 'id');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  await supabase.from('rate_sources').delete().eq('id', id);
  revalidatePath('/settings');
}

/** When the read-only family login may open the handbook. */
export async function saveEmergencyAccess(f: FormData): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const mode = ['always', 'inactive', 'manual'].find((m) => m === f.get('mode')) ?? 'always';
  const days = Math.min(365, Math.max(7, Math.round(numeric(f, 'days') ?? 30)));
  const intent = field(f, 'intent');
  const row: Record<string, unknown> = {
    household_id: householdId,
    mode,
    inactive_days: days,
    updated_at: new Date().toISOString(),
  };
  if (intent === 'release') row.released = true;
  if (intent === 'lock') row.released = false;
  await supabase.from('emergency_access').upsert(row, { onConflict: 'household_id' });
  revalidatePath('/settings');
  revalidatePath('/emergency');
}

/** Information the family needs that is not a balance: contacts, where documents are, a message. */
export async function saveEmergencyProfile(
  _p: FormResult | null,
  f: FormData,
): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const clean = profileFromJson({
    message: field(f, 'message'),
    contacts: parseContactLines(String(f.get('contacts') ?? '')),
    advisors: parseContactLines(String(f.get('advisors') ?? '')),
    willLocation: field(f, 'willLocation'),
    documentsLocation: field(f, 'documentsLocation'),
    passwordManager: field(f, 'passwordManager'),
    devices: field(f, 'devices'),
    emailAccounts: field(f, 'emailAccounts'),
    lockerDetails: field(f, 'lockerDetails'),
    backupKeyLocation: field(f, 'backupKeyLocation'),
    nominees: field(f, 'nominees'),
    instructions: field(f, 'instructions'),
  });
  const { error } = await supabase
    .from('emergency_profile')
    .upsert({ household_id: householdId, content: clean, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/emergency');
  revalidatePath('/settings');
  return { ok: true, message: 'Saved. The handbook now includes this.' };
}

/** How the "I need money" planner chooses: which kinds of money it may use, in what order, and what each costs. */
export async function saveLiquidity(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const order = LIQUIDITY_KINDS.map((k, i) => ({
    k,
    i,
    on: f.get(`on_${k}`) === 'on',
    p: numeric(f, `pri_${k}`) ?? i + 1,
  }))
    .filter((x) => x.on)
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.k);
  const days = field(f, 'scenarioDays')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  const existing = await supabase.from('household_config').select('config').maybeSingle();
  const prior = ((existing.data as { config?: Record<string, unknown> } | null)?.config ??
    {}) as Record<string, unknown>;
  const clean = configFromJson({
    ...prior,
    liquidity: {
      order,
      mode: field(f, 'mode'),
      keepInBank: numeric(f, 'keepInBank'),
      fdPenaltyPoints: pct(f, 'fdPenalty'),
      fdPartialBreak: f.get('fdPartial') === 'on',
      fdBreakDays: numeric(f, 'fdBreakDays'),
      mfSettlementDays: numeric(f, 'mfDays'),
      stockSettlementDays: numeric(f, 'stockDays'),
      foreignCashDays: numeric(f, 'foreignDays'),
      exitLoadPct: pct(f, 'exitLoad'),
      assumedGainShare: pct(f, 'gainShare'),
      propertySaleDays: numeric(f, 'propDays'),
      propertyCostPct: pct(f, 'propCost'),
      receivableDays: numeric(f, 'recvDays'),
      scenarioDays: days,
    },
  });
  const { error } = await supabase
    .from('household_config')
    .upsert({ household_id: householdId, config: clean, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Saved. The "I need money" page now follows these choices.' };
}
