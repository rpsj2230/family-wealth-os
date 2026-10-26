import { tidyPlan } from '@fwos/core';
import type { Ctx } from './data';

/** The plan for moving bank-level facts out of account notes, from what is stored now. */
export async function loadTidyPlan(supabase: Ctx['supabase']) {
  const [assets, inst, owners] = await Promise.all([
    supabase
      .from('assets')
      .select('id, owner_id, institution_id, nickname, label, notes')
      .not('notes', 'is', null),
    supabase.from('institutions').select('id, name, notes'),
    supabase.from('owners').select('id, display_name'),
  ]);
  const ownerName = new Map(
    ((owners.data ?? []) as { id: string; display_name: string }[]).map((o) => [
      o.id,
      o.display_name,
    ]),
  );
  const instRows = (inst.data ?? []) as { id: string; name: string; notes: string | null }[];
  const rows = (
    (assets.data ?? []) as {
      id: string;
      owner_id: string;
      institution_id: string | null;
      nickname: string;
      label: string | null;
      notes: string | null;
    }[]
  ).map((a) => ({
    assetId: a.id,
    ownerName: ownerName.get(a.owner_id) ?? '',
    institutionId: a.institution_id,
    notes: a.notes,
  }));
  const plan = tidyPlan(rows, new Map(instRows.map((i) => [i.id, i.notes])));
  return {
    plan,
    bankName: new Map(instRows.map((i) => [i.id, i.name])),
    bankNow: new Map(instRows.map((i) => [i.id, i.notes])),
    label: new Map(
      (
        (assets.data ?? []) as {
          id: string;
          nickname: string;
          label: string | null;
          owner_id: string;
        }[]
      ).map((a) => [a.id, `${ownerName.get(a.owner_id) ?? ''} · ${a.label || a.nickname}`]),
    ),
    before: new Map(rows.map((r) => [r.assetId, r.notes])),
  };
}
