import type { Ctx } from './data';
import { sipPlanView, type SipPlanView } from './sip-plan';

const COUNTED = new Set(['active', 'stopped']);

/**
 * The fund's SIP plan from the database: its position, its dated changes and the same person's rupee savings accounts (the ones it can be
 * paid from). The account link is a newer column: before the database has it, the plan shows with no account.
 */
export async function loadSipPlan(
  supabase: Ctx['supabase'],
  assetId: string,
  today: string,
): Promise<SipPlanView | null> {
  const [fund, pos, changes] = await Promise.all([
    supabase.from('assets').select('id, owner_id').eq('id', assetId).maybeSingle(),
    supabase.from('mf_positions').select('*').eq('asset_id', assetId).maybeSingle(),
    supabase
      .from('mf_sip_changes')
      .select('effective_on, monthly')
      .eq('asset_id', assetId)
      .order('effective_on'),
  ]);
  const f = fund.data as { id: string; owner_id: string } | null;
  const p = pos.data as Record<string, unknown> | null;
  if (!f || !p) return null;
  const [accounts, banks] = await Promise.all([
    supabase
      .from('assets')
      .select('id, label, nickname, status, currency, institution_id, identifier_last4')
      .eq('owner_id', f.owner_id)
      .eq('type', 'bank_account')
      .eq('currency', 'INR'),
    supabase.from('institutions').select('id, name'),
  ]);
  const bank = new Map(
    ((banks.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]),
  );
  const list = ((accounts.data ?? []) as Record<string, unknown>[])
    .filter((a) => COUNTED.has(a.status as string))
    .map((a) => {
      const name = ((a.label as string | null) || (a.nickname as string)) ?? 'Account';
      const at = a.institution_id ? bank.get(a.institution_id as string) : undefined;
      return { id: a.id as string, label: at ? `${at} · ${name}` : name };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return sipPlanView({
    assetId,
    startedOn: (p.started_on as string | null) ?? null,
    sipMonthly:
      p.sip_monthly === null || p.sip_monthly === undefined ? null : Number(p.sip_monthly),
    sipStopped: !!p.sip_stopped,
    changes: ((changes.data ?? []) as { effective_on: string; monthly: number }[]).map((c) => ({
      on: c.effective_on,
      monthly: Number(c.monthly),
    })),
    payFrom: (p.sip_from_asset_id as string | null | undefined) ?? null,
    accounts: list,
    today,
  });
}
