import Link from 'next/link';
import {
  DEFAULT_CONFIG,
  bankRowFigures,
  bankStyle,
  formatForeign,
  formatInr,
  type BankBlock,
  type BankRow,
  type PersonStyle,
} from '@fwos/core';
import { NOT_COUNTED_NOTE } from '@/lib/matured-list';
import type { CashRate } from '@/lib/rates-view';
import { AccordionControls } from './AccordionControls';
import { BankBadge } from './BankBadge';
import { ConfirmMatured } from './ConfirmMatured';
import { ForeignCashInline } from './ForeignCash';
import { NoticeHost } from './NoticeHost';
import { PersonBadge } from './Person';
import { EditButton } from './QuickEdit';
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
  olderEmail = null,
}: {
  asOf: string | null;
  source: { label: string; kind: 'auto' | 'manual' | 'calc' | 'import' | 'none' };
  /** an email or statement reading older than the value shown: it was fetched but does not count */
  olderEmail?: { asOf: string; amount: number } | null;
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
      {source.label.includes('updated today') && <span className="updnote ok">updated today</span>}
      {olderEmail && (
        <span
          className="updnote"
          title={`A bank email dated ${fmtDate(olderEmail.asOf)} (${formatInr(Math.round(olderEmail.amount))}) was fetched, but a value with a later date is shown, so it does not count. Open it in Bank emails to use it anyway.`}
        >
          email {fmtDate(olderEmail.asOf)} is older
        </span>
      )}
    </div>
  );
}

function Money({ v }: { v: number | null }) {
  return <>{v === null ? '–' : formatInr(Math.round(v))}</>;
}

/** The state of a deposit that is not running, in two or three words. */
const stateWord = (r: BankRow) =>
  r.status === 'matured_unconfirmed' || (r.status === 'active' && r.fd?.needsConfirmation)
    ? 'matured'
    : r.status.replace('_', ' ');

function Row({
  r,
  soonDays,
  cashRate,
  sample,
}: {
  r: BankRow;
  soonDays: number;
  cashRate?: CashRate | undefined;
  sample: boolean;
}) {
  const fd = r.fd;
  // matured within the window and not confirmed: shown, not counted, with the button; older or confirmed ones are dimmed
  const toConfirm = fd?.listState === 'confirm';
  const note = cleanNote(r.notes);
  // what this line adds to the page total, read by the live total at the bottom (same rule as the overview)
  const fig = bankRowFigures(r);
  const totals = fig.counted
    ? {
        'data-inv': String(Math.round(fig.invested * 100) / 100),
        'data-mat': String(Math.round(fig.maturity * 100) / 100),
        'data-cur': String(Math.round(fig.current * 100) / 100),
      }
    : {};
  return (
    <tr
      className={`xlrow ${fd?.listState === 'hidden' || (r.status !== 'active' && !toConfirm) ? 'dim' : ''} ${toConfirm ? 'matured' : ''}`}
      {...totals}
    >
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
            <EditButton
              id={r.assetId}
              name={r.code}
              label="type assumed"
              className="pill assumed"
              title="The type (NRE or NRO) is not recorded on this row and is taken from the savings account. Click to correct it."
              plain
            />
          )}
          <EditButton id={r.assetId} name={r.code} className="onlynarrow" />
        </div>
        {fd?.linkedTo && <div className="sub">↳ linked to {fd.linkedTo}</div>}
        {toConfirm && (
          <div className="sub notcounted">
            {NOT_COUNTED_NOTE}
            <ConfirmMatured assetId={r.assetId} name={r.code} sample={sample} />
          </div>
        )}
        {r.kind === 'cash' && <div className="sub">{r.source.label}</div>}
        {r.kind === 'held' && r.holderName && <div className="sub">held by {r.holderName}</div>}
      </td>
      <td className="mid ratecell">
        {fd ? (
          pctText(fd.rate)
        ) : cashRate ? (
          <span title={cashRate.note}>
            {cashRate.tag === 'assumed' ? '~' : ''}
            {pctText(cashRate.rate)}
            <span className="ratetag">
              {cashRate.tag === 'own' ? 'set' : cashRate.tag === 'market' ? 'bank rate' : 'assumed'}
            </span>
          </span>
        ) : r.kind === 'held' ? (
          <span title="Money held by another person earns no interest">
            –<span className="ratetag">no interest</span>
          </span>
        ) : (
          ''
        )}
      </td>
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
          // a balance in another currency is shown in that currency (the rupee value is in the Current value column)
          <span data-testid={r.currency === 'INR' ? undefined : 'bt-native'}>
            {r.currency !== 'INR' && r.recorded !== null ? (
              formatForeign(r.recorded, r.currency)
            ) : (
              <Money v={r.recorded === null ? null : r.recorded} />
            )}
          </span>
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
        {toConfirm && fd ? (
          <div className="maturedcell">
            <span className="muted" title={NOT_COUNTED_NOTE}>
              <Money v={fd.maturityAmount} />
            </span>
            <div className="small muted">matured, not counted</div>
          </div>
        ) : fd && (r.status !== 'active' || fd.needsConfirmation) ? (
          <span className="muted">{stateWord(r)}</span>
        ) : (
          <Money v={r.current} />
        )}
      </td>
      <td className="upd">
        <UpdatedCell asOf={r.asOf} source={r.source} olderEmail={r.olderEmail ?? null} />
      </td>
      <td className="notes">
        {fd?.refLast4 && (
          <span className="chip tiny fdno">FD no. {fd.ref ?? `…${fd.refLast4}`}</span>
        )}{' '}
        {note && (
          <span className="notetxt" title={note}>
            {note}
          </span>
        )}
      </td>
      <td className="editcol">
        <EditButton id={r.assetId} name={r.code} className="onlywide" />
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
      <ForeignCashInline parts={t.foreign} lead="of it" testid="bt-person-fx" />
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
  cashRates,
  sample = false,
}: {
  blocks: BankBlock[];
  styles: Record<string, PersonStyle>;
  updateBase?: string;
  soonDays?: number;
  /** notes about the whole bank, by bank id */
  notes?: Record<string, string>;
  /** server action that saves a bank note; without it the note is shown but not editable */
  saveNote?: (f: FormData) => Promise<void>;
  /** the interest rate each savings account earns, by asset (see cashRatesFor) */
  cashRates?: Record<string, CashRate>;
  /** the public sample: "Confirm matured" is acted out and nothing is saved */
  sample?: boolean;
}) {
  return (
    <>
      <NoticeHost />
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
              <span className="tot headtot">
                <b className="num big">{formatInr(Math.round(b.totals.current))}</b>
                <ForeignCashInline parts={b.totals.foreign} testid="bt-bank-fx" />
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
                    <form action={saveNote} className="row notebox">
                      <input type="hidden" name="id" value={b.key} />
                      <textarea
                        name="note"
                        rows={2}
                        defaultValue={notes?.[b.key] ?? ''}
                        maxLength={500}
                        placeholder={
                          'First line: e.g. AMB 10,000 · no debit card\nSecond line: e.g. lounge card, branch, contact'
                        }
                        aria-label={`Note about ${b.name}`}
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
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '6%' }} />
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
                    <th className="editcol">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                {b.sections.map((sct) => (
                  <tbody
                    key={sct.ownerId}
                    style={{ ['--person' as string]: styles[sct.ownerId]?.colour }}
                  >
                    <tr className="secthead">
                      <th colSpan={10}>
                        {b.key === '__none' ? (
                          <PersonBadge p={styles[sct.ownerId]} name size={18} />
                        ) : (
                          <Link
                            className="personlink"
                            href={`/bank/${b.key}/${sct.ownerId}`}
                            title={`Open ${styles[sct.ownerId]?.name ?? 'this person'}'s page at ${b.name}`}
                          >
                            <PersonBadge p={styles[sct.ownerId]} name size={18} />
                          </Link>
                        )}
                        <Tot t={sct.totals} />
                      </th>
                    </tr>
                    {sct.rows.map((r) => (
                      <Row
                        key={r.assetId}
                        r={r}
                        soonDays={soonDays}
                        cashRate={cashRates?.[r.assetId]}
                        sample={sample}
                      />
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
