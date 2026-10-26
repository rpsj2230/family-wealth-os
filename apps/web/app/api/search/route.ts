import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface Hit {
  label: string;
  hint: string;
  href: string;
}

/** What the quick-find box searches: your banks, accounts, funds, policies, goals and open tasks. Signed-in members only; row-level security applies. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });
  const [inst, assets, goals, tasks, pols, pos] = await Promise.all([
    supabase.from('institutions').select('id, name'),
    supabase.from('assets').select('id, type, nickname, label, status, institution_id'),
    supabase.from('goals').select('id, name'),
    supabase.from('tasks').select('id, title').eq('status', 'open').limit(200),
    supabase.from('policies').select('id, insurer, kind'),
    supabase.from('mf_positions').select('asset_id, fund_name'),
  ]);
  const bank = new Map(
    ((inst.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]),
  );
  const fundName = new Map(
    ((pos.data ?? []) as { asset_id: string; fund_name: string }[]).map((p) => [
      p.asset_id,
      p.fund_name,
    ]),
  );
  const items: Hit[] = [];
  for (const [id, name] of bank) items.push({ label: name, hint: 'Bank', href: `/bank/${id}` });
  for (const a of (assets.data ?? []) as {
    id: string;
    type: string;
    nickname: string;
    label: string | null;
    status: string;
    institution_id: string | null;
  }[]) {
    if (a.type === 'mutual_fund')
      items.push({
        label: fundName.get(a.id) ?? a.nickname,
        hint: 'Mutual fund',
        href: `/asset/${a.id}`,
      });
    else
      items.push({
        label: a.label || a.nickname,
        hint: `${a.institution_id ? (bank.get(a.institution_id) ?? '') : ''} ${a.type.replace(/_/g, ' ')}`.trim(),
        href: `/asset/${a.id}`,
      });
  }
  for (const g of (goals.data ?? []) as { id: string; name: string }[])
    items.push({ label: g.name, hint: 'Goal', href: '/goals' });
  for (const t of (tasks.data ?? []) as { id: string; title: string }[])
    items.push({ label: t.title.slice(0, 90), hint: 'Task', href: `/tasks/${t.id}` });
  for (const p of (pols.data ?? []) as { id: string; insurer: string; kind: string }[])
    items.push({
      label: `${p.insurer} policy`,
      hint: p.kind.replace(/_/g, ' '),
      href: `/policy/${p.id}`,
    });
  return NextResponse.json({ items }, { headers: { 'cache-control': 'private, max-age=60' } });
}
