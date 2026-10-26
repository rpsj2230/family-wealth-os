'use client';

import { useMemo, useState } from 'react';
import {
  formatInr,
  fyOf,
  effectiveRules,
  type TaxRuleSet,
  simulateRedemption,
  suggestHarvest,
  type Lot,
} from '@fwos/core';

interface ParsedLots {
  lots: Lot[];
  errors: string[];
}

/** One lot per line: date, units, cost per unit. Example: 2024-03-05, 123.456, 98.75 */
export function parseLots(text: string): ParsedLots {
  const lots: Lot[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const [d, u, c] = line.split(/[,\t;]\s*/).map((x) => x.trim());
      const units = Number((u ?? '').replace(/,/g, ''));
      const cost = Number((c ?? '').replace(/[₹,]/g, ''));
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))
        errors.push(`Line ${i + 1}: the date must look like 2024-03-05.`);
      else if (!(units > 0)) errors.push(`Line ${i + 1}: units must be a positive number.`);
      else if (!(cost > 0)) errors.push(`Line ${i + 1}: cost per unit must be a positive number.`);
      else
        lots.push({
          lotId: `L${i + 1}`,
          schemeId: 'fund',
          ownerId: 'taxpayer',
          fundClass: 'equity',
          acquiredOn: d,
          units,
          costPerUnit: cost,
        });
    });
  return { lots, errors };
}

const num = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(/[₹,%\s,]/g, '')));

export function TaxSimulator({
  sample,
  rules: allRules,
}: {
  sample?: boolean;
  rules?: TaxRuleSet[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [lotsText, setLotsText] = useState(
    sample ? '2023-02-10, 1000, 100\n2024-05-20, 600, 130\n2026-08-01, 400, 160' : '',
  );
  const [nav, setNav] = useState(sample ? '210' : '');
  const [saleDate, setSaleDate] = useState(today);
  const [mode, setMode] = useState<'units' | 'amount'>('units');
  const [size, setSize] = useState(sample ? '800' : '');
  const [nri, setNri] = useState(true);
  const [loadDays, setLoadDays] = useState('365');
  const [loadRate, setLoadRate] = useState('1');
  const [stcgYtd, setStcgYtd] = useState('0');
  const [ltcgYtd, setLtcgYtd] = useState('0');
  const [carryS, setCarryS] = useState('0');
  const [carryL, setCarryL] = useState('0');
  const [surcharge, setSurcharge] = useState('0');

  const parsed = useMemo(() => parseLots(lotsText), [lotsText]);
  const rules = effectiveRules(saleDate, allRules)?.rules ?? null;
  const common = {
    lots: parsed.lots,
    nav: Number(nav),
    saleDate,
    exitLoad:
      num(loadRate) > 0 && num(loadDays) > 0
        ? { days: num(loadDays), rate: num(loadRate) / 100 }
        : null,
    ledger: {
      stcgYtd: num(stcgYtd),
      ltcgYtd: num(ltcgYtd),
      carryStcl: num(carryS),
      carryLtcl: num(carryL),
    },
    tdsApplies: nri,
    surcharge: num(surcharge) / 100,
    ...(allRules ? { rules: allRules } : {}),
  };
  const ready = parsed.errors.length === 0 && parsed.lots.length > 0 && Number(nav) > 0;
  const sim = useMemo(() => {
    if (!ready || !(num(size) > 0)) return null;
    return simulateRedemption({
      ...common,
      ...(mode === 'units' ? { units: num(size) } : { amount: num(size) }),
    });
  }, [
    lotsText,
    nav,
    saleDate,
    mode,
    size,
    nri,
    loadDays,
    loadRate,
    stcgYtd,
    ltcgYtd,
    carryS,
    carryL,
    surcharge,
    ready,
  ]);
  const harvest = useMemo(
    () => (ready ? suggestHarvest(common) : null),
    [
      lotsText,
      nav,
      saleDate,
      nri,
      loadDays,
      loadRate,
      stcgYtd,
      ltcgYtd,
      carryS,
      carryL,
      surcharge,
      ready,
    ],
  );

  return (
    <div>
      {sample && (
        <p className="notice warn">
          Sample numbers for one taxpayer. Replace them with your own lots.
        </p>
      )}
      <p className="notice warn">
        Decision support only, not tax advice.{' '}
        {rules
          ? `Rules loaded for FY ${rules.fy} are ${rules.verification === 'primary' ? 'verified' : 'taken from secondary sources and NOT yet verified against the Income Tax Department. Check before acting.'}`
          : `No rules are loaded for ${fyOf(saleDate)}.`}{' '}
        Nothing is ever traded from here.
      </p>
      <section className="card form">
        <h2>1. The units one person holds in one fund</h2>
        <label>
          One lot per line: date bought, units, cost per unit
          <textarea
            rows={5}
            value={lotsText}
            onChange={(e) => setLotsText(e.target.value)}
            placeholder="2024-03-05, 123.456, 98.75"
            aria-label="Lots"
          />
        </label>
        {parsed.errors.map((e) => (
          <p key={e} className="fail small">
            {e}
          </p>
        ))}
        <p className="muted small">
          Use a single taxpayer (one PAN) per run. Each person has their own allowance and losses.
        </p>
        <div className="formgrid">
          <label>
            NAV today (₹ per unit)
            <input inputMode="decimal" value={nav} onChange={(e) => setNav(e.target.value)} />
          </label>
          <label>
            Sale date
            <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </label>
          <label>
            Redeem by
            <select value={mode} onChange={(e) => setMode(e.target.value as 'units' | 'amount')}>
              <option value="units">Number of units</option>
              <option value="amount">Amount in ₹</option>
            </select>
          </label>
          <label>
            {mode === 'units' ? 'Units to redeem' : 'Amount to redeem (₹)'}
            <input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
          </label>
          <label>
            Exit load: days
            <input
              inputMode="numeric"
              value={loadDays}
              onChange={(e) => setLoadDays(e.target.value)}
            />
          </label>
          <label>
            Exit load: rate %
            <input
              inputMode="decimal"
              value={loadRate}
              onChange={(e) => setLoadRate(e.target.value)}
            />
          </label>
        </div>
        <h2>2. What this person has already realised this financial year</h2>
        <div className="formgrid">
          <label>
            Short-term gains so far (₹, loss as negative)
            <input
              inputMode="decimal"
              value={stcgYtd}
              onChange={(e) => setStcgYtd(e.target.value)}
            />
          </label>
          <label>
            Long-term gains so far (₹, loss as negative)
            <input
              inputMode="decimal"
              value={ltcgYtd}
              onChange={(e) => setLtcgYtd(e.target.value)}
            />
          </label>
          <label>
            Short-term loss brought forward (₹)
            <input inputMode="decimal" value={carryS} onChange={(e) => setCarryS(e.target.value)} />
          </label>
          <label>
            Long-term loss brought forward (₹)
            <input inputMode="decimal" value={carryL} onChange={(e) => setCarryL(e.target.value)} />
          </label>
          <label>
            Surcharge % (depends on total income)
            <input
              inputMode="decimal"
              value={surcharge}
              onChange={(e) => setSurcharge(e.target.value)}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={nri} onChange={(e) => setNri(e.target.checked)} />{' '}
            Non-resident: fund house deducts tax at source
          </label>
        </div>
      </section>

      {sim && sim.status !== 'ok' && (
        <p className="notice warn" role="alert">
          {sim.message}
        </p>
      )}
      {sim && sim.status === 'ok' && (
        <section className="card" aria-labelledby="simres">
          <h2 id="simres">Result of this redemption</h2>
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Units from</th>
                <th className="num">Units</th>
                <th>Term</th>
                <th className="num">Proceeds</th>
                <th className="num">Exit load</th>
                <th className="num">Gain</th>
              </tr>
            </thead>
            <tbody>
              {sim.slices.map((s) => (
                <tr key={s.lotId}>
                  <td data-label="Units from">{s.acquiredOn}</td>
                  <td className="num" data-label="Units">
                    {s.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                  </td>
                  <td data-label="Term">{s.term === 'long' ? 'Long term' : 'Short term'}</td>
                  <td className="num" data-label="Proceeds">
                    {formatInr(s.proceeds)}
                  </td>
                  <td className="num" data-label="Exit load">
                    {formatInr(s.exitLoad)}
                  </td>
                  <td className="num" data-label="Gain">
                    {formatInr(s.gain)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="tbl">
            <tbody>
              <tr>
                <th scope="row">Long-term gain / short-term gain</th>
                <td className="num">
                  {formatInr(sim.ltcg)} / {formatInr(sim.stcg)}
                </td>
              </tr>
              <tr>
                <th scope="row">Tax-free allowance left before → after</th>
                <td className="num">
                  {formatInr(sim.before!.exemptionLeft)} → {formatInr(sim.after!.exemptionLeft)}
                </td>
              </tr>
              <tr>
                <th scope="row">Extra tax you would owe when you file</th>
                <td className="num">{formatInr(sim.incrementalTax)}</td>
              </tr>
              {nri && (
                <tr>
                  <th scope="row">Tax the fund house deducts now (estimate)</th>
                  <td className="num">{formatInr(sim.tdsEstimate)}</td>
                </tr>
              )}
              {nri && (
                <tr>
                  <th scope="row">Refund to claim by filing a return</th>
                  <td className={`num ${sim.refundExpected > 0 ? '' : 'fail'}`}>
                    {formatInr(sim.refundExpected)}
                  </td>
                </tr>
              )}
              <tr className="sum">
                <th scope="row">Cash you receive now</th>
                <td className="num">{formatInr(sim.netProceeds)}</td>
              </tr>
              <tr>
                <th scope="row">Units left in the fund</th>
                <td className="num">
                  {sim.unitsLeft.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                </td>
              </tr>
            </tbody>
          </table>
          <ul className="list small muted">
            {sim.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      {harvest && (
        <section className="card" aria-labelledby="harv">
          <h2 id="harv">Could using this year&apos;s tax-free allowance make sense?</h2>
          {harvest.status !== 'ok' ? (
            <p>{harvest.message}</p>
          ) : (
            <>
              <p>
                You could sell about{' '}
                <strong>
                  {harvest.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units
                </strong>{' '}
                (oldest long-term units first) and realise a gain of{' '}
                <strong>{formatInr(harvest.gainRealised)}</strong> with no extra tax. If you bought
                back, your cost would reset to today&apos;s price. If you would otherwise pay tax on
                that gain later, that could save up to about{' '}
                <strong>{formatInr(harvest.futureTaxMayBeAvoided)}</strong> (a possibility, not a
                promise).
              </p>
              <p className="small">
                Costs of acting: exit load {formatInr(harvest.costOfActing.exitLoad)}
                {nri
                  ? `; ${formatInr(harvest.costOfActing.tdsTiedUpUntilRefund)} withheld as tax until your refund`
                  : ''}
                .
              </p>
              <ul className="list">
                {harvest.tradeOffs.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
