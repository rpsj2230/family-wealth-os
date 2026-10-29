/**
 * The harvest plan as one table for the whole family: a row per fund per person, the gains to book inside the yearly allowance and the
 * losses worth booking, each with the units to sell, what they cost and are worth, the gain split by term, the exit load, the day to
 * sell by, what to buy back and roughly how many units that buys at today's price, the day to buy back, and the day the new units turn
 * long-term again. Built from the Tax page's own harvest view, so the table and the cards never disagree. Pure.
 */
import type { AppConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { addDaysIso, addMonthsIso } from './harvest-lots';
import type { HarvestView, PersonView, WorkingLot } from './harvest-view';
import type { ReportTable } from './reports';
import { addWorkingDays } from './liquidity';
import { effectiveRules, RULES, type TaxRuleSet } from './tax';

export interface HarvestTableRow {
  kind: 'gain' | 'loss';
  ownerId: string;
  person: string;
  assetId: string;
  fund: string;
  units: number;
  /** three decimals, to type into the sell screen */
  unitsText: string;
  /** the price the figures use (today's), null when it cannot be told */
  price: number | null;
  cost: number;
  value: number;
  /** gains are positive and losses negative */
  longTerm: number;
  shortTerm: number;
  exitLoad: number;
  /** the lots come from estimates (a SIP plan), not a fund statement */
  estimated: boolean;
  sellBy: string;
  /** the proceeds to put back into the same fund, roughly how many units that buys at today's price, and the day */
  buyBack: number;
  buyBackUnits: number | null;
  buyBackOn: string;
  /** the first day the units bought back are long-term again */
  longTermAgainOn: string;
  /** a gain row: tax this harvest may save later; a loss row: tax it can save when set off against gains */
  taxEffect: number;
  note: string | null;
}

export interface HarvestTable {
  fy: string;
  sellBy: string;
  deadline: string;
  buyBackOn: string;
  rows: HarvestTableRow[];
  /** per person: the gain booked inside the allowance, the losses booked, the money to put back */
  people: {
    ownerId: string;
    person: string;
    gain: number;
    loss: number;
    buyBack: number;
    allowanceLeft: number;
  }[];
  notes: string[];
}

const sumLots = (lots: WorkingLot[], longTerm: boolean) =>
  lots.filter((l) => l.longTerm === longTerm).reduce((a, l) => a + l.gain, 0);

function personRows(
  pv: PersonView,
  dates: { sellBy: string; buyBackOn: string; longTermAgainOn: string },
  rules: TaxRuleSet,
): HarvestTableRow[] {
  const taxOn = (stcg: number, ltcg: number) =>
    (Math.max(0, stcg) * rules.equity.stcgRate + Math.max(0, ltcg) * rules.equity.ltcgRate) *
    (1 + rules.cess);
  const crossesMonth = dates.buyBackOn.slice(0, 7) !== dates.sellBy.slice(0, 7);
  const rows: HarvestTableRow[] = [];
  for (const r of pv.sell) {
    const w = r.working;
    const price = r.units > 0 ? r.worth / r.units : null;
    rows.push({
      kind: 'gain',
      ownerId: pv.ownerId,
      person: pv.name,
      assetId: r.assetId,
      fund: r.fund,
      units: r.units,
      unitsText: r.unitsText,
      price,
      cost: w.totals.cost,
      value: w.totals.value,
      longTerm: w.longTermGain,
      shortTerm: w.shortTermGain,
      exitLoad: w.costs.exitLoad,
      estimated: r.estimated,
      ...dates,
      buyBack: w.buyBack,
      buyBackUnits: price ? Math.round((w.buyBack / price) * 1000) / 1000 : null,
      taxEffect: w.longTermGain * rules.equity.ltcgRate * (1 + rules.cess),
      note:
        [
          r.estimated ? 'units from estimated purchases: check against your statement' : null,
          crossesMonth ? 'buy-back falls in the next month: still counted as a reinvestment' : null,
        ]
          .filter(Boolean)
          .join('; ') || null,
    });
  }
  for (const r of pv.losses.rows) {
    const price = r.units > 0 ? r.worth / r.units : null;
    const cost = r.lots.reduce((a, l) => a + l.cost, 0);
    const longTerm = sumLots(r.lots, true);
    const shortTerm = sumLots(r.lots, false);
    const buyBack = Math.max(0, r.worth - r.exitLoad);
    rows.push({
      kind: 'loss',
      ownerId: pv.ownerId,
      person: pv.name,
      assetId: r.assetId,
      fund: r.fund,
      units: r.units,
      unitsText: r.unitsText,
      price,
      cost,
      value: r.worth,
      longTerm,
      shortTerm,
      exitLoad: r.exitLoad,
      estimated: r.estimated,
      ...dates,
      buyBack,
      buyBackUnits: price ? Math.round((buyBack / price) * 1000) / 1000 : null,
      // a loss saves the tax on the same amount of gains it is set off against (short-term losses against any gain)
      taxEffect: taxOn(-shortTerm, -longTerm),
      note: [
        'saves tax only against gains booked this year or carried forward (file the return on time)',
        r.estimated ? 'units from estimated purchases: check against your statement' : null,
      ]
        .filter(Boolean)
        .join('; '),
    });
  }
  return rows;
}

export function harvestTable(
  view: HarvestView,
  opts: {
    today: string;
    rules?: TaxRuleSet[];
    config?: AppConfig['harvest'];
  },
): HarvestTable {
  const cfg = opts.config ?? DEFAULT_CONFIG.harvest;
  const rules =
    effectiveRules(opts.today, opts.rules ?? RULES)?.rules ??
    (opts.rules ?? RULES)[(opts.rules ?? RULES).length - 1]!;
  // sell by the order date (today if that has passed and the year is still open), buy back after the proceeds arrive
  const sellBy =
    opts.today > view.orderBy && opts.today <= view.deadline ? opts.today : view.orderBy;
  const buyBackOn = addWorkingDays(sellBy, cfg.buyBackDays);
  const longTermAgainOn = addDaysIso(addMonthsIso(buyBackOn, rules.equity.holdingMonthsLong), 1);
  const dates = { sellBy, buyBackOn, longTermAgainOn };
  const rows = view.people.flatMap((pv) => personRows(pv, dates, rules));
  const people = view.people.map((pv) => {
    const mine = rows.filter((r) => r.ownerId === pv.ownerId);
    return {
      ownerId: pv.ownerId,
      person: pv.name,
      gain: mine.filter((r) => r.kind === 'gain').reduce((a, r) => a + r.longTerm, 0),
      loss: mine.filter((r) => r.kind === 'loss').reduce((a, r) => a + r.longTerm + r.shortTerm, 0),
      buyBack: mine.reduce((a, r) => a + r.buyBack, 0),
      allowanceLeft: pv.meter.free,
    };
  });
  const notes = [
    `Sell by ${sellBy} (orders after the cut-off, or on a holiday, are priced on the next working day; the year ends ${view.deadline}).`,
    // public holidays are not known, so the buy-back day is a target
    `Buy back on ${buyBackOn}, ${cfg.buyBackDays} working day${cfg.buyBackDays === 1 ? '' : 's'} after the sale, once the money is in your bank. Public holidays are not known: if the money has not arrived, buy back the day it does.`,
    'Buy-back units are an estimate at today’s price; the fund house uses the price of the day you buy.',
    `The units bought back are long-term again from ${longTermAgainOn}. Selling them earlier is short-term.`,
    'A buy-back of the same fund soon after the sale is a reinvestment: your own money and the yearly return are not changed by it.',
  ];
  return { fy: view.fy, sellBy, deadline: view.deadline, buyBackOn, rows, people, notes };
}

/** The table as a report table, for the Excel download (one sheet) and printing. */
export function harvestReportTable(t: HarvestTable): ReportTable {
  return {
    id: 'harvest-plan',
    title: `Harvest plan, FY ${t.fy}`,
    note: `Sell by ${t.sellBy}; buy back on ${t.buyBackOn}. Gains inside each person's yearly allowance, and losses worth booking.`,
    columns: [
      { key: 'person', label: 'Whose', kind: 'text' },
      { key: 'what', label: 'Gain or loss', kind: 'text' },
      { key: 'fund', label: 'Fund', kind: 'text' },
      { key: 'units', label: 'Units to sell', kind: 'text' },
      { key: 'price', label: 'Price used (₹)', kind: 'rate' },
      { key: 'cost', label: 'Cost', kind: 'money' },
      { key: 'value', label: 'Value now', kind: 'money' },
      { key: 'longTerm', label: 'Long-term gain', kind: 'money' },
      { key: 'shortTerm', label: 'Short-term gain', kind: 'money' },
      { key: 'exitLoad', label: 'Exit load', kind: 'money' },
      { key: 'sellBy', label: 'Sell by', kind: 'date' },
      { key: 'buyBack', label: 'Buy back (₹)', kind: 'money' },
      { key: 'buyBackUnits', label: 'Buy-back units (about)', kind: 'text' },
      { key: 'buyBackOn', label: 'Buy back on', kind: 'date' },
      { key: 'longTermAgainOn', label: 'Long-term again from', kind: 'date' },
      { key: 'taxEffect', label: 'Tax saved', kind: 'money' },
      { key: 'note', label: 'Note', kind: 'text' },
    ],
    rows: t.rows.map((r) => ({
      person: r.person,
      what: r.kind === 'gain' ? 'Gain (tax-free)' : 'Loss',
      fund: r.fund,
      units: r.unitsText,
      price: r.price === null ? null : Math.round(r.price * 10000) / 10000,
      cost: Math.round(r.cost),
      value: Math.round(r.value),
      longTerm: Math.round(r.longTerm),
      shortTerm: Math.round(r.shortTerm),
      exitLoad: Math.round(r.exitLoad),
      sellBy: r.sellBy,
      buyBack: Math.round(r.buyBack),
      buyBackUnits: r.buyBackUnits === null ? null : r.buyBackUnits.toFixed(3),
      buyBackOn: r.buyBackOn,
      longTermAgainOn: r.longTermAgainOn,
      taxEffect: Math.round(r.taxEffect),
      note: r.note,
    })),
  };
}
