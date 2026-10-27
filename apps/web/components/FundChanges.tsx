'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import {
  PRIORITY_SENTENCE,
  chipsOf,
  fmtUnits,
  formatInr,
  fromInception,
  longDate,
  personStyles,
  priorityTotals,
  replaceIsChange,
  replaceKey,
  sipChip,
  sipIsChange,
  sipKey,
  sourceLabel,
  sourceRank,
  type Chip,
} from '@fwos/core';
import type { ItemView, PersonPreview } from '@/lib/fund-import';
import { MAX_LINES_SHOWN } from '@/lib/fund-import';
import {
  fundSelectable,
  isTaken,
  selectionOf,
  sipDependsOnFund,
  type FundSelection,
} from '@/lib/fund-import-select';
import { PersonBadge } from '@/components/Person';
import './fundchanges.css';

const KIND_WORD: Record<string, string> = {
  purchase: 'Purchase',
  sip: 'SIP instalment',
  switch_in: 'Switch in',
  dividend_reinvest: 'Dividend reinvested',
  bonus: 'Bonus units',
  redeem: 'Sale',
  switch_out: 'Switch out',
  other: 'Other',
};

const arrow = (a: string | null, b: string) => (
  <>
    <span className="fc-before">{a ?? '–'}</span>
    <span aria-hidden="true"> → </span>
    <span className="sr-only"> to </span>
    <strong>{b}</strong>
  </>
);

function Chips({ chips }: { chips: Chip[] }) {
  return (
    <span className="fc-chips">
      {chips.map((c) => (
        <span key={c.label} className={`fc-chip ${c.tone}`}>
          {c.label}
        </span>
      ))}
    </span>
  );
}

function Row({
  item,
  off,
  onToggle,
  people,
  disabled,
}: {
  item: ItemView;
  off: ReadonlySet<string>;
  onToggle: (key: string, on: boolean) => void;
  people: Pick<PersonPreview, 'diff'>[];
  disabled: boolean;
}) {
  const id = useId();
  const fundOn = isTaken(people, off, item.key);
  const sipK = sipKey(item.key);
  const sipOn = isTaken(people, off, sipK);
  const sip = item.sip;
  const chips = chipsOf(item);
  const sipChange = sipIsChange(sip) ? sip : null;
  const sipLocked = sipChange && sipDependsOnFund(item) && !fundOn;
  const selectable = fundSelectable(item);
  const hasNums = item.units || item.invested || item.value || item.startedOn;
  const rep = replaceIsChange(item) ? item.lines.replace! : null;
  const replaceK = replaceKey(item.key);
  const replaceOn = isTaken(people, off, replaceK);
  const replaceLocked = !fundOn;
  const fromWords = rep
    ? Object.entries(rep.bySource)
        .sort(([a], [b]) => sourceRank(b) - sourceRank(a))
        .map(([src, n]) => `${n} ${sourceLabel(src).toLowerCase()}`)
        .join(', ')
    : '';
  return (
    <li className={`fc-row ${item.kind}${selectable && !fundOn ? ' off' : ''}`}>
      <div className="fc-head">
        {selectable ? (
          <input
            id={`${id}-f`}
            type="checkbox"
            checked={fundOn}
            disabled={disabled}
            onChange={(e) => onToggle(item.key, e.target.checked)}
            aria-label={`Apply the changes to ${item.name}`}
          />
        ) : (
          <span className="fc-nobox" aria-hidden="true" />
        )}
        <label htmlFor={selectable ? `${id}-f` : undefined} className="fc-name">
          {item.name}
        </label>
        {chips.length > 0 && (
          <Chips chips={chips.filter((c) => !(sipChange && c.label.startsWith('SIP')))} />
        )}
      </div>

      {item.why && <p className="fc-why">{item.why}</p>}

      {hasNums && (
        <dl className="fc-nums">
          {item.units && (
            <div>
              <dt>Units</dt>
              <dd>
                {arrow(
                  item.units.before === null ? null : fmtUnits(item.units.before),
                  fmtUnits(item.units.after),
                )}
              </dd>
            </div>
          )}
          {item.invested && (
            <div>
              <dt>Invested</dt>
              <dd>
                {arrow(
                  item.invested.before === null ? null : formatInr(item.invested.before),
                  formatInr(item.invested.after),
                )}
              </dd>
            </div>
          )}
          {item.value && (
            <div>
              <dt>Value on {longDate(item.value.asOf)}</dt>
              <dd>
                {arrow(
                  item.value.before === null ? null : formatInr(item.value.before),
                  formatInr(item.value.after),
                )}
              </dd>
            </div>
          )}
          {item.startedOn && (
            <div>
              <dt>First purchase</dt>
              <dd>
                {arrow(
                  item.startedOn.before ? longDate(item.startedOn.before) : null,
                  longDate(item.startedOn.after),
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {rep && (
        <div className={`fc-replace${replaceLocked || !replaceOn ? ' off' : ''}`}>
          <input
            id={`${id}-r`}
            type="checkbox"
            checked={replaceOn}
            disabled={disabled || replaceLocked}
            onChange={(e) => onToggle(replaceK, e.target.checked)}
            aria-label={`Replace the lines on file for ${item.name} with the statement's`}
          />
          <div className="fc-replacebody">
            <label htmlFor={`${id}-r`}>
              This statement replaces {rep.count} line{rep.count === 1 ? '' : 's'} on file (from{' '}
              {fromWords}), adds {item.lines.newCount}, confirms {item.lines.duplicateCount}.
            </label>
            <p className="fc-why">
              {replaceOn && !replaceLocked
                ? 'They are kept in a hidden list on the fund page, not deleted. Untick to keep your own lines for this fund.'
                : 'Your own lines stay as they are for this fund.'}
            </p>
            <details className="fc-lines fc-replaced">
              <summary>
                The {Math.min(rep.views.length, 5)} first of {rep.count}
              </summary>
              <table className="fc-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What</th>
                    <th>From</th>
                    <th className="num">Amount</th>
                    <th className="num">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.views.slice(0, 5).map((l, n) => (
                    <tr key={`${l.date}${n}`}>
                      <td>{longDate(l.date)}</td>
                      <td>{KIND_WORD[l.kind] ?? l.kind}</td>
                      <td>{sourceLabel(l.source)}</td>
                      <td className="num">{formatInr(l.amount)}</td>
                      <td className="num">{fmtUnits(l.units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        </div>
      )}

      {item.lines.newCount > 0 && (
        <details className="fc-lines">
          <summary>
            {item.lines.newCount} new transaction{item.lines.newCount === 1 ? '' : 's'}
            {item.lines.duplicateCount > 0 && (
              <span className="muted"> · {item.lines.duplicateCount} already on file</span>
            )}
          </summary>
          <table className="fc-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th className="num">Amount</th>
                <th className="num">Units</th>
              </tr>
            </thead>
            <tbody>
              {item.lines.newLines.map((l, n) => (
                <tr key={`${l.date}${n}`}>
                  <td>{longDate(l.date)}</td>
                  <td>{KIND_WORD[l.kind] ?? l.kind}</td>
                  <td className="num">{formatInr(l.amount)}</td>
                  <td className="num">{fmtUnits(l.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {item.lines.newCount > MAX_LINES_SHOWN && (
            <p className="muted small">
              and {item.lines.newCount - Math.min(item.lines.newLines.length, MAX_LINES_SHOWN)} more
              not listed here
            </p>
          )}
        </details>
      )}

      {sipChange && (
        <div className={`fc-sip${sipLocked || !sipOn ? ' off' : ''}`}>
          <input
            id={`${id}-s`}
            type="checkbox"
            checked={sipOn}
            disabled={disabled || !!sipLocked}
            onChange={(e) => onToggle(sipK, e.target.checked)}
            aria-label={`Apply the SIP change to ${item.name}`}
          />
          <div className="fc-sipbody">
            <label htmlFor={`${id}-s`}>
              <Chips chips={[sipChip(sipChange)!]} />
              {sipChange.effectiveOn && (
                <span className="muted small"> from {longDate(sipChange.effectiveOn)}</span>
              )}
            </label>
            <p className="fc-why">{sipChange.why}</p>
          </div>
        </div>
      )}
      {sip && sip.kind === 'ignored' && <p className="fc-note">{sip.why}</p>}
      {item.notes.map((n) => (
        <p key={n} className="fc-note">
          {n}
        </p>
      ))}
    </li>
  );
}

/**
 * What a statement or file would change, person by person and fund by fund, as compact rows with chips and a tick for each fund and
 * each SIP verdict. Nothing is written here: the ticks decide what the apply step does. With `inputs` the ticked and shown items are
 * also written into the enclosing form (the name "take" and "seen"); `onSelection` reports them for a form that builds its own data.
 */
export function FundChanges({
  people,
  owners,
  inputs = false,
  disabled = false,
  onSelection,
}: {
  people: PersonPreview[];
  owners: { id: string; name: string }[];
  inputs?: boolean;
  disabled?: boolean;
  onSelection?: (s: FundSelection) => void;
}) {
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  // a new preview starts with everything ticked again
  const [shownFor, setShownFor] = useState(people);
  if (shownFor !== people) {
    setShownFor(people);
    setOff(new Set());
  }
  const styles = useMemo(() => personStyles(owners), [owners]);
  const sel = useMemo(() => selectionOf(people, off), [people, off]);
  useEffect(() => {
    onSelection?.(sel);
  }, [sel, onSelection]);
  const toggle = (key: string, on: boolean) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });

  const statementOnly = people.length > 0 && people.every((p) => p.files.length === 0);
  const totals = useMemo(() => priorityTotals(people.flatMap((p) => p.diff.items)), [people]);
  return (
    <div className="fc">
      {statementOnly && (
        <div className="fc-priority" role="note">
          <p>
            <strong>{PRIORITY_SENTENCE.split('. ')[0]}.</strong>{' '}
            {PRIORITY_SENTENCE.split('. ').slice(1).join('. ')}
          </p>
          <p className="fc-counts">
            {totals.replaced > 0
              ? `${totals.replaced} line${totals.replaced === 1 ? '' : 's'} on file in ${totals.funds} fund${totals.funds === 1 ? '' : 's'} replaced, `
              : 'Nothing on file is replaced, '}
            {totals.added} line{totals.added === 1 ? '' : 's'} added, {totals.confirmed} confirmed.
          </p>
        </div>
      )}
      {inputs && (
        <>
          {sel.seen.map((k) => (
            <input key={`seen-${k}`} type="hidden" name="seen" value={k} />
          ))}
          {sel.take.map((k) => (
            <input key={`take-${k}`} type="hidden" name="take" value={k} />
          ))}
        </>
      )}
      {people.map((p) => {
        const changed = p.diff.items.filter(
          (i) => i.changed || sipIsChange(i.sip) || i.kind === 'review',
        );
        const quiet = p.diff.items.filter((i) => !changed.includes(i) && i.assetId);
        const style = styles[p.ownerId];
        return (
          <section
            key={p.ownerId}
            className="fc-person"
            style={style ? ({ '--fc-colour': style.colour } as React.CSSProperties) : undefined}
            aria-label={`Changes for ${p.name}`}
          >
            <h3>
              <PersonBadge p={style} name />
              {p.files.length > 0 && <span className="muted small"> · {p.files.join(', ')}</span>}
            </h3>
            <p className="muted small fc-period">
              {p.diff.periodTo
                ? `Dated ${longDate(p.diff.periodTo)}${p.diff.periodFrom ? (fromInception(p.diff.periodFrom) ? ', from the beginning' : `, from ${longDate(p.diff.periodFrom)}`) : ''}. `
                : ''}
              {changed.length === 0
                ? 'Nothing new.'
                : `${changed.length} fund${changed.length === 1 ? '' : 's'} with something new or changed${quiet.length ? `, ${quiet.length} unchanged` : ''}.`}
            </p>
            {changed.length === 0 ? (
              <p className="notice ok" role="status">
                Everything on this {p.files.length ? 'file' : 'statement'} is already on file, so
                nothing will be changed.
              </p>
            ) : (
              <ul className="fc-list">
                {changed.map((i) => (
                  <Row
                    key={i.key}
                    item={i}
                    off={off}
                    onToggle={toggle}
                    people={people}
                    disabled={disabled}
                  />
                ))}
              </ul>
            )}
            {quiet.length > 0 && (
              <details className="fc-quiet">
                <summary>
                  {quiet.length} fund{quiet.length === 1 ? '' : 's'} unchanged, left alone
                </summary>
                <ul>
                  {quiet.map((i) => (
                    <li key={i.key}>
                      {i.name}
                      {i.sip && i.sip.kind === 'unchanged' && i.sip.after ? (
                        <span className="muted small">
                          {' '}
                          · SIP {formatInr(i.sip.after)} unchanged
                        </span>
                      ) : null}
                      {i.notes
                        .filter((n) => n.startsWith('Kept:') || n.includes('inside the period'))
                        .map((n) => (
                          <span key={n} className="muted small fc-kept">
                            {n}
                          </span>
                        ))}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {p.diff.skipped > 0 && (
              <p className="muted small">
                {p.diff.skipped} fund{p.diff.skipped === 1 ? '' : 's'} fully sold before this
                financial year {p.diff.skipped === 1 ? 'was' : 'were'} not added.
              </p>
            )}
            {p.diff.notes.map((n) => (
              <p key={n} className="fc-note">
                {n}
              </p>
            ))}
            {p.notes.length > 0 && (
              <ul className="list small">
                {p.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** What was written after the chosen changes were applied. */
export function AppliedChanges({
  summary,
  lines,
  needsReview,
  name,
}: {
  summary: string;
  lines: string[];
  needsReview: string[];
  name?: string;
}) {
  return (
    <div className="notice ok fc-applied" role="status">
      <p>
        <strong>
          {name ? `${name}: ` : ''}Done. {summary}
        </strong>
      </p>
      {lines.length > 0 && (
        <ul className="list small">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {needsReview.length > 0 && <p className="small">Please check: {needsReview.join(', ')}.</p>}
    </div>
  );
}
