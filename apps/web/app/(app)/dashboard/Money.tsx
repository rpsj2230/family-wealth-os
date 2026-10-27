import type { ReactNode } from 'react';
import { formatInrCompact, formatPct, type Explain, type ExplainSet } from '@fwos/core';
import { whole } from '@/app/(app)/accounts/BankOverview';
import { Est } from '@/components/Est';
import { Why } from '@/components/Why';
import type { HomeModel } from '@/lib/home';

const direction = (n: number) => {
  const r = Math.round(n);
  return r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
};

/** A plain figure in the language of the Accounts overview: the big compact number, the exact amount beneath, a note. */
function Tile({
  label,
  amount,
  note,
  testId,
  why,
}: {
  label: string;
  amount: number;
  note: string;
  testId: string;
  why?: Explain;
}) {
  return (
    <div className="bv-delta flat hm-mtile">
      <div className="bv-delta-label">
        {label}
        {why && <Why explain={why} />}
      </div>
      <div className="bv-delta-value">
        <strong data-testid={testId}>{formatInrCompact(amount)}</strong>
      </div>
      <div className="bv-exact">{whole(amount)}</div>
      <div className="bv-delta-note">{note}</div>
    </div>
  );
}

/** A profit or an earning: the arrow and the word as well as the colour, the amount in full beneath, and est. when it rests on one. */
function SignedTile({
  label,
  amount,
  pct,
  note,
  estimated,
  testId,
  why,
}: {
  label: string;
  amount: number;
  pct: number | null;
  note: ReactNode;
  estimated: boolean;
  testId: string;
  why?: Explain;
}) {
  const dir = direction(amount);
  return (
    <div className={`bv-delta ${dir} hm-mtile`}>
      <div className="bv-delta-label">
        {label}
        {estimated && <Est />}
        {why && <Why explain={why} />}
      </div>
      <div className="bv-delta-value">
        <span aria-hidden="true" className="bv-arrow">
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'}
        </span>
        <span className="sr-only">
          {dir === 'up' ? 'Up ' : dir === 'down' ? 'Down ' : 'No change '}
        </span>
        <strong data-testid={testId}>{formatInrCompact(Math.abs(amount))}</strong>
        {pct !== null && <span className="bv-delta-pct">{formatPct(Math.abs(pct), 2)}</span>}
      </div>
      <div className="bv-exact">
        {amount < 0 ? '−' : ''}
        {whole(Math.abs(amount))}
      </div>
      <div className="bv-delta-note">{note}</div>
    </div>
  );
}

/**
 * The five money figures under the net worth: what was put in, what it is worth, what it pays at maturity, what it has earned and
 * what it earned today. Together the four kinds of holding below add up to these, so each figure can be checked on its own page.
 */
export function Money({ m, ex }: { m: HomeModel; ex: ExplainSet<'home'> }) {
  const k = m.money;
  return (
    <div className="hm-money" role="group" aria-label="Money figures">
      <Tile
        label="Total invested"
        amount={k.invested}
        note="deposit amounts and the cost of the fund units held; savings and cash are not counted as invested"
        testId="hm-invested"
        why={ex['home.invested']}
      />
      <Tile
        label="Current value"
        amount={k.current}
        note="net worth: everything counted, at today’s value"
        testId="hm-current"
        why={ex['home.current']}
      />
      <Tile
        label="Maturity value"
        amount={k.maturity}
        note="deposits at what they pay on their dates, the rest at today’s value"
        testId="hm-maturity"
        why={ex['home.maturity']}
      />
      <SignedTile
        label="Profit so far"
        amount={k.profit}
        pct={k.profitPct}
        note={`deposit interest and fund gains on the money invested (now worth ${formatInrCompact(k.valueOfInvested)}); % of the amount invested`}
        estimated={k.estimated}
        testId="hm-profit"
        why={ex['home.profit']}
      />
      <SignedTile
        label="Earned today"
        amount={m.change.today.amount}
        pct={m.change.today.pct}
        note="interest at each rate and fund price moves, since yesterday; % of yesterday’s net worth"
        estimated
        testId="hm-earned-today"
        why={ex['home.earnedToday']}
      />
    </div>
  );
}
