import Link from 'next/link';
import {
  DEFAULT_CONFIG,
  formatInr,
  type BankBlock,
  type BankRow,
  type PersonStyle,
} from '@fwos/core';
import { PersonBadge } from './Person';
import { slugify } from '@/lib/slug';

const D = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
export const fmtDate = (iso: string) => D.format(new Date(`${iso}T00:00:00Z`));
export const pctText = (r: number) =>
  `${(r * 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}%`;
/** The sheet kept the FD number in the notes; the app shows its last four digits separately, so the note is shown without it. */
export const cleanNote = (n: string | null) =>
  (n ?? '')
    .replace(/FD\s*Number\s*:\s*[^\s,]*(?:\s*,\s*[^\s,]*)*/i, '')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');

function Money({ v }: { v: number | null }) {
  return <>{v === null ? '–' : formatInr(Math.round(v))}</>;
}

function Row({ r, soonDays }: { r: BankRow; soonDays: number }) {
  const fd = r.fd;
  const note = cleanNote(r.notes);
  return (
    <tr className={`xlrow ${r.status !== 'active' ? 'dim' : ''}`}>
      <td className="code">
        <span className={`kind ${r.kind}`}>{r.code}</span>
        {r.kindInferred && (
          <span
            className="muted small"
            title="Not written on the row; taken from the savings account"
          >
            {' '}
            (NRE/NRO assumed)
          </span>
        )}
        {fd?.linkedTo && <div className="small muted">↳ linked to {fd.linkedTo}</div>}
        {r.kind === 'cash' && <div className="small src">{r.source.label}</div>}
        {r.kind === 'held' && r.holderName && (
          <div className="small muted">held by {r.holderName}</div>
        )}
      </td>
      <td className="num">{fd ? pctText(fd.rate) : ''}</td>
      <td className="num nowrap">{fd ? fmtDate(fd.bookedOn) : ''}</td>
      <td className="num nowrap">
        {fd ? fmtDate(fd.maturityOn) : ''}
        {fd && fd.needsConfirmation && <div className="small fail">matured</div>}
        {fd && !fd.needsConfirmation && fd.daysLeft >= 0 && fd.daysLeft <= soonDays && (
          <div className="small warnText">{fd.daysLeft}d left</div>
        )}
      </td>
      <td className="num">
        {fd ? (
          <Money v={fd.principal} />
        ) : r.kind === 'fd' ? (
          ''
        ) : (
          <Money v={r.recorded === null ? null : r.recorded} />
        )}
      </td>
      <td className="num">
        {fd ? (
          <>
            <Money v={fd.maturityAmount} />
            {!fd.maturityAmountFromBank && (
              <span className="muted" title="Worked out from the rate and dates">
                {' '}
                ~
              </span>
            )}
          </>
        ) : (
          ''
        )}
      </td>
      <td className="num cur">
        {r.status !== 'active' && r.kind === 'fd' ? (
          <span className="muted">{r.status.replace('_', ' ')}</span>
        ) : (
          <Money v={r.current} />
        )}
      </td>
      <td className="notes">
        {fd?.refLast4 && <span className="chip tiny">FD no. …{fd.refLast4}</span>} {note}
      </td>
    </tr>
  );
}

function Tot({ t }: { t: BankBlock['totals'] }) {
  return (
    <span className="tot">
      {t.fdInvested > 0 && (
        <>
          <span>
            FD invested <b className="num">{formatInr(Math.round(t.fdInvested))}</b>
          </span>
          <span>
            at maturity <b className="num">{formatInr(Math.round(t.fdMaturity))}</b>
          </span>
          <span>
            FD today <b className="num">{formatInr(Math.round(t.fdCurrent))}</b>
          </span>
        </>
      )}
      <span>
        savings <b className="num">{formatInr(Math.round(t.cash))}</b>
      </span>
    </span>
  );
}

/** One card per bank in your sheet's order; inside, a section per person and a row per account or deposit. */
export function BankTable({
  blocks,
  styles,
  updateBase = '/monthly',
  soonDays = DEFAULT_CONFIG.reminders.maturitySoonDays,
}: {
  blocks: BankBlock[];
  styles: Record<string, PersonStyle>;
  updateBase?: string;
  soonDays?: number;
}) {
  return (
    <>
      {blocks.map((b) => (
        <section
          className="card xlbank"
          key={b.key}
          id={slugify(b.name)}
          aria-labelledby={`h-${b.key}`}
        >
          <header className="xlhead">
            <h2 id={`h-${b.key}`}>{b.name}</h2>
            <span className="tot">
              <b className="num big">{formatInr(Math.round(b.totals.current))}</b>
            </span>
            {b.needsYou > 0 ? (
              <span className="pill warn">
                {b.needsYou} need{b.needsYou === 1 ? 's' : ''} you
              </span>
            ) : b.doneThisMonth ? (
              <span className="pill ok">Updated this month</span>
            ) : (
              <span className="pill">Not updated this month</span>
            )}
            <Link className="btn compact" href={`${updateBase}/${slugify(b.name)}`}>
              Update
            </Link>
          </header>
          <div className="xlwrap">
            <table className="xl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">Rate</th>
                  <th className="num">Start</th>
                  <th className="num">Maturity</th>
                  <th className="num">Invested / balance</th>
                  <th className="num">At maturity</th>
                  <th className="num">Current value</th>
                  <th>Notes</th>
                </tr>
              </thead>
              {b.sections.map((sct) => (
                <tbody
                  key={sct.ownerId}
                  style={{ ['--person' as string]: styles[sct.ownerId]?.colour }}
                >
                  <tr className="secthead">
                    <th colSpan={8}>
                      <PersonBadge p={styles[sct.ownerId]} name size={18} />
                      <Tot t={sct.totals} />
                    </th>
                  </tr>
                  {sct.rows.map((r) => (
                    <Row key={r.assetId} r={r} soonDays={soonDays} />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
