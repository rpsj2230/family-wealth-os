import { parsePrices, summariseUsage, type AiUsageRow } from '@fwos/core';
import { loadSettings, pageAll } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { CostView } from './CostView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI cost' };

export default async function AiCostPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const settings = await loadSettings(supabase as unknown as SupabaseClient);
  type Db = {
    id: string;
    at: string;
    provider: string;
    model: string | null;
    purpose: string;
    ok: boolean;
    status: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    tokens_known: boolean;
    ms: number | null;
    note: string | null;
  };
  // every call so far (read in pages: a busy year is more than the 1,000 rows one request returns)
  const data = await pageAll<Db>((from, to) =>
    supabase
      .from('ai_usage')
      .select(
        'id, at, provider, model, purpose, ok, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_known, ms, note',
      )
      .order('at', { ascending: false })
      .range(from, to),
  );
  const rows: AiUsageRow[] = data.map((r) => ({
    id: r.id,
    at: r.at,
    provider: r.provider,
    model: r.model,
    purpose: r.purpose,
    ok: r.ok,
    status: r.status,
    input: r.input_tokens,
    output: r.output_tokens,
    cacheRead: r.cache_read_tokens,
    cacheWrite: r.cache_write_tokens,
    known: r.tokens_known,
    ms: r.ms,
    note: r.note,
  }));
  const prices = parsePrices(settings.config.ai.prices);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <CostView
      summary={summariseUsage(rows, prices, today)}
      usdInr={settings.config.ai.usdInr}
      prices={prices}
    />
  );
}
