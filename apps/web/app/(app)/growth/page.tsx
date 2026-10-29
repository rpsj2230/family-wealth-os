import { loadContext } from '@/lib/data';
import { loadGrowth } from '@/lib/growth-data';
import { GrowthView, parseGrowthTab } from './GrowthView';

export const dynamic = 'force-dynamic';

export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const { supabase } = await loadContext();
  const d = await loadGrowth(supabase);
  return (
    <GrowthView
      work={d.work}
      projection={d.projection}
      tab={parseGrowthTab(sp.tab)}
      base="/growth"
      ageNames={d.ageNames}
      longRunEquity={d.longRunEquity}
      today={d.today}
    />
  );
}
