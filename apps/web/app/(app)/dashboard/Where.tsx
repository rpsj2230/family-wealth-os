import Link from 'next/link';
import {
  formatInrCompact,
  formatPct,
  type AllocKey,
  type ExplainSet,
  type PersonStyle,
} from '@fwos/core';
import { SplitBar } from '@/app/(app)/accounts/BankOverview';
import { PersonBadge } from '@/components/Person';
import type { HomeModel } from '@/lib/home';
import { CardHead, homeLink } from './parts';

/** One colour slot per kind of holding, the palette the fund graphs use, so a kind keeps its colour everywhere. */
const SLOT: Record<AllocKey, string> = {
  cash: 'var(--viz-1)',
  fd: 'var(--viz-7)',
  funds: 'var(--viz-3)',
  stocks: 'var(--viz-4)',
  property: 'var(--viz-2)',
  lent: 'var(--viz-5)',
  retirement: 'var(--viz-6)',
  other: 'var(--viz-other)',
};

/** Where the money is: by kind of holding, by person, and (when they exist) by NRE or NRO and by currency. */
export function Where({
  m,
  styles,
  sample,
  ex,
}: {
  m: HomeModel;
  styles: Record<string, PersonStyle>;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const types = m.banks.overview.accountTypes;
  const foreign = m.currencies.length > 1;
  return (
    <section className="card hm-card" aria-labelledby="hm-where">
      <CardHead title="Where the money is" id="hm-where" why={ex['home.where']} />
      <SplitBar
        caption="Net worth by kind of holding"
        parts={m.allocation.map((a) => ({
          key: a.key,
          label: a.label,
          share: a.share,
          className: 'hm-slot',
          style: { background: SLOT[a.key] },
        }))}
      />
      <ul className="hm-legend-rows">
        {m.allocation.map((a) => (
          <li key={a.key}>
            <span className="hm-lname">
              <span className="bv-swatch" style={{ background: SLOT[a.key] }} aria-hidden="true" />
              {a.label}
            </span>
            <strong className="hm-lamt">{formatInrCompact(a.amount)}</strong>
            <span className="hm-lpct">{formatPct(a.share, 0)}</span>
          </li>
        ))}
      </ul>

      {m.byPerson.length > 1 && (
        <>
          <h3 className="bv-h hm-sub">Whose money</h3>
          <SplitBar
            caption="Net worth by person"
            parts={m.byPerson.map((p) => ({
              key: p.ownerId,
              label: styles[p.ownerId]?.name ?? 'Unknown',
              share: p.share,
              className: 'person',
              style: { background: styles[p.ownerId]?.colour ?? 'var(--muted)' },
            }))}
          />
          <ul className="hm-legend-rows">
            {m.byPerson.map((p) => {
              const href = homeLink(`/accounts?p=${p.ownerId}`, sample);
              const who = <PersonBadge p={styles[p.ownerId]} name size={18} />;
              return (
                <li key={p.ownerId}>
                  <span className="hm-lname">
                    {href ? (
                      <Link href={href} className="personlink">
                        {who}
                      </Link>
                    ) : (
                      who
                    )}
                  </span>
                  <strong className="hm-lamt">{formatInrCompact(p.amount)}</strong>
                  <span className="hm-lpct">{formatPct(p.share, 0)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(types.length > 1 || foreign) && (
        <div className="hm-minis">
          {types.length > 1 && (
            <div>
              <h3 className="bv-h hm-sub">NRE and NRO, bank money</h3>
              <SplitBar
                caption="NRE and NRO"
                parts={types.map((t) => ({
                  key: t.key,
                  label: t.label,
                  share: t.share,
                  className: `type-${t.key}`,
                }))}
              />
              <p className="small muted hm-minitext">
                {types
                  .map((t) => `${t.label} ${formatInrCompact(t.amount)} (${formatPct(t.share, 0)})`)
                  .join(' · ')}
              </p>
            </div>
          )}
          {foreign && (
            <div>
              <h3 className="bv-h hm-sub">By currency, in rupees</h3>
              <p className="small muted hm-minitext">
                {m.currencies
                  .map((c) => `${c.label} ${formatInrCompact(c.value)} (${formatPct(c.share, 0)})`)
                  .join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
