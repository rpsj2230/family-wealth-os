'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { formatInr, unitsText } from '@fwos/core';
import { niceDate } from '@/lib/dates';
import type { MatchRow } from '@/lib/match-data';
import '../fundchanges.css';
import './noprice.css';

export interface PriceResult {
  ok: boolean;
  message: string;
}
export interface SchemeHit {
  code: string;
  name: string;
  detail: string;
  amc: string;
}
export interface FundsWithoutPriceActions {
  /** one decision for one fund: form fields `asset` and `choice` (an AMFI code, or `none` for "not a listed fund") */
  decide: (prev: PriceResult | null, f: FormData) => Promise<PriceResult>;
  /** approves every suggestion whose ISIN is the scheme's own; the prices are fetched next, one scheme per call */
  approveCertain: () => Promise<PriceResult & { codes: string[] }>;
  fetchPrices: (code: string) => Promise<PriceResult>;
  search: (query: string) => Promise<SchemeHit[]>;
  /** refreshes the pages once everything is stored */
  finish: () => Promise<void>;
}

const rupee = (n: number) => formatInr(Math.round(n));

/** The line under a fund's name: who, folio, what is held and the value last recorded (labelled, with its date). */
export function FundFacts({ r }: { r: MatchRow }) {
  const bits = [
    r.ownerName || null,
    r.folioLast4 ? `folio …${r.folioLast4}` : null,
    r.units !== null ? `${unitsText(r.units)} units` : null,
    r.invested !== null && r.invested > 0 ? `${rupee(r.invested)} invested` : null,
  ].filter((x): x is string => !!x);
  return (
    <>
      <div className="muted small np-bits">{bits.join(' · ')}</div>
      <div className="small np-last">
        {r.lastValue ? (
          <>
            <span className="nopricechip" title="No official scheme gives this fund a price">
              No price source
            </span>{' '}
            last recorded value <strong>{rupee(r.lastValue.amount)}</strong> on{' '}
            {niceDate(r.lastValue.asOf)}
          </>
        ) : (
          <>
            <span className="nopricechip">No price source</span> no value recorded yet
          </>
        )}
      </div>
    </>
  );
}

/** One fund with no price source: what I found, what I suggest and why, Approve, and the other choices (including a search). */
function Prompt({
  r,
  actions,
  canMark,
  disabled,
}: {
  r: MatchRow;
  actions: FundsWithoutPriceActions;
  canMark: boolean;
  disabled: boolean;
}) {
  const p = r.proposal!;
  const id = useId();
  const rec = p.recommended;
  const [choice, setChoice] = useState<string>(rec ?? '');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SchemeHit[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [state, run, pending] = useActionState(actions.decide, null);
  const options = p.options.filter((o) => canMark || o.id !== 'none');
  const picked = options.find((o) => o.id === choice);
  const hit = hits?.find((h) => h.code === choice);
  const action = picked?.action ?? (hit ? `use ${hit.name} (AMFI code ${hit.code})` : null);
  const isRec = !!rec && choice === rec;
  const label = pending
    ? 'Saving…'
    : choice === ''
      ? 'Choose one of the above'
      : isRec && p.approve
        ? p.approve
        : `Approve my choice: ${action ?? ''}`;
  const find = () =>
    startSearch(async () => {
      const found = await actions.search(query);
      setHits(found.filter((h) => !options.some((o) => o.id === h.code)));
    });
  return (
    <form action={run} className="fc-ask np-ask" aria-label={`Decision: ${r.name}`}>
      <input type="hidden" name="asset" value={r.assetId} />
      <p className="fc-found">
        <span className="fc-lead">What I found</span> {p.found}
      </p>
      <p className="fc-suggest">
        <span className="fc-lead">What I suggest</span> {p.suggest}{' '}
        <span className="muted">{p.why}</span>
      </p>
      <fieldset className="fc-choices" disabled={pending || disabled}>
        <legend>{rec ? 'Or choose another answer' : 'Choose'}</legend>
        {options.map((o) => (
          <div key={o.id} className="fc-opt">
            <label>
              <input
                type="radio"
                name="choice"
                value={o.id}
                checked={choice === o.id}
                onChange={() => setChoice(o.id)}
              />{' '}
              <span>
                {o.label}
                {o.id === rec ? <span className="np-rec"> (my suggestion)</span> : null}
              </span>
            </label>
          </div>
        ))}
        {(hits ?? []).map((h) => (
          <div key={h.code} className="fc-opt">
            <label>
              <input
                type="radio"
                name="choice"
                value={h.code}
                checked={choice === h.code}
                onChange={() => setChoice(h.code)}
              />{' '}
              <span>
                {h.name} (AMFI code {h.code}){' '}
                <span className="muted">
                  {h.detail}
                  {h.amc ? `, ${h.amc}` : ''}
                </span>
              </span>
            </label>
          </div>
        ))}
      </fieldset>
      <div className="np-search">
        <label htmlFor={`${id}-q`} className="small muted">
          Not one of these? Search the official list by name, ISIN or AMFI code
        </label>
        <div className="np-searchrow">
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            placeholder="for example: Axis Large Cap direct"
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (query.trim().length >= 2) find();
              }
            }}
          />
          <button
            type="button"
            className="btn compact"
            disabled={disabled || searching || query.trim().length < 2}
            onClick={find}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {hits && hits.length === 0 && !searching && (
          <p className="small muted" role="status">
            Nothing in the official list matches “{query.trim()}”. Try fewer words.
          </p>
        )}
      </div>
      <div className="fc-approve">
        <button
          className={`btn ${choice === '' ? '' : 'primary'}`}
          disabled={pending || disabled || choice === ''}
        >
          {label}
        </button>
      </div>
      {state && (
        <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'ok' : 'fail'}>
          {state.message}
        </p>
      )}
    </form>
  );
}

/** "Approve all certain matches": every fund whose ISIN is the scheme's own at once, then each scheme's prices, one at a time. */
function ApproveAll({
  count,
  actions,
  disabled,
}: {
  count: number;
  actions: FundsWithoutPriceActions;
  disabled: boolean;
}) {
  const [busy, start] = useTransition();
  const [note, setNote] = useState<PriceResult | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const go = () =>
    start(async () => {
      setNote(null);
      setStep('Matching…');
      const r = await actions.approveCertain();
      const warn: string[] = [];
      for (let i = 0; i < r.codes.length; i++) {
        setStep(`Fetching prices ${i + 1} of ${r.codes.length}…`);
        const h = await actions.fetchPrices(r.codes[i]!);
        if (!h.ok) warn.push(h.message);
      }
      setStep(null);
      setNote({
        ok: r.ok && warn.length === 0,
        message: [
          r.message,
          ...(warn.length > 0 ? [`${warn.length} price fetch(es) will be retried tonight.`] : []),
        ].join(' '),
      });
      await actions.finish();
    });
  return (
    <div className="np-all">
      <button className="btn primary" disabled={busy || disabled} onClick={go}>
        {busy
          ? (step ?? 'Working…')
          : `Approve all ${count} certain match${count === 1 ? '' : 'es'}`}
      </button>
      <span className="muted small">
        Certain means the fund&apos;s ISIN is the scheme&apos;s ISIN in the official list.
      </span>
      {note && (
        <p role={note.ok ? 'status' : 'alert'} className={`small ${note.ok ? 'ok' : 'fail'}`}>
          {note.message}
        </p>
      )}
    </div>
  );
}

/** The funds with no price source, each with a suggestion to approve. */
export function FundsWithoutPrice({
  rows,
  actions,
  canMark,
  hrefs = {},
  disabled = false,
}: {
  rows: MatchRow[];
  actions: FundsWithoutPriceActions;
  canMark: boolean;
  /** the page of a fund; null leaves the name as plain text (a sample fund that has no page) */
  hrefs?: Record<string, string | null>;
  /** the public samples show the prompts but cannot save */
  disabled?: boolean;
}) {
  const certain = rows.filter((r) => r.certainty === 'certain').length;
  return (
    <section className="card" aria-labelledby="noprice" data-testid="funds-without-price">
      <div className="cardhead">
        <h2 id="noprice">Funds without a price ({rows.length})</h2>
        <span className="small muted">
          Until matched, a fund&apos;s value is only what you last recorded
        </span>
      </div>
      {certain >= 1 && <ApproveAll count={certain} actions={actions} disabled={disabled} />}
      <ul className="np-list">
        {rows.map((r) => (
          <li key={r.assetId} className={`np-fund${r.sipStopped ? ' dim' : ''}`}>
            <div className="np-head">
              {(r.assetId in hrefs ? hrefs[r.assetId] : `/asset/${r.assetId}`) ? (
                <Link href={(r.assetId in hrefs ? hrefs[r.assetId] : `/asset/${r.assetId}`)!}>
                  <strong>{r.name}</strong>
                </Link>
              ) : (
                <strong>{r.name}</strong>
              )}
              <FundFacts r={r} />
            </div>
            {r.proposal ? (
              <Prompt r={r} actions={actions} canMark={canMark} disabled={disabled} />
            ) : (
              <p className="small muted">Waiting for the official scheme list.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
