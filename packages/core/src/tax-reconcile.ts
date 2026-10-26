/**
 * Compares what the tax department holds about a person (Form 26AS: tax already credited; AIS: income reported by banks, fund
 * houses and others) with what this app worked out from the person's own records. Differences are listed for a person to check;
 * nothing is changed automatically.
 */
export interface Reconcile26as {
  totalTds: number;
  deductors: { name: string; tan: string; tax: number; txns: { section: string; tax: number }[] }[];
  taxPaid: { amount: number }[];
}
export interface ReconcileAis {
  byCategory: Partial<Record<string, number>>;
}
export interface ReconcileInput {
  form26as: Reconcile26as | null;
  ais: ReconcileAis | null;
  computed: {
    /** NRO deposit interest for the year */
    fdInterestTaxable: number;
    /** NRE deposit interest */
    fdInterestNre: number;
    /** tax the bank is expected to withhold on that interest */
    interestTdsExpected: number;
    /** tax withheld (actual if entered, else expected) on fund sales and harvests */
    harvestTds: number;
    /** value of fund units sold in the year, from the fund statements */
    fundSaleProceeds: number;
  };
}
export interface Finding {
  level: 'ok' | 'check' | 'info';
  text: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const far = (a: number, b: number, floor = 1000, share = 0.05) =>
  Math.abs(a - b) > Math.max(floor, Math.abs(b) * share);

export function reconcileTax(i: ReconcileInput): Finding[] {
  const out: Finding[] = [];
  const c = i.computed;
  if (i.form26as) {
    const expected = c.interestTdsExpected + c.harvestTds;
    const got = i.form26as.totalTds;
    if (expected === 0 && got === 0)
      out.push({ level: 'ok', text: 'Form 26AS shows no tax deducted, and none was expected.' });
    else if (!far(got, expected))
      out.push({
        level: 'ok',
        text: `Tax credited in Form 26AS, ${inr(got)}, matches what was expected (about ${inr(expected)}).`,
      });
    else if (got > expected)
      out.push({
        level: 'check',
        text: `Form 26AS credits ${inr(got)} of tax, ${inr(got - expected)} more than expected (${inr(expected)}). Another deductor may be reporting income you have not recorded: see the list of deductors below.`,
      });
    else
      out.push({
        level: 'check',
        text: `Form 26AS credits ${inr(got)} of tax, ${inr(expected - got)} less than expected (${inr(expected)}). A bank or fund house may not have deposited or reported the tax: ask for its Form 16A or contract note.`,
      });
    const unknown = i.form26as.deductors.filter((d) => d.tax > 0);
    if (unknown.length > 0)
      out.push({
        level: 'info',
        text: `Deductors in Form 26AS: ${unknown
          .map(
            (d) =>
              `${d.name} (${[...new Set(d.txns.map((t) => t.section))].join(', ') || 'section not read'}) ${inr(d.tax)}`,
          )
          .join('; ')}.`,
      });
    const paid = i.form26as.taxPaid.reduce((a, t) => a + t.amount, 0);
    if (paid > 0)
      out.push({
        level: 'info',
        text: `Advance or self-assessment tax paid by the person: ${inr(paid)}.`,
      });
  }
  if (i.ais) {
    const cat = i.ais.byCategory;
    const aisInterest =
      (cat.interest_savings ?? 0) + (cat.interest_deposit ?? 0) + (cat.interest_other ?? 0);
    const ours = c.fdInterestTaxable + c.fdInterestNre;
    if (aisInterest > 0 || ours > 0) {
      if (aisInterest + 1000 < ours * 0.95)
        out.push({
          level: 'check',
          text: `The AIS reports ${inr(aisInterest)} of interest but the deposits here earned about ${inr(ours)}. A bank may not have reported all of it yet; the return should still include it.`,
        });
      else if (aisInterest > ours * 1.05 + 1000)
        out.push({
          level: 'info',
          text: `The AIS reports ${inr(aisInterest)} of interest against ${inr(ours)} worked out from the deposits. The difference is usually savings-account interest, which is not worked out here; check it and include it in the return if taxable.`,
        });
      else
        out.push({
          level: 'ok',
          text: `Interest in the AIS, ${inr(aisInterest)}, is close to the ${inr(ours)} worked out from your deposits.`,
        });
    }
    if ((cat.dividend ?? 0) > 0)
      out.push({
        level: 'info',
        text: `The AIS reports ${inr(cat.dividend!)} of dividends: include them in the return.`,
      });
    const sold = cat.mf_redemption ?? 0;
    if (sold > 0 || c.fundSaleProceeds > 0) {
      if (far(sold, c.fundSaleProceeds, 5000, 0.05))
        out.push({
          level: 'check',
          text: `The AIS reports ${inr(sold)} from sale of fund units; your fund statements show ${inr(c.fundSaleProceeds)}. Import a complete fund statement, or check for sales in a folio that is not recorded here.`,
        });
      else
        out.push({
          level: 'ok',
          text: `Fund sales in the AIS, ${inr(sold)}, match your fund statements.`,
        });
    }
    if ((cat.salary ?? 0) > 0)
      out.push({
        level: 'info',
        text: `The AIS reports ${inr(cat.salary!)} of salary income in India.`,
      });
    if ((cat.rent ?? 0) > 0)
      out.push({ level: 'info', text: `The AIS reports ${inr(cat.rent!)} of rent.` });
  }
  if (!i.form26as && !i.ais)
    out.push({
      level: 'info',
      text: 'Upload Form 26AS or the AIS to compare them with your records.',
    });
  return out;
}
