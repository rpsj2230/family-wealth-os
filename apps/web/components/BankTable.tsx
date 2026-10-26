import Link from 'next/link';
import {
  DEFAULT_CONFIG,
  bankStyle,
  formatInr,
  type BankBlock,
  type BankRow,
  type PersonStyle,
} from '@fwos/core';
import { AccordionControls } from './AccordionControls';
import { BankBadge } from './BankBadge';
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

/** When a value was last set and by what: the email reader, you, a bank statement, a fund statement, the imported sheet or a calculation. */
export function UpdatedCell({
  asOf,
  source,
}: {
  asOf: string | null;
  source: { label: string; kind: 'auto' | 'manual' | 'calc' | 'import' | 'none' };
}) {
  const word =
    source.kind === 'calc'
      ? 'Calculated'
      : source.kind === 'none'
        ? 'No value yet'
        : (source.label.split(',')[0] ?? source.label);
  return (
    <div className="updcell" title={source.label}>
      <div className="upddate">{asOf ? fmtDate(asOf) : source.kind === 'calc' ? 'daily' : '–'}</div>
      <span className={`srcchip ${source.kind}`}>{word}</span>
    </div>
  );
}

function Money({ v }: { v: number | null }) {
  return <>{v === null ? '–' : formatInr(Math.round(v))}</>;
}

function Row({ r, soonDays }: { r: BankRow; soonDays: number }) {
  const fd = r.fd;
  const note = cleanNote(r.notes);
  return (
    <tr className={`xlrow ${r.status !== 'active' ? 'dim' : ''}`}>
      <td className="code">
        <div className="codeline">
          <Link
            className={`kind ${r.kind}`}
            href={`/asset/${r.assetId}`}
            title="Open the history of this account"
          >
            {r.code}
          </Link>
          {r.kindInferred && (
            <Link
              className="pill assumed"
              href="/accounts/edit"
              title="The type (NRE or NRO) is not recorded on this row and is taken from the savings account. Click to correct it."
            >
              type assumed
            </Link>
          )}
        </div>
        {fd?.linkedTo && <div className="sub">↳ linked to {fd.linkedTo}</div>}
        {r.kind === 'cash' && <div className="sub">{r.source.label}</div>}
        {r.kind === 'held' && r.holderName && <div className="sub">held by {r.holderName}</div>}
      </td>
      <td className="mid">{fd ? pctText(fd.rate) : ''}</td>
      <td className="mid nowrap">{fd ? fmtDate(fd.bookedOn) : ''}</td>
      <td className="mid nowrap">
        {fd ? fmtDate(fd.maturityOn) : ''}
        {fd && fd.needsConfirmation && <span className="pill bad">matured</span>}
        {fd && !fd.needsConfirmation && fd.daysLeft >= 0 && fd.daysLeft <= soonDays && (
          <span className="pill soon">{fd.daysLeft}d left</span>
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
      <td className="upd">
        <UpdatedCell asOf={r.asOf} source={r.source} />
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
  notes,
  saveNote,
}: {
  blocks: BankBlock[];
  styles: Record<string, PersonStyle>;
  updateBase?: string;
  soonDays?: number;
  /** notes about the whole bank, by bank id */
  notes?: Record<string, string>;
  /** server action that saves a bank note; without it the note is shown but not editable */
  saveNote?: (f: FormData) => Promise<void>;
}) {
  return (
    <>
      <AccordionControls />
      {blocks.map((b) => (
        <section
          className="card xlbank"
          key={b.key}
          id={slugify(b.name)}
          aria-labelledby={`h-${b.key}`}
          style={{ ['--bank' as string]: bankStyle(b.name).colour }}
        >
          <details open className="bankdet">
            <summary className="xlhead">
              <BankBadge name={b.name} />
              <h2 id={`h-${b.key}`}>
                {b.key === '__none' ? b.name : <Link href={`/bank/${b.key}`}>{b.name}</Link>}
              </h2>
              <span className="tot">
                <b className="num big">{formatInr(Math.round(b.totals.current))}</b>
              </span>
              {b.needsYou > 0 ? (
                <span className="pill warn">
                  {b.needsYou} need{b.needsYou === 1 ? 's' : ''} you
                </span>
              ) : b.doneThisMonth ? (
                <span className="pill ok">
                  Updated {b.lastUpdated ? fmtDate(b.lastUpdated) : 'this month'}
                </span>
              ) : (
                <span className="pill warn">
                  {b.lastUpdated ? `Last updated ${fmtDate(b.lastUpdated)}` : 'Not updated yet'}
                </span>
              )}
              <Link className="btn compact" href={`${updateBase}/${slugify(b.name)}`}>
                Update
              </Link>
            </summary>
            {(notes?.[b.key] || saveNote) && (
              <div className="banknote small">
                {notes?.[b.key] ? (
                  <span>{notes[b.key]}</span>
                ) : (
                  <span className="muted">No bank note.</span>
                )}
                {saveNote && (
                  <details>
                    <summary>{notes?.[b.key] ? 'Edit note' : 'Add a note'}</summary>
                    <form action={saveNote} className="row">
                      <input type="hidden" name="id" value={b.key} />
                      <input
                        name="note"
                        defaultValue={notes?.[b.key] ?? ''}
                        maxLength={500}
                        placeholder="e.g. AMB 10,000 · no debit card · lounge card"
                        aria-label={`Note about ${b.name}`}
                        style={{ flex: 1, minWidth: 220 }}
                      />
                      <button className="btn compact">Save</button>
                    </form>
                  </details>
                )}
              </div>
            )}
            <div className="xlwrap">
              <table className="xl">
                <colgroup>
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="mid">Rate</th>
                    <th className="mid">Start</th>
                    <th className="mid">Maturity</th>
                    <th className="num">Invested / balance</th>
                    <th className="num">At maturity</th>
                    <th className="num">Current value</th>
                    <th>Updated</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                {b.sections.map((sct) => (
                  <tbody
                    key={sct.ownerId}
                    style={{ ['--person' as string]: styles[sct.ownerId]?.colour }}
                  >
                    <tr className="secthead">
                      <th colSpan={9}>
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
          </details>
        </section>
      ))}
    </>
  );
}
