'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  deleteFundTxn,
  editFundTxn,
  type FundActionResult,
} from '@/app/(app)/investments/fund-actions';
import { buildTxn, TXN_KINDS } from '@/lib/fund-edit';

export interface TxnEditable {
  assetId: string;
  id: string;
  date: string;
  kind: string;
  amount: number;
  units: number;
  nav: number | null;
  /** where the line came from: 'cas' (a fund statement), 'estimate', 'manual', 'csv', … */
  source: string;
}

const SAMPLE: FundActionResult = { ok: true, message: 'This is a sample: nothing is saved.' };

/**
 * Correct or delete one fund line. A line typed in (or from an app export) can be corrected; a fund statement's line can only be
 * deleted (the next statement covering its date brings it back as the statement has it); an estimated SIP instalment is changed through
 * the SIP plan. The fund's units and amount invested follow every change, and every change is in the log.
 */
export function TxnActions({
  t,
  today,
  demo = false,
}: {
  t: TxnEditable;
  today: string;
  demo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({
    date: t.date,
    kind: t.kind,
    amount: String(Math.abs(t.amount)),
    units: String(Math.abs(t.units)),
    nav: t.nav === null ? '' : String(t.nav),
  });
  const [result, setResult] = useState<FundActionResult | null>(null);
  const [pending, run] = useTransition();
  const r = useMemo(() => buildTxn({ ...d, asset: t.assetId }, today), [d, t.assetId, today]);
  const fromStatement = t.source === 'cas';
  const estimate = t.source === 'estimate';

  if (estimate)
    return (
      <section className="detailsection" aria-label="Change this line" data-testid="txn-actions">
        <p className="muted small">
          This is an estimated SIP instalment, kept until a fund statement shows the real one. To
          change it, change the SIP on the fund’s{' '}
          <a href={`/asset/${t.assetId}?tab=sip`}>SIP plan</a>.
        </p>
      </section>
    );

  const remove = () => {
    const warn = fromStatement
      ? 'Delete this line from the fund statement? The fund’s units and amount invested go back by its figures. The next statement that covers this date brings it back as the statement has it.'
      : 'Delete this line? The fund’s units and amount invested go back by its figures.';
    if (!window.confirm(warn)) return;
    run(async () => setResult(demo ? SAMPLE : await deleteFundTxn(t.assetId, t.id)));
  };

  return (
    <section
      className="detailsection txnactions"
      aria-label="Change this line"
      data-testid="txn-actions"
    >
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!fromStatement && (
          <button
            type="button"
            className="btn"
            aria-expanded={open}
            onClick={() => {
              setResult(null);
              setOpen((o) => !o);
            }}
          >
            {open ? 'Cancel' : 'Correct this line'}
          </button>
        )}
        <button type="button" className="btn danger" disabled={pending} onClick={remove}>
          Delete this line
        </button>
      </div>
      {fromStatement && (
        <p className="muted small">
          This line is from a fund statement, so it cannot be corrected here: the next statement
          would put it back as it is. If it is wrong, delete it; it returns only if a later
          statement has it.
        </p>
      )}
      {open && !fromStatement && (
        <form
          className="txnactions-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!r.values || pending) return;
            run(async () =>
              setResult(
                demo
                  ? SAMPLE
                  : await editFundTxn(t.assetId, t.id, {
                      date: d.date,
                      kind: d.kind,
                      amount: d.amount,
                      units: d.units,
                      nav: d.nav,
                    }),
              ),
            );
          }}
        >
          <label>
            Date
            <input
              type="date"
              max={today}
              value={d.date}
              onChange={(e) => setD({ ...d, date: e.target.value })}
            />
          </label>
          <label>
            Type
            <select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>
              {TXN_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount (₹)
            <input
              inputMode="decimal"
              value={d.amount}
              onChange={(e) => setD({ ...d, amount: e.target.value })}
            />
          </label>
          <label>
            Units
            <input
              inputMode="decimal"
              value={d.units}
              onChange={(e) => setD({ ...d, units: e.target.value })}
            />
          </label>
          <label>
            Price per unit (₹)
            <input
              inputMode="decimal"
              value={d.nav}
              onChange={(e) => setD({ ...d, nav: e.target.value })}
            />
          </label>
          <button className="btn primary" disabled={pending || !r.values}>
            {pending ? 'Saving…' : 'Save the correction'}
          </button>
          {r.problems.length > 0 && <p className="muted small">Check {r.problems.join(', ')}.</p>}
        </form>
      )}
      {result && (
        <p role="status" className={result.ok ? 'ok' : 'fail'} data-testid="txn-result">
          {result.message}
        </p>
      )}
    </section>
  );
}
