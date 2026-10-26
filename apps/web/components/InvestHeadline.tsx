import { formatInr } from '@fwos/core';
import type { Totals } from '@/lib/investments';

export const sign = (n: number) => (n >= 0 ? '+' : '−');
export const rupees = (n: number) => `${sign(n)}${formatInr(Math.abs(Math.round(n)))}`;
export const pct = (n: number, digits = 2) => `${sign(n)}${Math.abs(n * 100).toFixed(digits)}%`;
export const tone = (n: number | null) => (n === null ? '' : n >= 0 ? 'gain' : 'fail');

/** The four figures that matter, the same on the dashboard: value, today, total gain with its annual return, and what is put in. */
export function InvestHeadline({ t, big = false }: { t: Totals; big?: boolean }) {
  return (
    <dl className={`invhead ${big ? 'big' : ''}`}>
      <div>
        <dt>Value now</dt>
        <dd className="num">{formatInr(Math.round(t.value))}</dd>
        <dd className="sub">invested {formatInr(Math.round(t.invested))}</dd>
      </div>
      <div>
        <dt>Today</dt>
        <dd className={`num ${tone(t.dayPct === null ? null : t.dayAmount)}`}>
          {t.dayPct === null ? '–' : rupees(t.dayAmount)}
        </dd>
        <dd className={`sub ${tone(t.dayPct === null ? null : t.dayAmount)}`}>
          {t.dayPct === null ? 'no price change yet' : pct(t.dayPct)}
        </dd>
      </div>
      <div>
        <dt>Total gain</dt>
        <dd className={`num ${tone(t.gain)}`}>{rupees(t.gain)}</dd>
        <dd className={`sub ${tone(t.xirr)}`}>
          {t.xirr === null
            ? 'XIRR not available'
            : `XIRR ${pct(t.xirr, 1)} a year${t.xirrEstimated ? ' (est.)' : ''}`}
        </dd>
      </div>
      {t.sipMonthly > 0 && (
        <div>
          <dt>SIP</dt>
          <dd className="num">{formatInr(Math.round(t.sipMonthly))}</dd>
          <dd className="sub">a month</dd>
        </div>
      )}
    </dl>
  );
}
