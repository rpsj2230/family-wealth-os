import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Tax withheld and refunds to claim, per person and year, for the return or an adviser. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  const [rows, owners] = await Promise.all([
    supabase
      .from('tds_refunds')
      .select(
        'owner_id, fy, kind, description, expected_gain, expected_tds, expected_refund, actual_gain, actual_tds, refund_received, status',
      )
      .order('fy'),
    supabase.from('owners').select('id, display_name'),
  ]);
  const name = new Map((owners.data ?? []).map((o) => [o.id as string, o.display_name as string]));
  const head = [
    'Person',
    'Financial year',
    'Kind',
    'Description',
    'Expected gain',
    'Expected tax withheld',
    'Expected refund',
    'Actual gain',
    'Actual tax withheld',
    'Refund received',
    'Status',
  ];
  const lines = [head.map(cell).join(',')];
  for (const r of rows.data ?? [])
    lines.push(
      [
        name.get(r.owner_id as string) ?? '',
        r.fy,
        r.kind,
        r.description,
        r.expected_gain,
        r.expected_tds,
        r.expected_refund,
        r.actual_gain,
        r.actual_tds,
        r.refund_received,
        r.status,
      ]
        .map(cell)
        .join(','),
    );
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="tax-refunds.csv"',
      'cache-control': 'no-store',
    },
  });
}
