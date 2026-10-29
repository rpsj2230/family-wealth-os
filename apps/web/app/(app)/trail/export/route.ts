import { chainTables, tablesToXlsx } from '@fwos/core';
import { loadAccess } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { loadTrailContext } from '@/lib/trail-data';

export const dynamic = 'force-dynamic';

/** The whole money trail as an Excel workbook: every step, every start and where every amount is now. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  if ((await loadAccess()).role === 'emergency_viewer')
    return new Response('Not available', { status: 403 });
  const { data, labels, names } = await loadTrailContext();
  const name = (id: string | null | undefined) => {
    if (!id) return 'An account with no statement on file';
    if (id.startsWith('away:'))
      return `${names[id.slice(5)] ?? 'Someone'}’s accounts with no statement on file`;
    if (id.startsWith('held:'))
      return `A deposit not on file (from ${labels[id.slice(5)] ?? 'an account'})`;
    return labels[id] ?? 'A holding not on file';
  };
  const today = new Date().toISOString().slice(0, 10);
  const bytes = tablesToXlsx(chainTables(data.chain, name), [
    `Money trail as of ${today}.`,
    `Money out of an account is taken from ${data.chain.method === 'recent' ? 'the latest money that came in' : 'a share of everything in it'} (Settings → Clubbing and money trail).`,
  ]);
  return new Response(bytes as BlobPart, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="money-trail-${today}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
