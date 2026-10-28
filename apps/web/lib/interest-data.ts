import { isInterestSection, type ReportedInterest } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';

interface StatementRow {
  owner_id: string;
  fy: string;
  kind: 'ais' | '26as';
  parsed: Record<string, unknown>;
}

const INTEREST = new Set(['interest_savings', 'interest_deposit', 'interest_other']);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/**
 * The interest each statement reports: the AIS's savings, deposit and other interest lines (each with its payer), or Form 26AS's
 * deductors' transactions under the interest sections (194A, 195). Pure: reads the stored reading only.
 */
export function reportedInterestOf(row: StatementRow): ReportedInterest {
  const p = row.parsed ?? {};
  const lines: ReportedInterest['lines'] = [];
  if (row.kind === 'ais') {
    for (const l of (p.lines as Record<string, unknown>[] | undefined) ?? [])
      if (INTEREST.has(String(l.category)) && num(l.amount) > 0)
        lines.push({ source: String(l.source || 'Not named'), amount: num(l.amount) });
  } else {
    for (const d of (p.deductors as Record<string, unknown>[] | undefined) ?? []) {
      const paid = ((d.txns as Record<string, unknown>[] | undefined) ?? [])
        .filter((t) => isInterestSection(String(t.section ?? '')))
        .reduce((a, t) => a + num(t.paid), 0);
      if (paid > 0) lines.push({ source: String(d.name || 'Not named'), amount: paid });
    }
  }
  return { ownerId: row.owner_id, fy: row.fy, kind: row.kind, lines };
}

/** Every stored AIS and Form 26AS, as the interest each one reports. */
export async function loadReportedInterest(supabase: SupabaseClient): Promise<ReportedInterest[]> {
  const { data } = await supabase.from('tax_statements').select('owner_id, fy, kind, parsed');
  return ((data ?? []) as StatementRow[]).map(reportedInterestOf);
}
