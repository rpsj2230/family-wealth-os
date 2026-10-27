'use client';

import { useId, useState } from 'react';
import { formatInr, takeOutFor, unitsText, type PanelRow } from '@fwos/core';
import { niceDate } from '@/lib/dates';
import './invest.css';

const inr = (n: number) => formatInr(Math.round(n));

/** "₹ 1,00,000" and "100000" are amounts; anything else is not. */
const amountOf = (text: string): number | null => {
  const t = text.replace(/[₹,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/**
 * "How much to take out for ₹X": type an amount and see which units go (oldest first), what the exit load and the tax would cost.
 * An approximation to plan with, not an order: the fund house prices the sale on its own day.
 */
export function TakeOutBox({
  rows,
  exitLoad,
  rates,
  room,
  equity,
}: {
  rows: PanelRow[];
  exitLoad: { pct: number; days: number } | null;
  rates: { stcg: number; ltcg: number; cess: number } | null;
  room: number;
  equity: boolean;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const amount = amountOf(text);
  const r =
    amount !== null && amount > 0 ? takeOutFor({ rows, amount, exitLoad, rates, room }) : null;
  return (
    <div className="takeout">
      <label htmlFor={id}>
        <b>How much to take out?</b> <span className="muted small">Amount in rupees</span>
      </label>
      <input
        id={id}
        inputMode="decimal"
        placeholder="for example 100000"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-describedby={`${id}-r`}
      />
      <div id={`${id}-r`} aria-live="polite" className="to-result">
        {text.trim() !== '' && amount === null && (
          <p className="small fail">Type the amount as a number.</p>
        )}
        {r && (
          <>
            <p className="small">
              Sell about <b>{unitsText(r.units)} units</b> for <b>{inr(r.proceeds)}</b>
              {r.allOfIt && ` (that is everything the fund holds; you asked for ${inr(r.asked)})`}.
              {equity && (
                <>
                  {' '}
                  Gain: short-term {inr(r.stcgGain)}, long-term {inr(r.ltcgGain)}. Tax about{' '}
                  <b>{inr(r.tax)}</b> after the tax-free allowance left.
                </>
              )}{' '}
              Exit load about <b>{inr(r.exitLoad)}</b>.
            </p>
            {r.includesLoadUnits && (
              <p className="small tp-warn">
                This includes units still under an exit load. Selling less, or waiting, avoids it.
              </p>
            )}
            {r.unknownCost && (
              <p className="small tp-warn">
                Some of these units have no known cost, so their gain is not counted.
              </p>
            )}
            <ul className="small to-list">
              {r.pieces.map((p, i) => (
                <li key={i}>
                  {p.acquiredOn ? niceDate(p.acquiredOn) : 'Before the first line'}:{' '}
                  {unitsText(p.units)} units, {inr(p.value)}
                  {p.term === 'LTCG' ? ' · long-term' : p.term === 'STCG' ? ' · short-term' : ''}
                  {p.underLoad ? ' · under exit load' : ''}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
