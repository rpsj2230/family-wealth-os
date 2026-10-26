import { currentFy, fyBounds, interestCsv, interestSchedule } from '@fwos/core';
import { createClient } from '@/lib/supabase/server';
import { loadFdsForFiling, parseRate } from '@/lib/filing';

export const dynamic = 'force-dynamic';

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
  const { fds, ownerNames } = await loadFdsForFiling(supabase);
  const csv = interestCsv(
    interestSchedule(fds, fy, today, parseRate(url.searchParams.get('tds') ?? undefined)),
    ownerNames,
  );
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="fd-interest-${fy}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
