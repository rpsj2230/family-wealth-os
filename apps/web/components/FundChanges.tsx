'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  chipsOf,
  fmtUnits,
  formatInr,
  isListed,
  longDate,
  personStyles,
  sipChip,
  sipIsChange,
  sipKey,
  type Chip,
  type FundPrompt,
} from '@fwos/core';
import type { ItemView, PersonPreview } from '@/lib/fund-import';
import { MAX_LINES_SHOWN } from '@/lib/fund-import';
import {
  fundSelectable,
  initialAnswers,
  initialOff,
  inputOf,
  isQuiet,
  isTaken,
  selectionOf,
  sipDependsOnFund,
  tickedByAnswer,
  type Answer,
  type Answers,
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

/** Units, amount invested, value and first purchase, each from what is on file to what the statement says. */
function Nums({ item }: { item: ItemView }) {
  const hasNums = item.units || item.invested || item.value || item.startedOn;
  if (!hasNums) return null;
  return (
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
  );
}

/**
 * A question with the answer I think most likely: what was found, what I suggest and why, a one-click Approve, and the other choices
 * (radio options; a field where an answer needs a date). Nothing is written here: the answer is part of the preview's selection and
 * is applied with Apply. Where the answer would make a folio an ordinary fund, the fund's changes are shown under it.
 */
function Ask({
  prompt,
  answer,
  onAnswer,
  disabled,
  subject,
}: {
  prompt: FundPrompt;
  answer: Answer;
  onAnswer: (a: Answer) => void;
  disabled: boolean;
  subject: string;
}) {
  const id = useId();
  const s = prompt.suggestion;
  const rec = s.recommended ? s.options.find((o) => o.id === s.recommended)! : null;
  const chosen = s.options.find((o) => o.id === answer.option) ?? null;
  const approved = !!rec && answer.confirmed && answer.option === rec.id;
  // the suggestion is how things already go: it applies unless the person chooses otherwise
  const byDefault = !!rec && rec.id === prompt.start;
  const outs = !isQuiet(answer.option) ? (prompt.outcomes[answer.option] ?? []) : [];
  const pick = (optionId: string, confirmed: boolean) =>
    onAnswer({ option: optionId, input: inputOf(prompt, optionId), confirmed });
  const asOfMax = prompt.kind === 'absent' ? (inputOf(prompt, 'sold') ?? undefined) : undefined;
  return (
    <div className="fc-ask" role="group" aria-label={`Decision: ${subject}`}>
      <p className="fc-found">
        <span className="fc-lead">What I found</span> {s.found}
      </p>
      <p className="fc-suggest">
        <span className="fc-lead">What I suggest</span> {s.suggest}{' '}
        <span className="muted">{s.why}</span>
      </p>
      {rec && s.approve && (
        <div className="fc-approve">
          {approved ? (
            <p className="fc-approved" role="status">
              <span aria-hidden="true">✓ </span>
              {s.approve.replace(/^Approve: /, 'Approved: ')}.{' '}
              <span className="muted">
                {isQuiet(rec.id) && byDefault
                  ? 'Nothing is changed.'
                  : 'It is applied when you press Apply.'}
              </span>
            </p>
          ) : (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={disabled}
                onClick={() => pick(rec.id, true)}
              >
                {s.approve}
              </button>
              {byDefault && !isQuiet(rec.id) && (
                <span className="muted small">
                  Applied with the other changes unless you choose otherwise.
                </span>
              )}
            </>
          )}
        </div>
      )}
      <fieldset className="fc-choices" disabled={disabled}>
        <legend>{rec ? 'Or choose another answer' : 'Choose'}</legend>
        {s.options.map((o) => (
          <div key={o.id} className="fc-opt">
            <label>
              <input
                type="radio"
                name={`${id}-r`}
                checked={answer.option === o.id}
                onChange={() => pick(o.id, true)}
              />{' '}
              <span>{o.label}</span>
            </label>
            {o.input && answer.option === o.id && (
              <label className="fc-in">
                {o.input.label}{' '}
                <input
                  type={o.input.kind}
                  value={answer.input ?? ''}
                  required={o.input.required}
                  {...(asOfMax ? { max: asOfMax } : {})}
                  onChange={(e) => onAnswer({ ...answer, input: e.target.value, confirmed: true })}
                />
              </label>
            )}
          </div>
        ))}
      </fieldset>
      {s.links.length > 0 && (
        <p className="fc-links">
          {s.links.map((l) => (
            <Link key={l.href} className="btn compact" href={l.href}>
              {l.text}
            </Link>
          ))}
        </p>
      )}
      {outs.length > 0 && (
        <div className="fc-after" aria-live="polite">
          <p className="small muted">After you press Apply{chosen ? ` (${chosen.action})` : ''}:</p>
          <ul>
            {outs.map((o) => (
              <li key={o.key}>
                <strong>{o.name}</strong> <Chips chips={chipsOf(o)} />
                <Nums item={o} />
                {!o.changed && o.lines.newCount === 0 && (
                  <span className="muted small">
                    {' '}
                    Nothing else changes; only the link is remembered.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({
  item,
  off,
  onToggle,
  answers,
  onAnswer,
  people,
  disabled,
}: {
  item: ItemView;
  off: ReadonlySet<string>;
  onToggle: (key: string, on: boolean) => void;
  answers: Answers;
  onAnswer: (key: string, a: Answer, itemKey?: string) => void;
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
  // a question's answer decides a fund the statement does not list, so it has no tick of its own
  const asked = tickedByAnswer(item);
  const selectable = fundSelectable(item) && !asked;
  const prompt = item.prompt ?? null;
  const fundAnswer = answers[item.key];
  const sipAnswer = answers[sipK];
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
        {(chips.length > 0 || item.sipPrompt) && (
          <Chips
            chips={[
              ...chips.filter((c) => !(sipChange && c.label.startsWith('SIP'))),
              ...(item.sipPrompt ? [{ label: 'SIP: your decision', tone: 'warn' as const }] : []),
            ]}
          />
        )}
      </div>

      {!prompt && item.why && <p className="fc-why">{item.why}</p>}

      {prompt && fundAnswer && (
        <Ask
          prompt={prompt}
          answer={fundAnswer}
          disabled={disabled}
          subject={item.name}
          onAnswer={(a) => onAnswer(item.key, a, prompt.kind === 'absent' ? item.key : undefined)}
        />
      )}

      <Nums item={item} />

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
      {item.sipPrompt && sipAnswer && (
        <Ask
          prompt={item.sipPrompt}
          answer={sipAnswer}
          disabled={disabled}
          subject={`${item.name}, SIP`}
          onAnswer={(a) => onAnswer(sipK, a)}
        />
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
 * each SIP verdict. Where the app cannot be sure (a folio that could be several funds, a fund the statement does not list, a SIP it
 * could not judge, someone else's folios) the row says what it found, what it suggests and why, with an Approve button and the other
 * choices. Nothing is written here: the ticks and answers decide what the apply step does. With `inputs` the ticked and shown
 * items and the answers are also written into the enclosing form; `onSelection` reports them for a form that builds its own data.
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
  const [off, setOff] = useState<ReadonlySet<string>>(() => initialOff(people));
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(people));
  // a new preview starts with everything ticked again and every question on its suggested starting answer
  const [shownFor, setShownFor] = useState(people);
  if (shownFor !== people) {
    setShownFor(people);
    setOff(initialOff(people));
    setAnswers(initialAnswers(people));
  }
  const styles = useMemo(() => personStyles(owners), [owners]);
  const sel = useMemo(() => selectionOf(people, off, answers), [people, off, answers]);
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
  /** An answer is kept; where the answer is the tick (a fund the statement does not list), the tick follows it. */
  const answer = (key: string, a: Answer, tickKey?: string) => {
    setAnswers((prev) => ({ ...prev, [key]: a }));
    if (tickKey) toggle(tickKey, a.option === 'sold');
  };

  return (
    <div className="fc">
      {inputs && (
        <>
          {sel.seen.map((k) => (
            <input key={`seen-${k}`} type="hidden" name="seen" value={k} />
          ))}
          {sel.take.map((k) => (
            <input key={`take-${k}`} type="hidden" name="take" value={k} />
          ))}
          {sel.choices.map((c) => (
            <input
              key={`choice-${c.key}`}
              type="hidden"
              name="choice"
              value={JSON.stringify([c.key, c.option, c.input])}
            />
          ))}
        </>
      )}
      {people.map((p) => {
        const changed = p.diff.items.filter(isListed);
        const quiet = p.diff.items.filter((i) => !changed.includes(i) && i.assetId);
        const asking = changed.filter((i) => i.kind === 'review' || i.sipPrompt).length;
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
                ? `Dated ${longDate(p.diff.periodTo)}${p.diff.periodFrom ? `, from ${longDate(p.diff.periodFrom)}` : ''}. `
                : ''}
              {changed.length === 0
                ? 'Nothing new.'
                : `${changed.length} fund${changed.length === 1 ? '' : 's'} with something new or changed${quiet.length ? `, ${quiet.length} unchanged` : ''}.`}
              {asking > 0 &&
                ` ${asking} ${asking === 1 ? 'is' : 'are'} waiting for your decision, with my suggestion.`}
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
                    answers={answers}
                    onAnswer={answer}
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
      {needsReview.length > 0 && (
        <p className="small">
          Still waiting for your decision: {needsReview.join(', ')}. Preview the statement again to
          see my suggestion for {needsReview.length === 1 ? 'it' : 'each'}.
        </p>
      )}
    </div>
  );
}
