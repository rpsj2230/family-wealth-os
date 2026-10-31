/* eslint-disable no-console */
/**
 * Read-only: works out the household's headline figures from the live database with the same functions the portal and the daily e-mail
 * use, prints them with the checks that tie them together and how complete the data behind them is. Writes nothing. Run by hand
 * (Actions > Numbers check). It prints totals only: no account names, numbers or per-account balances, except the list of what is
 * still needed from you, which names each account by its bank, its holder and its last four digits, as the Tasks page does.
 */
import { createClient } from '@supabase/supabase-js';
import {
  addDaysIso,
  addMonthsIso,
  capitalLedger,
  fyStartOn,
  xirr,
  chainCoverage,
  checkOverview,
  holdingSources,
  journeyFlows,
  movementFlows,
  overviewFlows,
  fundValueFrom,
  fundViews,
  isHeld,
  mainPath,
  planOf,
  pointsOf,
  positionAsOf,
  positionGains,
  reconcileQueue,
  startPoints,
  traceBack,
  valueOn,
  wealthMovement,
} from '@fwos/core';
import {
  buildDigestInput,
  loadNeeds,
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
      // the funds Home's note counts as held with no transaction ledger: names, owner and status only
      for (const x of position.assets.filter((a) => a.type === 'mutual_fund' && a.fund)) {
        const v = valueOn(x, position.config.today, position.config, position.current);
        if (isHeld(v) && (v.value ?? 0) > 0 && !x.fund!.hasStatement)
          console.log(`  no ledger: ${x.name} (${x.status})`);
      }
      // where each fund's value comes from, and how well the plan-built units agree with the monthly sheet (counts and totals only)
      // spreadsheet fund rows with no statement lines against the statement-backed fund they may repeat: ratios only
      {
        const byName = new Map(l.portfolio.valued.map((v) => [v.name, v]));
        const latestOf = (id: string) =>
          l.obsRows
            .filter((o) => o.asset_id === id && !o.superseded_by)
            .sort((a, b) => b.as_of.localeCompare(a.as_of))[0];
        const pairs: [string, string][] = [
          ['Axis Bluechip Growth', 'Axis Large Cap Growth Direct Plan'],
          ['Axis Bluechip Growth Direct Plan', 'Axis Large Cap Growth Direct Plan'],
          ['Kotak Small Cap Growth', 'Kotak Small Cap Growth Direct Plan'],
          ['Nippon India small cap fund', 'Nippon India Small Cap Growth Direct Plan'],
          ['Parag Parikh Flexi Cap Growth', 'Parag Parikh Flexi Cap Growth Direct Plan'],
          ['Quant Small Cap Growth', 'Quant Small Cap Growth Direct Plan'],
        ];
        console.log(
          '\nSheet row vs statement fund (statement value ÷ sheet value; 1.00 = the same money):',
        );
        for (const [sheetName, stmtName] of pairs) {
          const a = byName.get(sheetName);
          const b = byName.get(stmtName);
          if (!a || !b) continue;
          const av = a.estimate?.estimatedAmount ?? 0;
          const bv = b.estimate?.estimatedAmount ?? 0;
          const bSheet = latestOf(b.assetId);
          const r = (x: number, y: number) => (y > 0 ? (x / y).toFixed(2) : '-');
          console.log(
            `  ${sheetName} → ${stmtName}: statement÷sheet row ${r(bv, av)}; statement÷its own last sheet value ${r(bv, Number(bSheet?.amount ?? 0))} (${bSheet?.as_of ?? '-'}, ${bSheet?.source ?? '-'}); statement÷(both sheet values) ${r(bv, av + Number(bSheet?.amount ?? 0))}; sheet row counted ${a.status}`,
          );
        }
      }
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
        reinvestDays: cfg.harvest.reinvestDays,
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
      // returns on what is held now, each kind from its own money movements, and own money with property left out (rates and totals)
      {
        const left = new Set(nw.excluded.map((e) => e.assetId));
        const valueOf = (id: string) =>
          l.portfolio.valued.find((v) => v.assetId === id)?.estimate?.estimatedAmount ?? 0;
        const at = (s: string) => new Date(`${s}T00:00:00Z`);
        const perYear: Record<string, number> = {
          monthly: 12,
          quarterly: 4,
          half_yearly: 2,
          yearly: 1,
        };
        const fd: { date: Date; amount: number }[] = [];
        const mf: { date: Date; amount: number }[] = [];
        let fdValue = 0;
        let mfValue = 0;
        let payouts = 0;
        for (const a of position.assets) {
          if (left.has(a.assetId)) continue;
          const v = valueOf(a.assetId);
          if (a.type === 'fixed_deposit' && a.fd && a.fd.bookedOn < date && v > 0) {
            fd.push({ date: at(a.fd.bookedOn), amount: -a.fd.principal });
            const n = perYear[a.fd.payout ?? 'cumulative'];
            // a deposit that pays its interest out: each payment is money back on its day
            if (n)
              for (
                let d = addMonthsIso(a.fd.bookedOn, 12 / n);
                d <= date;
                d = addMonthsIso(d, 12 / n)
              ) {
                fd.push({ date: at(d), amount: (a.fd.principal * a.fd.rate) / n });
                payouts++;
              }
            fdValue += v;
          }
          if (a.type === 'mutual_fund' && a.fund && v > 0) {
            for (const t of a.fund.txns)
              if (t.amount !== 0)
                mf.push({
                  date: at(t.date),
                  amount: t.units > 0 ? -Math.abs(t.amount) : Math.abs(t.amount),
                });
            mfValue += v;
          }
        }
        const rate = (flows: { date: Date; amount: number }[], value: number) =>
          xirr([...flows, { date: at(date), amount: value }]).rate;
        const rFd = rate(fd, fdValue);
        const rMf = rate(mf, mfValue);
        const rBoth = rate([...fd, ...mf], fdValue + mfValue);
        console.log(
          `\nXIRR on what is held now: deposits ${pct(rFd)} (₹${inr(fdValue)}, ${payouts} interest payouts counted), funds ${pct(rMf)} (₹${inr(mfValue)}), deposits and funds together ${pct(rBoth)}`,
        );
        const cash = nw.byType.bank_account ?? 0;
        const fyDays = Math.max(
          1,
          (at(date).getTime() - at(addDaysIso(fyStartOn(date), 0)).getTime()) / 86_400_000,
        );
        const cashRate =
          fy.figures && cash > 0 ? (fy.figures.earnings.savings / cash) * (365 / fyDays) : null;
        const counted = nw.total - (nw.byType.property ?? 0);
        const earning =
          rFd !== null && rMf !== null && cashRate !== null
            ? (fdValue * rFd + mfValue * rMf + cash * cashRate) / counted
            : null;
        console.log(
          `Savings interest this FY as a yearly rate: ${pct(cashRate)}; earning rate of all money now (value-weighted, property out): ${pct(earning)}`,
        );
        const noProp = capitalLedger({
          position: { ...position, assets: position.assets.filter((a) => a.type !== 'property') },
          moves: ledgerMovesOf(l.engine.moves),
          openingDate: cfg.capital.openingDate || null,
          reinvestDays: cfg.harvest.reinvestDays,
        }).totals;
        console.log(
          `Without property: net worth ₹${inr(noProp.netWorth)}, own money ₹${inr(noProp.ownMoney)}, lifetime profit ₹${inr(noProp.profit)} (${pct(noProp.profitPct)} of own money), XIRR on own money ${pct(noProp.xirr.rate)} (${noProp.xirr.status})`,
        );
      }
      // bank money by NRE / NRO / other, and the part above the deposit insurance limit per bank and name (totals and counts only)
      {
        const left = new Set(nw.excluded.map((e) => e.assetId));
        const rowOf = new Map(l.assetRows.map((a) => [a.id, a]));
        const byKind = new Map<string, number>();
        const byBankName = new Map<string, number>();
        for (const v of l.portfolio.valued) {
          if (left.has(v.assetId) || (v.type !== 'bank_account' && v.type !== 'fixed_deposit'))
            continue;
          const a = rowOf.get(v.assetId);
          const amount = v.estimate?.estimatedAmount ?? 0;
          const kind =
            a?.account_kind === 'NRE' || a?.account_kind === 'NRO' ? a.account_kind : 'other';
          byKind.set(kind, (byKind.get(kind) ?? 0) + amount);
          // insured per name as written at each bank (a joint holding is its own name)
          const key = `${a?.institution_id ?? '-'}|${a?.owner_id ?? '-'}|${(a?.holder_name ?? '').trim().toLowerCase()}|${a?.is_joint ? 'joint' : ''}`;
          byBankName.set(key, (byBankName.get(key) ?? 0) + amount);
        }
        const limit = cfg.deposits.insuranceLimit;
        const over = [...byBankName.values()].filter((x) => x > limit);
        console.log(
          `Bank money by kind: ${[...byKind].map(([k, x]) => `${k} ₹${inr(x)}`).join(' | ')}; above the ₹${inr(limit)} insured limit: ₹${inr(over.reduce((a, x) => a + x - limit, 0))} in ${over.length} of ${byBankName.size} bank-and-name holdings`,
        );
      }
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
    // where those movements were found, without naming anyone: into a deposit or an account, and through which kind of line
    const kindOf = new Map(t.holdings.map((h) => [h.id, h]));
    const where = new Map<string, { n: number; amount: number }>();
    for (const tr of t.trails.values())
      for (const c of tr.crossings) {
        const h = kindOf.get(c.assetId);
        const hop = tr.hops.find((x) => x.date === c.date && Math.abs(x.amount - c.amount) < 0.01);
        const k = `${h?.kind ?? '?'}${h?.statements ? ' (statements)' : ''} via ${hop?.cls ?? '?'}${hop?.from ? (kindOf.has(hop.from) ? ' from a holding' : ' from elsewhere') : ' named'}`;
        const cur = where.get(k) ?? { n: 0, amount: 0 };
        cur.n++;
        cur.amount += c.amount;
        where.set(k, cur);
      }
    for (const [k, v] of [...where].sort((a, b) => b[1].amount - a[1].amount))
      console.log(`    ${k}: ${v.n}, ${lakh(v.amount)}`);
    // the same money followed step by step (money-chain.ts): how much of it is linked, and how, totals only
    {
      const c = t.chain;
      const nodes = [...c.nodes.values()];
      const lineNodes = nodes.filter((x) => x.kind === 'line');
      const outs = lineNodes.filter((x) => x.amount < 0);
      const ins = lineNodes.filter((x) => x.amount > 0);
      const linked = (xs: typeof lineNodes, side: 'to' | 'from') =>
        xs.filter((x) => x[side].some((l) => l.basis !== 'same_account')).length;
      console.log(
        `\nMoney trail step by step (${c.method === 'recent' ? 'latest money first' : 'a share of everything'}): ${lineNodes.length} lines, ${ins.length} in, ${outs.length} out.`,
      );
      console.log(
        `  Lines out linked to where they went: ${linked(outs, 'to')} of ${outs.length}; lines in linked to where they came from: ${linked(ins, 'from')} of ${ins.length}.`,
      );
      console.log(
        `  Matched here by amount and date: transfers ${c.guessed.transfers}, deposits booked ${c.guessed.depositBooked}, deposits paid back ${c.guessed.depositPaidBack}, renewals ${c.guessed.renewals}.`,
      );
      const deps = t.holdings.filter((h) => h.kind === 'deposit');
      const booked = deps.filter((h) =>
        (c.into.get(h.id) ?? []).some((l) => !l.node.startsWith('before:')),
      ).length;
      const paid = deps.filter((h) => (c.outOf.get(h.id) ?? []).length > 0).length;
      console.log(
        `  Deposits on file: ${deps.length}; booking found ${booked}; paid back to a line found ${paid}.`,
      );
      const bucket = new Map<string, number>();
      let total = 0;
      for (const h of t.holdings) {
        if (h.kind !== 'account' || !h.statements) continue;
        for (const p of pointsOf((id, a) => startPoints(c, id, a), c.now.get(h.id) ?? [])) {
          bucket.set(p.kind, (bucket.get(p.kind) ?? 0) + p.amount);
          total += p.amount;
        }
      }
      console.log(
        `  Accounts with statements hold ${lakh(total)} today, started as: ${[...bucket]
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${Math.round((v / (total || 1)) * 100)}%`)
          .join(', ')}`,
      );
      const ends = new Map<string, number>();
      let out = 0;
      for (const x of outs)
        for (const e of x.ends) {
          ends.set(e.kind, (ends.get(e.kind) ?? 0) + e.amount);
          out += e.amount;
        }
      console.log(
        `  Money out the trail stops at: ${lakh(out)}: ${[...ends]
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${lakh(v)}`)
          .join(', ')}`,
      );
      // how far back the money of the deposits goes: steps along the largest share
      const depth = deps
        .flatMap((h) => c.into.get(h.id) ?? [])
        .map((l) => {
          const s = traceBack(c, l.node, t.traceOptions);
          return s ? mainPath(s).length : 0;
        });
      console.log(
        `  Steps back from each line that booked a deposit (largest share): ${
          depth.length
            ? `median ${depth.sort((a, b) => a - b)[Math.floor(depth.length / 2)]}, most ${depth[depth.length - 1]}`
            : 'none'
        }`,
      );
    }
    // the flow diagram, checked against the trail itself (money-flow.ts): totals only
    {
      const c = t.chain;
      const kinds = new Map(t.holdings.map((h) => [h.id, h.kind]));
      const owners = new Map(t.holdings.map((h) => [h.id, h.ownerId]));
      const ctx = {
        kindOf: (h: string) => kinds.get(h) ?? (c.into.has(h) ? ('deposit' as const) : null),
        ownerOf: (h: string) => owners.get(h) ?? null,
      };
      const started = performance.now();
      const ov = overviewFlows(c, ctx);
      const cov = chainCoverage(c, (h) => ctx.kindOf(h));
      const allStarts = [...c.nodes.values()].reduce(
        (s, n) => s + n.starts.reduce((a, x) => a + x.amount, 0),
        0,
      );
      const checks = checkOverview(ov, cov.total);
      const st = (g: ReturnType<typeof overviewFlows>, k: string) =>
        g.links.filter((l) => l.status === k).reduce((s, l) => s + l.amount, 0);
      console.log(
        `\nFlow diagram (overview), built in ${Math.round(performance.now() - started)} ms: ${ov.nodes.length} boxes, ${ov.links.length} flows.`,
      );
      console.log(
        `  Money in at the start ${lakh(ov.total)} (every start in the trail: ${lakh(allStarts)}); ${checks.map((k) => `${k.ok ? 'OK' : 'MISMATCH'} ${k.label} (${lakh(k.shown)} vs ${lakh(k.expected)})`).join('; ')}`,
      );
      const flowsInto = ov.links.filter(
        (l) => l.source.startsWith('in:') || l.source.startsWith('bank:'),
      );
      const tot = flowsInto.reduce((s, l) => s + l.amount, 0);
      console.log(
        `  Where it went, by status: verified ${lakh(st(ov, 'verified') - ov.links.filter((l) => l.source.startsWith('start:') && l.status === 'verified').reduce((s, l) => s + l.amount, 0))} of ${lakh(tot)}; matched by amount and date ${lakh(flowsInto.filter((l) => l.status === 'matched').reduce((s, l) => s + l.amount, 0))}; missing or unverified ${lakh(flowsInto.filter((l) => l.status === 'gap').reduce((s, l) => s + l.amount, 0))}`,
      );
      const mv = movementFlows(c, ctx);
      const sg = overviewFlows(c, ctx, { sources: ['singapore'] });
      console.log(
        `  Movements between holdings: ${mv.links.length} flows, ${lakh(mv.total)} moved in all (a rupee can move more than once); Singapore money followed: ${lakh(sg.total)}`,
      );
      let journeys = 0;
      let bad = 0;
      for (const h of t.holdings) {
        const g = journeyFlows(
          c,
          ctx,
          { back: holdingSources(c, h.id), forward: c.outOf.get(h.id) ?? [], focus: h.id },
          { ...t.traceOptions, budget: 160 },
        );
        journeys++;
        for (const l of g.links) {
          const a = g.nodes.find((x) => x.id === l.source);
          const b = g.nodes.find((x) => x.id === l.target);
          if (!a || !b || a.column >= b.column) bad++;
        }
      }
      console.log(
        `  Journeys built for ${journeys} holdings; flows running backwards in time: ${bad}`,
      );
    }
    // every statement line's tag: how many carry one, by tag, and how many were placed by best guess (counts only)
    {
      const tags = new Map<string, number>();
      let guessed = 0;
      let asked = 0;
      for (const l of t.lines) {
        const c = t.classified.get(l.id);
        if (!c) continue;
        tags.set(c.category ?? '(none)', (tags.get(c.category ?? '(none)') ?? 0) + 1);
        if (c.reason.startsWith('Best guess')) guessed++;
        if (c.cls === 'ask_in' || c.cls === 'ask_out') asked++;
      }
      console.log(
        `\nTags: ${t.lines.length} lines; placed by best guess ${guessed}; waiting for an answer ${asked}; ${[
          ...tags,
        ]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k} ${n}`)
          .join(', ')}`,
      );
    }
    // what is still needed from the household, as the tasks say it
    const needs = await loadNeeds(db, String((hh.data ?? [])[0]?.id ?? ''));
    console.log(`\nNeeded from you: ${needs.length}`);
    // the feed checks name amounts per account: only how many of each kind
    const feed = needs.filter((n) => n.key.startsWith('feed-'));
    for (const n of needs.filter((x) => !x.key.startsWith('feed-'))) console.log(`  - ${n.title}`);
    const kinds = new Map<string, number>();
    for (const n of feed)
      kinds.set(n.key.split(':')[0]!, (kinds.get(n.key.split(':')[0]!) ?? 0) + 1);
    console.log(
      `  The banks’ e-mail feed: ${[...kinds].map(([k, c]) => `${k.replace('feed-', '')} ${c}`).join(', ') || 'nothing missing'}`,
    );
    const clubbed = [...t.trails.values()].flatMap((x) => x.clubbed);
    console.log(
      `  Clubbing (since ${t.ownershipFrom || 'not set'}): ${clubbed.length} items, ${lakh(clubbed.reduce((s, c) => s + c.amount, 0))}`,
    );
  }
}

main().catch((e) => {
  console.error('Numbers check failed:', (e as Error).message);
  process.exit(1);
});
