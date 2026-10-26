'use client';

import { useMemo, useState, useTransition } from 'react';
import { formatInr } from '@fwos/core';
import { saveFundUpdate } from '@/app/(app)/investments/update/actions';

export interface FundInput {
  assetId: string;
  name: string;
  owner: string;
  units: number | null;
  nav: number | null;
  navDate: string | null;
  invested: number;
  value: number;
  sipMonthly: number | null;
  sipStopped: boolean;
}

const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[,\s₹]/g, '')));

/** One row per fund; value is worked out from units × price as you type, and can be overridden. Nothing is saved until you press Save. */
export function FundUpdateGrid({ funds, today }: { funds: FundInput[]; today: string }) {
  const [asOf, setAsOf] = useState(today);
  const [rows, setRows] = useState(() =>
    funds.map((f) => ({
      units: f.units === null ? '' : String(f.units),
      nav: f.nav === null ? '' : String(f.nav),
      value: '',
      invested: f.invested ? String(f.invested) : '',
      sip: f.sipMonthly ? String(f.sipMonthly) : '',
    })),
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, k: keyof (typeof rows)[number], v: string) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const computed = useMemo(
    () =>
      rows.map((r) => {
        const u = n(r.units);
        const p = n(r.nav);
        return r.value.trim() !== ''
          ? n(r.value)
          : u !== null && p !== null && Number.isFinite(u * p)
            ? Math.round(u * p * 100) / 100
            : null;
      }),
    [rows],
  );
  const total = computed.reduce<number>((a, v) => a + (v ?? 0), 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveFundUpdate(
            asOf,
            funds.map((f, i) => ({
              assetId: f.assetId,
              units: rows[i]!.units,
              nav: rows[i]!.nav,
              value: computed[i] === null ? '' : String(computed[i]),
              invested: rows[i]!.invested,
              sipMonthly: rows[i]!.sip,
            })),
          );
          setMsg({ ok: res.ok, text: res.message });
        });
      }}
    >
      <div className="row" style={{ alignItems: 'end', marginBottom: 8 }}>
        <label>
          Figures as on
          <input type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <span className="muted small">
          Take units and the price from your fund app or statement. Value = units × price.
        </span>
      </div>
      <div className="xlwrap">
        <table className="tbl lines fundupd">
          <thead>
            <tr>
              <th>Fund</th>
              <th className="num">Units</th>
              <th className="num">Price (NAV)</th>
              <th className="num">Value</th>
              <th className="num">Money put in</th>
              <th className="num">SIP / month</th>
            </tr>
          </thead>
          <tbody>
            {funds.map((f, i) => (
              <tr key={f.assetId} className={f.sipStopped ? 'dim' : ''}>
                <td>
                  <strong>{f.name}</strong>
                  <div className="muted small">
                    {f.owner}
                    {f.navDate ? ` · latest price ${f.navDate}` : ''} · last value{' '}
                    {formatInr(Math.round(f.value))}
                  </div>
                </td>
                {(['units', 'nav'] as const).map((k) => (
                  <td key={k} className="num">
                    <input
                      inputMode="decimal"
                      value={rows[i]![k]}
                      aria-label={`${f.name} ${k === 'units' ? 'units' : 'price'}`}
                      onChange={(e) => set(i, k, e.target.value)}
                      style={{ width: 110, textAlign: 'right' }}
                    />
                  </td>
                ))}
                <td className="num">
                  <input
                    inputMode="decimal"
                    value={rows[i]!.value}
                    placeholder={computed[i] === null ? '' : String(computed[i])}
                    aria-label={`${f.name} value`}
                    onChange={(e) => set(i, 'value', e.target.value)}
                    style={{ width: 120, textAlign: 'right' }}
                  />
                </td>
                {(['invested', 'sip'] as const).map((k) => (
                  <td key={k} className="num">
                    <input
                      inputMode="decimal"
                      value={rows[i]![k]}
                      aria-label={`${f.name} ${k === 'sip' ? 'SIP' : 'money put in'}`}
                      onChange={(e) => set(i, k, e.target.value)}
                      style={{ width: 110, textAlign: 'right' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total value</th>
              <th />
              <th />
              <th className="num">{formatInr(Math.round(total))}</th>
              <th />
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save fund figures'}
        </button>
        {msg && (
          <span role="status" className={msg.ok ? 'ok' : 'fail'}>
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
