import type { SupabaseClient } from '@supabase/supabase-js';
import { fyStartYear, parseHomeRange, savedByTag } from '@fwos/core';
import { loadSettings, loadStatements, positionFor, statementPicture } from '@fwos/data';
import { PageHead } from '@/components/PageHead';
import { loadContext } from '@/lib/data';
import { loadHome } from '@/lib/home-data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { EarnedSavedView } from './EarnedSavedView';

export const dynamic = 'force-dynamic';

/** Earned and saved, every financial year on one table, and the chosen year by month and by tag (opened from Home's two figures). */
export default async function EarnedSavedPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const sp = await searchParams;
  const { supabase } = await loadContext();
  const home = await loadHome(supabase, parseHomeRange(undefined));
  const years = home?.capital.years ?? [];
  const asked = Number(sp.fy);
  const fy =
    Number.isInteger(asked) && years.some((y) => y.fy === asked)
      ? asked
      : (years[0]?.fy ?? fyStartYear(new Date().toISOString().slice(0, 10)));
  const year = years.find((y) => y.fy === fy);
  let byTag = null;
  if (year) {
    const [loaded, { config }, stored] = await Promise.all([
      loadPortfolio(supabase),
      loadSettings(supabase as unknown as SupabaseClient),
      loadStatements(supabase as unknown as SupabaseClient),
    ]);
    if (stored.lines.length) {
      const picture = statementPicture(stored, loaded, config, positionFor(loaded, config, true));
      byTag = savedByTag(picture.lines, picture.classified, year.from, year.to, year.saved);
    }
  }
  return (
    <>
      <PageHead
        title="Earned and saved"
        subtitle="What the holdings earned and what the family saved, every financial year; choose a year for its months and tags."
      />
      <EarnedSavedView years={years} fy={fy} base="/earned-saved" byTag={byTag} />
    </>
  );
}
