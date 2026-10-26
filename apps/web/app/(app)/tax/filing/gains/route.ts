import { classifyGains, currentFy, effectiveRules, fyBounds, schedule112aCsv } from '@fwos/core';
import { loadRealisedGains, loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Schedule 112A rows for one person and financial year: ?fy=2025-26&owner=<id> */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  let fy = url.searchParams.get('fy') ?? currentFy(today);
  try {
    fyBounds(fy);
  } catch {
    fy = currentFy(today);
  }
  const owner = url.searchParams.get('owner') ?? '';
  const db = supabase as unknown as SupabaseClient;
  const [{ rows }, settings] = await Promise.all([loadRealisedGains(db, fy), loadSettings(db)]);
  const months =
    effectiveRules(fyBounds(fy).end, settings.rules)?.rules.equity.holdingMonthsLong ?? 12;
  const lines = classifyGains(rows, months).filter((l) => !owner || l.ownerId === owner);
  return new Response(schedule112aCsv(lines), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="schedule-112a-${fy}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
