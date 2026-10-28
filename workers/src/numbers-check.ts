/* eslint-disable no-console */
/**
 * Read-only: works out the household's headline figures from the live database with the same functions the portal and the daily e-mail
 * use, prints them with the checks that tie them together and how complete the data behind them is. Writes nothing. Run by hand
 * (Actions > Numbers check). It prints totals only: no account names, numbers or per-account balances.
 */
import { createClient } from '@supabase/supabase-js';
import {
  capitalLedger,
  fundValueFrom,
  fundViews,
  isHeld,
  planOf,
  positionAsOf,
  positionGains,
  reconcileQueue,
  valueOn,
  wealthMovement,
} from '@fwos/core';
import {
  buildDigestInput,
  ledgerMovesOf,
  loadPortfolioData,
  loadPositionInput,
  loadMoneyTrail,
  loadSettings,
} from '@fwos/data';

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

const lakh = (n: number) => `₹${(n / 100000).toFixed(2)} L`;

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
        `Cost of current holdings (deposit principal + fund cost): ₹${inr(w.overall.invested)}   Gain on current holdings: ₹${inr(w.overall.profit)} (${pct(w.overall.profitPct)})${w.overall.estimated ? '  [partly estimated]' : ''}`,
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

    // the period tiles and the profit-by-period table, from the position engine (Home's), per kind of holding
    try {
      const cfg = (await loadSettings(db, household)).config;
      // every price is read, so a day that is the edge of no period (15 Oct, say) is valued from prices like any other; a page asks for
      // the edges of its periods only
      const position = await loadPositionInput(db, l, {
        householdId: household,
        config: cfg,
        allPrices: true,
      });
      const g = positionGains({ position, recentDays: cfg.home.changeDays });
      console.log(`\nPeriod tiles (data starts ${g.dataStarts ?? '-'}):`);
      for (const t of g.tiles)
        console.log(
          `  ${t.label}: ₹${inr(t.amount)} (${pct(t.pct)}) from ${t.from} to ${t.to}${t.clamped ? '  [clamped: data starts later than the period]' : ''}${t.estimated ? '  [est.]' : ''}${t.empty ? '  [no data]' : ''}`,
        );
      console.log('Profit by period, per kind (amount in rupees):');
      for (const r of [...g.periods.rows, g.periods.total])
        console.log(
          `  ${r.label}: ${Object.entries(r.cells)
            .map(
              ([k, c]) =>
                `${k} ₹${inr(c.profit)} on ₹${inr(c.base)} (start ₹${inr(c.startValue)}, in ₹${inr(c.putIn)}, out ₹${inr(c.takenOut)}${c.unexplainedFunds > 0 ? `, apart ₹${inr(c.unexplained)} from ${c.unexplainedFunds} funds` : ''})`,
            )
            .join(' | ')}`,
        );
      console.log(`Basis: ${JSON.stringify(g.periods.basis)}`);
      // where each fund's value comes from, and how well the plan-built units agree with the monthly sheet (counts and totals only)
      const funds = position.assets.filter((x) => x.type === 'mutual_fund' && x.fund);
      const from = (k: string) =>
        funds.filter((x) => fundValueFrom(x, position.config) === k).length;
      const noCode = l.assetRows.filter((x) => x.type === 'mutual_fund' && !x.amfi_code).length;
      const noPrice = funds.filter((x) => x.fund!.navs.length === 0).length;
      console.log(
        `Funds: ${funds.length}; value from the ledger ${from('ledger')}, from the plan and each day’s price ${from('plan')}, last resort (a value on file moved with the price, or flat with no price) ${from('records')}; with no scheme matched ${noCode}; with no prices read ${noPrice}`,
      );
      let sheetTotal = 0;
      let engineTotal = 0;
      let adjusted = 0;
      let skipped = 0;
      for (const x of funds) {
        if (fundValueFrom(x, position.config) !== 'plan') continue;
        const pl = planOf(x, position.config)!;
        if (pl.adjusted !== 'none') adjusted++;
        skipped += pl.skipped;
        const sheet = x.records.filter((r) => r.sheet).slice(-1)[0];
        if (!sheet) continue;
        sheetTotal += sheet.amount;
        engineTotal += valueOn(x, sheet.date, position.config).value ?? 0;
      }
      console.log(
        `Plan-built funds: ${adjusted} had their plan adjusted to the amount invested, ${skipped} instalments had no price; on the day of each fund's newest sheet value the sheet adds up to ₹${inr(sheetTotal)} and the plan with prices to ₹${inr(engineTotal)} (difference ₹${inr(sheetTotal - engineTotal)})`,
      );
      // the capital and earnings ledger (Home's own money, profit, return), the fund views and what is waiting to be explained
      const ledger = capitalLedger({
        position,
        moves: ledgerMovesOf(l.engine.moves),
        openingDate: cfg.capital.openingDate || null,
      });
      const t = ledger.totals;
      console.log(
        `\nCapital: opening ₹${inr(t.opening)} on ${ledger.opening?.date ?? '-'} (${ledger.opening ? `${ledger.opening.coverage.withValue} of ${ledger.opening.coverage.of} holdings had a value` : '-'})`,
      );
      console.log(
        `  outside money confirmed ₹${inr(t.confirmedExternal)}, moved and not yet explained ₹${inr(t.unexplained)}, corrections ₹${inr(t.corrections)} => own money ₹${inr(t.ownMoney)}`,
      );
      console.log(
        `  lifetime profit ₹${inr(t.profit)} (${pct(t.profitPct)} of own money): savings ₹${inr(t.earnings.savings)}, deposits ₹${inr(t.earnings.deposits)}, funds ₹${inr(t.earnings.funds)}, fx ₹${inr(t.earnings.fx)}, others ₹${inr(t.earnings.others)}, income ₹${inr(t.earnings.income)}`,
      );
      console.log(
        `  XIRR ${pct(t.xirr.rate)} (${t.xirr.status}); time-weighted ${pct(t.twr.total)} total, ${pct(t.twr.annualised)} a year`,
      );
      console.log(
        `CHECK net worth = own money + profit: ${Math.abs(t.ownMoney + t.profit - t.netWorth) < 1 ? 'yes' : `NO (differs by ₹${inr(t.ownMoney + t.profit - t.netWorth)})`}`,
      );
      console.log(
        `CHECK the ledger's net worth today equals the portfolio's: ${Math.abs(t.netWorth - nw.total) < 1 ? 'yes' : `NO (differs by ₹${inr(t.netWorth - nw.total)})`}`,
      );
      for (const lim of ledger.limitations) console.log(`  limitation: ${lim}`);
      // where any difference between the engine's day and the portfolio sits, by kind (totals only)
      const day = positionAsOf(position, date);
      const byType = new Map<string, number>();
      for (const v of l.portfolio.valued) {
        const h = day.holdings.find((x) => x.assetId === v.assetId);
        const counted = !nw.excluded.some((e) => e.assetId === v.assetId);
        const a = counted ? (v.estimate?.estimatedAmount ?? 0) : 0;
        const b = h && isHeld(h) ? (h.value ?? 0) : 0;
        if (Math.abs(a - b) >= 1) byType.set(v.type, (byType.get(v.type) ?? 0) + (b - a));
      }
      console.log(
        `Engine day vs portfolio: ₹${inr(day.total)} vs ₹${inr(nw.total)}; by kind: ${[...byType].map(([k, v]) => `${k} ₹${inr(v)}`).join(', ') || 'no difference'}`,
      );
      const fy = wealthMovement(ledger, 'fy', date);
      if (fy.figures)
        console.log(
          `This FY: start ₹${inr(fy.figures.start)}, outside confirmed ₹${inr(fy.figures.confirmedExternal)}, not explained ₹${inr(fy.figures.unexplained)}, earned ₹${inr(fy.figures.earnings.total)} (savings ₹${inr(fy.figures.earnings.savings)}, deposits ₹${inr(fy.figures.earnings.deposits)}, funds ₹${inr(fy.figures.earnings.funds)}), end ₹${inr(fy.figures.end)}; time-weighted ${pct(fy.twr)}`,
        );
      const fv = fundViews(position, { navStaleDays: cfg.funds.navStaleDays, upcomingDays: 31 });
      console.log(
        `Funds: confirmed ₹${inr(fv.confirmed)}, estimated ₹${inr(fv.estimated)} (with no confirmed units ₹${inr(fv.unconfirmedFunds)}), projected SIP ₹${inr(fv.projected.value)} from ${fv.projected.count} instalments (₹${inr(fv.projected.invested)}); stale prices ${fv.staleCount}, oldest NAV ${fv.oldestNav ?? '-'}`,
      );
      const proceeds = l.portfolio.valued.filter(
        (v) => v.estimate?.method === 'fd_proceeds' && v.status === 'active',
      );
      console.log(
        `Maturity proceeds counted until placed: ${proceeds.length} deposits, ₹${inr(proceeds.reduce((x, v) => x + (v.estimate?.estimatedAmount ?? 0), 0))}`,
      );
      const q = reconcileQueue({
        position,
        moves: l.engine.moves,
        tolerance: cfg.estimates.unexplainedTolerance,
        sinceDays: Math.max(cfg.deposits.hideMaturedAfterDays, 120),
      });
      console.log(
        `Explain movements: ${q.proceeds.length} proceeds to place, ${q.balances.length} balances that changed more than expected (net ₹${inr(q.balances.reduce((x, b) => x + b.difference, 0))}), ${q.funding.length} new deposits with no source`,
      );
    } catch (e) {
      console.log(`Period figures could not be worked out: ${(e as Error).message}`);
    }

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

  // the money trail, worked out exactly as the page does: totals only
  {
    const t = await loadMoneyTrail(db, String((hh.data ?? [])[0]?.id ?? ''));
    const byKind = new Map<string, number>();
    let held = 0;
    for (const h of t.holdings) {
      if (h.kind !== 'account') continue;
      for (const p of t.trails.get(h.id)?.parts ?? []) {
        byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + p.amount);
        held += p.amount;
      }
    }
    const crossings = [...t.trails.values()].flatMap((x) => x.crossings);
    console.log(
      `\nMoney trail: ${t.holdings.length} holdings traced (${t.holdings.filter((h) => h.statements).length} with statements); transfers from Singapore ${t.remittances.count} (${t.remittances.proven} proven).`,
    );
    console.log(
      `  Accounts with a trail hold ${lakh(held)}: ${[...byKind]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${Math.round((v / (held || 1)) * 100)}%`)
        .join(', ')}`,
    );
    console.log(
      `  Money moved between people: ${crossings.length} movements, ${lakh(crossings.reduce((s, c) => s + c.amount, 0))}`,
    );
  }
}

main().catch((e) => {
  console.error('Numbers check failed:', (e as Error).message);
  process.exit(1);
});
