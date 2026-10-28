/* eslint-disable no-console */
/**
 * Read-only: works out the household's headline figures from the live database with the same functions the portal and the daily e-mail
 * use, prints them with the checks that tie them together and how complete the data behind them is. Writes nothing. Run by hand
 * (Actions > Numbers check). It prints totals only: no account names, numbers or per-account balances.
 */
import { createClient } from '@supabase/supabase-js';
import { buildDigestInput, loadPortfolioData } from '@fwos/data';

const need = (n: string) => {
  const v = process.env[n];
  if (!v) {
    console.error(`${n} is required`);
    process.exit(2);
  }
  return v;
};
const db = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const inr = (n: number) => Math.round(n).toLocaleString('en-IN');
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : `${(n * 100).toFixed(2)}%`;
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

async function main() {
  const hh = await db.from('households').select('id, name');
  if (hh.error) throw new Error(hh.error.message);
  for (const h of hh.data ?? []) {
    const household = h.id as string;
    console.log(`\n== Household figures as of ${date}`);
    const l = await loadPortfolioData(db, {
      householdId: household,
      today: new Date(`${date}T00:00:00Z`),
    });
    const nw = l.portfolio.netWorth;
    console.log(
      `Net worth (counted holdings): ₹${inr(nw.total)}   holdings counted ${nw.counted}, left out ${nw.excluded.length}`,
    );
    const why = new Map<string, number>();
    for (const e of nw.excluded) why.set(e.reason, (why.get(e.reason) ?? 0) + 1);
    console.log(
      `Left out because: ${[...why].map(([k, v]) => `${k} x${v}`).join(', ') || 'nothing'}`,
    );
    console.log(
      `By kind: ${Object.entries(nw.byType)
        .map(([k, v]) => `${k} ₹${inr(v as number)}`)
        .join(' | ')}`,
    );
    console.log(
      `By liquidity: ${Object.entries(nw.byLiquidity)
        .map(([k, v]) => `${k} ₹${inr(v as number)}`)
        .join(' | ')}`,
    );
    const sumTypes = Object.values(nw.byType).reduce((a, b) => a + (b as number), 0);
    console.log(
      `CHECK kinds add up to net worth: ${Math.abs(sumTypes - nw.total) < 1 ? 'yes' : `NO (differs by ₹${inr(sumTypes - nw.total)})`}`,
    );
    const sumOwners = Object.values(nw.byOwner).reduce((a, b) => a + (b as number), 0);
    console.log(
      `CHECK people add up to net worth: ${Math.abs(sumOwners - nw.total) < 1 ? 'yes' : `NO (differs by ₹${inr(sumOwners - nw.total)})`}`,
    );

    // how each value is known, and how old
    const lines = Object.values(l.portfolio.lines);
    const count = (f: (x: (typeof lines)[number]) => string) => {
      const m = new Map<string, number>();
      for (const x of lines) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
      return [...m].map(([k, v]) => `${k} x${v}`).join(', ');
    };
    console.log(`Freshness of the values: ${count((x) => x.freshness)}`);
    console.log(`Basis of the values: ${count((x) => x.basis ?? 'none')}`);
    console.log(
      `Rate assumed (no own or listed rate): ${lines.filter((x) => x.usedAssumption).length} savings accounts`,
    );

    // the same figures the e-mail shows (and the portal's Home): net worth, today, overall, the four kinds, last 30 days
    const d = await buildDigestInput(db, {
      householdId: household,
      date,
      householdName: String(h.name ?? ''),
      appUrl: 'https://example.test',
      includeGoals: true,
      includeRetirement: true,
    });
    const w = d.wealth;
    if (w) {
      console.log(`\nHome / e-mail headline: net worth ₹${inr(w.total)}`);
      console.log(
        `Today: ₹${inr(w.today.amount)} (${pct(w.today.pct)})  of which banks ₹${inr(w.today.banks)}, funds ₹${inr(w.today.funds)}`,
      );
      console.log(
        `Invested money (deposit principal + fund cost): ₹${inr(w.overall.invested)}   Profit so far: ₹${inr(w.overall.profit)} (${pct(w.overall.profitPct)})${w.overall.estimated ? '  [partly estimated]' : ''}`,
      );
      for (const c of w.classes)
        console.log(`  ${c.label}: ₹${inr(c.current)} (${pct(c.share)} of net worth)`);
      const sumClasses = w.classes.reduce((a, c) => a + c.current, 0);
      console.log(
        `CHECK the four kinds add up to net worth: ${Math.abs(sumClasses - w.total) < 1 ? 'yes' : `NO (differs by ₹${inr(sumClasses - w.total)})`}`,
      );
      console.log(
        `CHECK Home headline equals the portfolio net worth: ${Math.abs(w.total - nw.total) < 1 ? 'yes' : `NO (differs by ₹${inr(w.total - nw.total)})`}`,
      );
    }
    if (d.month)
      console.log(
        `Last ${'30'} days (as Home shows it): ₹${inr(d.month.amount)} (${pct(d.month.pct)})`,
      );
    console.log(`Values as of: ${d.asOf ?? '-'}   late inputs: ${d.lateInputs ?? 0}`);

    // how much past data there is
    const snaps = await db
      .from('snapshots')
      .select('source, taken_on')
      .eq('household_id', household);
    const bySrc = new Map<string, { n: number; first: string; last: string }>();
    for (const s of snaps.data ?? []) {
      const k = String(s.source);
      const cur = bySrc.get(k) ?? { n: 0, first: '9999', last: '0000' };
      cur.n++;
      if (s.taken_on < cur.first) cur.first = s.taken_on as string;
      if (s.taken_on > cur.last) cur.last = s.taken_on as string;
      bySrc.set(k, cur);
    }
    console.log(
      `\nSnapshots: ${[...bySrc].map(([k, v]) => `${k} x${v.n} (${v.first} to ${v.last})`).join(' | ') || 'none'}`,
    );
  }
}

main().catch((e) => {
  console.error('Numbers check failed:', (e as Error).message);
  process.exit(1);
});
