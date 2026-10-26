/**
 * Which tax treatment a mutual fund gets in India, worked out from its AMFI category and name. Only equity-oriented funds
 * (at least 65% in domestic equity, including arbitrage and equity-savings funds) get the one-year long-term period and the
 * annual tax-free allowance, so only those can be harvested. Everything else is named so the page can say why it is left out.
 * A guess from a name is never silent: `certain` is false and the page says "check the fund's category".
 */
export type FundTaxClass =
  | 'equity' // listed-equity treatment: 12 months, allowance, 20% / 12.5%
  | 'other_long' // international, fund of funds, gold: 24 months, 12.5% with no allowance
  | 'debt_slab' // debt and money-market funds: taxed at the person's slab
  | 'mixed' // multi-asset and balanced hybrids: depends on the equity share, check the fund
  | 'unknown';

export interface FundClassInfo {
  class: FundTaxClass;
  label: string;
  /** the allowance and one-year rule apply, so the fund can be part of a gain harvest */
  harvestable: boolean;
  /** ELSS: units are locked for this many months from each purchase; 0 otherwise */
  lockInMonths: number;
  /** false when the class is a guess from the fund's name only */
  certain: boolean;
  note: string;
}

const ELSS = /\b(elss|tax saver|tax saving|tax plan)\b/i;
const INTERNATIONAL =
  /\b(international|overseas|global|us equity|u\.?s\.? |nasdaq|s&p ?500|fang|world|emerging markets?|china|japan|europe)\b/i;
const GOLD = /\b(gold|silver|commodit)/i;
const DEBT =
  /\b(debt|liquid|overnight|money market|gilt|bond|income fund|credit risk|duration|ultra short|low duration|short term fund|corporate bond|banking and psu|floater|fixed maturity|fmp|target maturity|g-?sec|sdl|treasury|conservative hybrid)\b/i;
const EQUITY_NAME =
  /\b(equity|large cap|largecap|mid cap|midcap|small cap|smallcap|flexi ?cap|multi ?cap|focused|value|contra|dividend yield|bluechip|blue chip|nifty|sensex|index|etf|opportunities|growth|arbitrage|aggressive hybrid|equity savings|elss|tax saver|infrastructure|pharma|technology|banking|psu equity|momentum|quality|alpha)\b/i;

export function fundTaxClass(name: string, category?: string | null): FundClassInfo {
  const lock = ELSS.test(name) || /elss/i.test(category ?? '') ? 36 : 0;
  const mk = (cls: FundTaxClass, label: string, certain: boolean, note: string): FundClassInfo => ({
    class: cls,
    label,
    harvestable: cls === 'equity',
    lockInMonths: lock,
    certain,
    note,
  });
  const cat = (category ?? '').toLowerCase();
  if (cat) {
    if (/overseas|international|global|fof/.test(cat) && !/debt/.test(cat))
      return mk(
        'other_long',
        'International or fund of funds',
        true,
        'Long-term after 24 months, taxed at 12.5% with no tax-free allowance.',
      );
    if (/gold|silver|commodit/.test(cat))
      return mk(
        'other_long',
        'Gold or commodity fund',
        true,
        'Long-term after 24 months, taxed at 12.5% with no tax-free allowance.',
      );
    if (/conservative hybrid/.test(cat))
      return mk('debt_slab', 'Conservative hybrid (mostly debt)', true, 'Taxed at your slab rate.');
    if (/^debt|liquid|money market|gilt|overnight/.test(cat))
      return mk(
        'debt_slab',
        'Debt fund',
        true,
        'Taxed at your slab rate; no long-term benefit for units bought after 1 April 2023.',
      );
    if (
      /arbitrage|aggressive hybrid|equity savings|dynamic asset|balanced advantage|equity scheme|elss|index|etf/.test(
        cat,
      ) &&
      !/debt/.test(cat)
    )
      return mk(
        'equity',
        'Equity-oriented fund',
        true,
        'Long-term after 12 months; 12.5% above the yearly allowance.',
      );
    if (/multi asset|balanced hybrid|solution|hybrid/.test(cat))
      return mk(
        'mixed',
        'Hybrid or multi-asset fund',
        true,
        'The tax depends on the share held in equity (65% or more is treated as equity). Check the fund factsheet before harvesting.',
      );
  }
  if (GOLD.test(name))
    return mk(
      'other_long',
      'Gold or commodity fund',
      false,
      'Long-term after 24 months, taxed at 12.5% with no tax-free allowance.',
    );
  if (INTERNATIONAL.test(name) && !/arbitrage/i.test(name))
    return mk(
      'other_long',
      'International or fund of funds',
      false,
      'Long-term after 24 months, taxed at 12.5% with no tax-free allowance.',
    );
  if (DEBT.test(name)) return mk('debt_slab', 'Debt fund', false, 'Taxed at your slab rate.');
  if (/multi asset|balanced hybrid|hybrid|asset allocation/i.test(name))
    return mk(
      'mixed',
      'Hybrid or multi-asset fund',
      false,
      'The tax depends on the share held in equity. Check the fund factsheet before harvesting.',
    );
  if (EQUITY_NAME.test(name))
    return mk(
      'equity',
      'Equity-oriented fund',
      false,
      'Looks like an equity fund from its name; confirm its category.',
    );
  return mk(
    'unknown',
    'Category not known',
    false,
    'Confirm the fund’s category before harvesting.',
  );
}
