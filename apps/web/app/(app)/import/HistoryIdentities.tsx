'use client';

import { useState } from 'react';
import type { AccountChoice, IdentityLine } from '@fwos/ingest';
import {
  chooseAccount,
  identityChip,
  identityGroups,
  identityHeading,
  identityHeadline,
  sharedLines,
  sharedState,
  type HistoryView,
  type Pins,
} from '@/lib/history-view';

const choiceText = (c: AccountChoice) => (c.detail ? `${c.label} (${c.detail})` : c.label);
const needsYou = (l: IdentityLine) =>
  l.state === 'likely' || l.state === 'ambiguous' || l.state === 'blocked';

/**
 * Import > History: the savings and cash lines the tab does not say the account of ("Cash" under a bank where there is an NRE and an
 * NRO account). Each was matched from the other tabs of the same workbook where the tabs allow it. Sure ones are ticked; likely ones
 * are shown and wait to be ticked; where nothing settles it the person chooses from a list, for that line or for every tab where the
 * same label sits in the same place. The answers go back to the server with every request, so they are part of the plan.
 */
export function HistoryIdentities({
  view,
  pins,
  busy,
  onPins,
}: {
  view: HistoryView;
  pins: Pins;
  busy: boolean;
  onPins: (next: Pins) => void;
}) {
  const [also, setAlso] = useState<Record<string, boolean>>({});
  const groups = identityGroups(view);
  if (groups.length === 0) return null;
  const total = groups.reduce((s, g) => s + g.lines.length, 0);
  const head = identityHeadline(view.summary.identities);

  const set = (l: IdentityLine, accountId: string | undefined) =>
    onPins(chooseAccount(pins, view, l, accountId, also[l.id] ?? false));

  const toggleAlso = (l: IdentityLine, on: boolean) => {
    setAlso({ ...also, [l.id]: on });
    const mine = pins[l.id];
    if (mine === undefined || mine === '') return;
    if (on) onPins(chooseAccount(pins, view, l, mine, true));
    else {
      const next = { ...pins };
      for (const t of sharedLines(view, l, mine)) if (next[t.id] === mine) delete next[t.id];
      onPins(next);
    }
  };

  return (
    <section className="hist-block" aria-labelledby="hist-ident" data-testid="hist-ident">
      <h3 id="hist-ident">Which account is each savings line? ({total})</h3>
      <p className="muted small">
        These lines say only &ldquo;Cash&rdquo; where the bank has more than one account. The
        accounts are the same ones as in the tabs around them, so each line is matched from there.
        Sure answers are ticked; likely ones wait for you to tick them; where the tabs cannot tell,
        choose the account.
      </p>
      {head && (
        <p className="small hist-ident-head" role="status" data-testid="hist-ident-head">
          {head}
        </p>
      )}
      {groups.map((g) => {
        const todo = g.lines.filter(needsYou).length;
        return (
          <details key={g.tab} className="disclose hist-ident-tab" open={todo > 0}>
            <summary>
              {g.tab} ({g.lines.length})
              {todo > 0 && <span className="hist-ident-todo"> · {todo} to look at</span>}
            </summary>
            <ul className="hist-ident-list">
              {g.lines.map((l) => (
                <IdentityCard
                  key={l.id}
                  line={l}
                  view={view}
                  pins={pins}
                  busy={busy}
                  also={also[l.id]}
                  onChoose={(id) => set(l, id)}
                  onAlso={(on) => toggleAlso(l, on)}
                />
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}

function IdentityCard({
  line: l,
  view,
  pins,
  busy,
  also,
  onChoose,
  onAlso,
}: {
  line: IdentityLine;
  view: HistoryView;
  pins: Pins;
  busy: boolean;
  also: boolean | undefined;
  onChoose: (accountId: string | undefined) => void;
  onAlso: (on: boolean) => void;
}) {
  const chip = identityChip(l);
  const heading = identityHeading(l);
  const mine = pins[l.id];
  const twins = mine ? sharedLines(view, l, mine).length : l.sameAs.length;
  const shared = sharedState(pins, view, l);
  const canAlso = l.sameAs.length > 0 && l.state !== 'certain';
  const sure = l.state === 'certain' || l.state === 'likely';
  return (
    <li className={`hist-ident ${l.state}`} data-testid="hist-ident-line" data-state={l.state}>
      <div className="hist-ident-top">
        <span className={`hist-chip ${chip.tone}`} data-testid="hist-chip">
          {chip.word}
        </span>
        <span className="hist-ident-title">{heading}</span>
      </div>
      <p className="small hist-ident-why" data-testid="hist-ident-why">
        {l.why}
      </p>
      {sure && l.fromTabs.length > 0 && (
        <p className="small muted">
          Worked out from the {l.fromTabs.join(' and ')} tab{l.fromTabs.length > 1 ? 's' : ''}.
        </p>
      )}

      {sure && l.account && (
        <label className="hist-ident-use small">
          <input
            type="checkbox"
            // the person's tick shows at once; the counts follow when the plan has been made again
            checked={mine === '' ? false : l.state === 'likely' && mine ? true : l.accepted}
            disabled={busy}
            onChange={(e) => {
              if (l.state === 'certain') {
                // unticking a sure line leaves it out; ticking it again takes that back
                if (e.target.checked) onChoose(undefined);
                else onChoose('');
              } else if (e.target.checked) onChoose(l.account!.id);
            }}
            aria-label={`Use ${l.account.label} for ${heading}`}
          />
          <span>
            Use <strong>{choiceText(l.account)}</strong>
          </span>
        </label>
      )}

      {l.state === 'left_out' && (
        <p className="small">
          Left out.{' '}
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => onChoose(undefined)}
          >
            Undo
          </button>
        </p>
      )}

      {(l.state === 'ambiguous' || l.state === 'blocked' || l.state === 'pinned') && (
        <label className="hist-ident-pick small">
          Which account is this?
          <select
            value={mine && mine !== '' ? mine : ''}
            disabled={busy}
            onChange={(e) => onChoose(e.target.value === '' ? undefined : e.target.value)}
            aria-label={`Which account is this? ${heading}`}
          >
            <option value="">Not chosen: leave this line out</option>
            <optgroup label="Fits this line">
              {l.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {choiceText(c)}
                </option>
              ))}
            </optgroup>
            {l.others.length > 0 && (
              <optgroup label="Other accounts at this bank">
                {l.others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {choiceText(c)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}

      {canAlso && (
        <label className="hist-ident-also small">
          <input
            type="checkbox"
            checked={also ?? shared.all}
            disabled={busy}
            onChange={(e) => onAlso(e.target.checked)}
          />
          <span>
            Also for every tab where &ldquo;{l.label.trim() || 'Cash'}&rdquo; sits in the same place
            ({twins} more)
          </span>
        </label>
      )}
    </li>
  );
}
