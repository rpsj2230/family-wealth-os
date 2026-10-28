import Link from 'next/link';
import { formatInrCompact, formatPct, type BankOverview } from '@fwos/core';

/**
 * The NRE and NRO legend, with the holdings behind every line that is not NRE or NRO: the Indian accounts with no type set yet (to set
 * it on each), and the holdings the two types do not apply to (accounts abroad, money held by others).
 */
export function TypeLegend({
  types,
  names,
  sample = false,
}: {
  types: BankOverview['accountTypes'];
  /** each person's name, by owner id */
  names: Record<string, string>;
  sample?: boolean;
}) {
  const lists = types.filter((t) => t.key !== 'NRE' && t.key !== 'NRO' && t.items.length > 0);
  return (
    <>
      <ul className="bv-legend plain">
        {types.map((t) => (
          <li key={t.key}>
            <span className={`bv-swatch type-${t.key}`} aria-hidden="true" />
            <span className="bv-lname">{t.label}</span>
            <strong className="bv-lamt">{formatInrCompact(t.amount)}</strong>
            <span className="bv-lpct">{formatPct(t.share, 0)}</span>
          </li>
        ))}
      </ul>
      {lists.map((t) => (
        <details key={t.key} className="bv-items small" data-testid={`type-items-${t.key}`}>
          <summary>
            {t.key === 'unset' ? 'Which have no type set' : t.label} ({t.items.length})
          </summary>
          <ol className="plain">
            {t.items.map((i) => (
              <li key={i.assetId}>
                {sample ? (
                  <span>
                    {i.bank} · {i.code}
                  </span>
                ) : (
                  <Link href={`/asset/${i.assetId}`}>
                    {i.bank} · {i.code}
                  </Link>
                )}{' '}
                <span className="muted">· {names[i.ownerId] ?? ''}</span>{' '}
                <strong>{formatInrCompact(i.amount)}</strong>
              </li>
            ))}
          </ol>
          {t.key === 'unset' && (
            <p className="muted">
              Open one and set NRE or NRO under More details, or set several at once on Accounts
              &gt; Edit.
            </p>
          )}
        </details>
      ))}
    </>
  );
}
