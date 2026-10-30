'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { Heart, MessageCircle, Phone, ShieldCheck, Smile, Users } from 'lucide-react';
import {
  bankStyle,
  CARD_NOTE,
  CLAIM_CHECKLISTS,
  claimKey,
  formatInr,
  handbookGaps,
  hbFmt,
  hbSay,
  hbT,
  type Guide,
  type GuideCard,
  type GuideContact,
  type HbKey,
  type HbText,
} from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import {
  cardGroups,
  carers,
  DEFAULT_PREFS,
  firstToCall,
  readPrefs,
  telHref,
  type ReadingPrefs,
  type TickState,
} from '@/lib/handbook-view';
import { PrintButton } from './PrintButton';
import '@/components/headline.css';
import './emergency.css';
import './guide.css';

const PREFS_KEY = 'fwos.handbook.reading';
const SAMPLE_TICKS_KEY = 'fwos.handbook.sampleTicks';

type Say = (t: HbText | HbKey) => string;
type Toggle = (key: string, done: boolean) => void;

function store(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private window or blocked storage: the choice lasts for this visit only */
  }
}
function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** One step or checklist line the family can tick; prints as ☐ or ☑. */
function Tick({
  id,
  text,
  state,
  onToggle,
  say,
}: {
  id: string;
  text: string;
  state: TickState | undefined;
  onToggle: Toggle;
  say: Say;
}) {
  const by = state
    ? say(hbT('ui.tickedBy', { who: say(`who.${state.who}` as HbKey), at: state.at }))
    : undefined;
  return (
    <li className={`hb-tick${state ? ' done' : ''}`}>
      <label title={by}>
        <input
          type="checkbox"
          checked={!!state}
          onChange={(e) => onToggle(id, e.target.checked)}
          data-key={id}
        />
        <span className="hb-pbox" aria-hidden>
          {state ? '☑' : '☐'}
        </span>
        <span className="hb-tick-text">
          {text}
          {by && <small className="hb-by">{by}</small>}
        </span>
      </label>
    </li>
  );
}

function Count({ keys, ticks, say }: { keys: string[]; ticks: Record<string, TickState>; say: Say }) {
  const done = keys.filter((k) => ticks[k]).length;
  return (
    <span className={`hb-count${done === keys.length && keys.length > 0 ? ' all' : ''}`}>
      {say(hbT('ui.done', { done, total: keys.length }))}
    </span>
  );
}

function People({ rows, label, say }: { rows: GuideContact[]; label: string; say: Say }) {
  return (
    <ul className="hb-people" aria-label={label}>
      {rows.map((c, i) => {
        const tel = telHref(c.phone);
        return (
          <li key={`${c.name}-${i}`}>
            <span className="hb-order" aria-hidden>
              {i + 1}
            </span>
            <div className="hb-who">
              <strong>{c.name}</strong>
              {c.relation && <span className="hb-rel">{c.relation}</span>}
              {c.note && <span className="hb-note">{c.note}</span>}
            </div>
            {tel ? (
              <a className="hb-phone" href={tel}>
                <Phone aria-hidden size={18} />
                {c.phone}
              </a>
            ) : (
              <span className="hb-phone plain">{c.phone || say('call.noNumber')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Card({
  card,
  ticks,
  onToggle,
  say,
}: {
  card: GuideCard;
  ticks: Record<string, TickState>;
  onToggle: Toggle;
  say: Say;
}) {
  const style = bankStyle(card.name);
  const list = CLAIM_CHECKLISTS[card.kind];
  const keys = list.map((x) => claimKey(card.id, x.id));
  const tel = card.helpline ? telHref(card.helpline) : null;
  return (
    <article
      className="hb-card"
      id={card.id}
      aria-labelledby={`${card.id}-h`}
      style={{ ['--bank' as string]: style.colour }}
      data-testid="hb-card"
    >
      <header className="hb-card-head">
        <span className="hb-badge" aria-hidden>
          {style.abbr}
        </span>
        <div>
          <h4 id={`${card.id}-h`}>{card.name}</h4>
          <p className="hb-card-sum">
            {card.total !== null
              ? say(hbT('card.total', { amount: card.total }))
              : say(hbT('card.policies', { count: card.holdings.length }))}
          </p>
        </div>
      </header>

      <h5>{say('card.held')}</h5>
      <ul className="hb-hold">
        {card.holdings.map((h, i) => (
          <li key={i}>
            <div className="hb-hold-top">
              {h.owner && <span className="hb-owner">{h.owner}</span>}
              <span className="hb-what">
                {typeof h.label === 'string' ? h.label : say(h.label)}
                {h.joint ? ` · ${say('h.joint')}` : ''}
              </span>
              {h.amount !== null && <span className="hb-amt num">{formatInr(h.amount)}</span>}
            </div>
            {h.detail && <div className="hb-detail">{say(h.detail)}</div>}
            {h.note && <div className="hb-detail">{h.note}</div>}
            <div className={`hb-nominee${h.nominee ? '' : ' missing'}`}>
              <span>{say('card.nominee')}:</span>{' '}
              {h.nominee ?? <em>{say('card.notRecorded')}</em>}
            </div>
          </li>
        ))}
      </ul>

      <div className="hb-help">
        <span className="hb-help-l">{say('card.helpline')}</span>
        {card.helpline ? (
          tel ? (
            <a className="hb-dial" href={tel} aria-label={`${say('card.helpline')}: ${card.name}`}>
              <Phone aria-hidden size={16} />
              {card.helpline}
            </a>
          ) : (
            <span>{card.helpline}</span>
          )
        ) : (
          <span className="hb-muted">
            {say(`card.helplineMissing.${card.kind}` as HbKey)}
          </span>
        )}
      </div>
      <p className="hb-cardnote">{say(CARD_NOTE[card.kind])}</p>

      <div className="hb-claim">
        <div className="hb-claim-h">
          <h5>{say('card.claim')}</h5>
          <Count keys={keys} ticks={ticks} say={say} />
        </div>
        <ul className="hb-ticks">
          {list.map((x, i) => (
            <Tick
              key={x.id}
              id={keys[i]!}
              text={say(x.k)}
              state={ticks[keys[i]!]}
              onToggle={onToggle}
              say={say}
            />
          ))}
        </ul>
      </div>
    </article>
  );
}

function KidsArt() {
  return (
    <svg className="hb-kids-art" viewBox="0 0 160 110" aria-hidden="true">
      <circle className="sun" cx="132" cy="24" r="13" />
      <path className="ground" d="M8 102 H152" />
      <rect className="wall" x="44" y="56" width="72" height="46" rx="6" />
      <path className="roof" d="M34 60 L80 24 L126 60" />
      <path
        className="heart"
        d="M80 92 C62 80 62 64 72 64 C76 64 79 67 80 70 C81 67 84 64 88 64 C98 64 98 80 80 92 Z"
      />
      <circle className="dot" cx="24" cy="92" r="6" />
      <circle className="dot" cx="140" cy="94" r="5" />
    </svg>
  );
}

function Other({
  title,
  rows,
  note,
  say,
}: {
  title: string;
  rows: { key: string; left: ReactNode; right: ReactNode; sub?: string | null }[];
  note?: string;
  say: Say;
}) {
  return (
    <div className="hb-other">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="hb-muted">{say('other.none')}</p>
      ) : (
        <ul className="hb-olist">
          {rows.map((r) => (
            <li key={r.key}>
              <span className="hb-ol">{r.left}</span>
              <span className="hb-or num">{r.right}</span>
              {r.sub && <span className="hb-os">{r.sub}</span>}
            </li>
          ))}
        </ul>
      )}
      {note && rows.length > 0 && <p className="hb-cardnote">{note}</p>}
    </div>
  );
}

/**
 * The family handbook as a calm guide: a dark "start here" card with whom to call first, a first-days timeline and one card per bank,
 * fund house and insurer with the papers a claim needs. Steps and papers can be ticked; the ticks are shared through `tick` (a server
 * action), or kept in this browser only when there is none (the public sample). Language, simple words and larger text are remembered
 * per browser. `member` adds the "what is still missing" meter, which the read-only family login never sees.
 */
export function HandbookGuide({
  guide,
  generatedAt,
  initialTicks,
  tick,
  refresh,
  member = false,
  accessNote,
}: {
  guide: Guide;
  generatedAt: string;
  initialTicks: Record<string, TickState>;
  /** saves a tick for everyone; without it ticks stay in this browser (the public sample) */
  tick?: ((key: string, done: boolean) => Promise<{ ok: boolean }>) | undefined;
  refresh?: (() => Promise<void>) | undefined;
  member?: boolean;
  accessNote?: string | undefined;
}) {
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS);
  const [ticks, setTicks] = useState<Record<string, TickState>>(initialTicks);
  const [failed, setFailed] = useState(false);
  const [, start] = useTransition();
  const sample = !tick;

  // remembered choices (and the sample's ticks) live in this browser only; read after the first paint so the server copy matches
  useEffect(() => {
    setPrefs(readPrefs(load(PREFS_KEY)));
    if (sample) {
      try {
        const saved = JSON.parse(load(SAMPLE_TICKS_KEY) ?? '{}') as Record<string, TickState>;
        if (saved && typeof saved === 'object') setTicks(saved);
      } catch {
        /* nothing remembered */
      }
    }
  }, [sample]);
  useEffect(() => setTicks((t) => (sample ? t : initialTicks)), [initialTicks, sample]);

  const choose = (patch: Partial<ReadingPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      store(PREFS_KEY, JSON.stringify(next));
      return next;
    });

  const say: Say = (t) => hbSay(t, prefs.lang, prefs.plain);
  const fmt = hbFmt(prefs.lang);

  const onToggle: Toggle = (key, done) => {
    setFailed(false);
    const before = ticks[key];
    const next = { ...ticks };
    if (done) next[key] = { who: 'you', at: new Date().toISOString() };
    else delete next[key];
    setTicks(next);
    if (sample) {
      store(SAMPLE_TICKS_KEY, JSON.stringify(next));
      return;
    }
    start(async () => {
      const r = await tick(key, done).catch(() => ({ ok: false }));
      if (!r.ok) {
        setFailed(true);
        setTicks((t) => {
          const back = { ...t };
          if (before) back[key] = before;
          else delete back[key];
          return back;
        });
      }
    });
  };

  const first = firstToCall(guide);
  const groups = cardGroups(guide.cards);
  const gaps = member ? handbookGaps(guide) : null;
  const kids = carers(guide);
  const where = guide.where;

  const nav: [string, HbKey][] = [
    ['call', 'sec.call'],
    ['timeline', 'sec.timeline'],
    ['where', 'sec.where'],
    ['cards', 'sec.cards'],
    ['other', 'sec.other'],
    ['people', 'sec.people'],
    ['children', 'sec.children'],
  ];

  return (
    <div
      className={`hb hb2${prefs.large ? ' hb-large' : ''}`}
      lang={prefs.lang === 'hi' ? 'hi' : 'en'}
      data-lang={prefs.lang}
    >
      <PageHead
        title={say(hbT('title', { household: guide.household }))}
        subtitle={say(hbT('updated', { at: generatedAt }))}
        actions={
          <div className="noprint row">
            {refresh && (
              <form action={refresh}>
                <button className="btn">{say('ui.refresh')}</button>
              </form>
            )}
            <PrintButton label={say('ui.print')} />
          </div>
        }
      />

      <div className="hb-tools noprint" role="group" aria-label={say('ui.reading')}>
        <div className="hb-seg" role="group" aria-label={say('ui.language')}>
          <button
            type="button"
            lang="en"
            aria-pressed={prefs.lang === 'en'}
            onClick={() => choose({ lang: 'en' })}
          >
            English
          </button>
          <button
            type="button"
            lang="hi"
            aria-pressed={prefs.lang === 'hi'}
            onClick={() => choose({ lang: 'hi' })}
          >
            हिन्दी
          </button>
        </div>
        <label className="hb-switch">
          <input
            type="checkbox"
            checked={prefs.plain}
            onChange={(e) => choose({ plain: e.target.checked })}
          />
          <span>{say('ui.simple')}</span>
        </label>
        <label className="hb-switch">
          <input
            type="checkbox"
            checked={prefs.large}
            onChange={(e) => choose({ large: e.target.checked })}
          />
          <span>{say('ui.larger')}</span>
        </label>
      </div>

      <section className="hl hb-start" id="start" aria-labelledby="hb-start-h">
        <h2 className="hl-h" id="hb-start-h">
          {say('start.kicker')}
        </h2>
        <p className="hb-msg">{guide.message || say('start.defaultMessage')}</p>
        {first ? (
          first.tel ? (
            <a className="hb-callbig" href={first.tel} data-testid="hb-call-first">
              <Phone aria-hidden size={24} />
              <span>
                <span className="hb-callbig-l">{say(hbT('start.call', { name: first.name }))}</span>
                <span className="hb-callbig-n num">{first.phone}</span>
              </span>
            </a>
          ) : (
            <p className="hb-callbig plain" data-testid="hb-call-first">
              {say(hbT('start.call', { name: first.name }))}
              {first.phone ? ` · ${first.phone}` : ''}
            </p>
          )
        ) : (
          <p className="hb-callbig plain">{say('start.noCall')}</p>
        )}
        <p className="hb-have" data-testid="hb-have">
          {say(
            hbT('start.have', {
              total: guide.totals.money,
              banks: guide.totals.banks,
              funds: guide.totals.funds,
              policies: guide.totals.policies,
            }),
          )}
        </p>
        <p className="hl-asof">{say('start.calm')}</p>
      </section>

      <p className="notice warn small hb-disclaimer">{say('disclaimer')}</p>

      {gaps && (
        <section className="card hb-meter noprint" aria-labelledby="hb-meter-h">
          <h2 id="hb-meter-h">{say(hbT('meter.title', { pct: gaps.percent }))}</h2>
          <div
            className="hb-bar"
            role="progressbar"
            aria-valuenow={gaps.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-labelledby="hb-meter-h"
          >
            <span style={{ width: `${gaps.percent}%` }} />
          </div>
          <p className="hb-muted small">{say('meter.intro')}</p>
          {gaps.open.length === 0 ? (
            <p>{say('meter.allDone')}</p>
          ) : (
            <ul className="hb-gaps">
              {gaps.open.map((g) => (
                <li key={g.id} data-gap={g.id}>
                  <span>{say(g.text)}</span>
                  <Link className="btn compact" href={g.href}>
                    {say('meter.fix')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {accessNote && <p className="hb-muted small">{accessNote}</p>}
        </section>
      )}

      <nav className="chipbar small noprint hb-nav" aria-label={say('ui.sections')}>
        {nav.map(([id, k]) => (
          <a key={id} className="fchip" href={`#${id}`}>
            {say(k)}
          </a>
        ))}
      </nav>

      <section className="card hb-sec2" id="call" aria-labelledby="hb-call-h">
        <h2 id="hb-call-h">{say('sec.call')}</h2>
        {guide.contacts.length === 0 ? (
          <p className="empty">{say('call.none')}</p>
        ) : (
          <People rows={guide.contacts} label={say('sec.call')} say={say} />
        )}
        {guide.advisers.length > 0 && (
          <>
            <h3>{say('sec.advisers')}</h3>
            <People rows={guide.advisers} label={say('sec.advisers')} say={say} />
          </>
        )}
      </section>

      <section className="hb-sec2" id="timeline" aria-labelledby="hb-tl-h">
        <h2 id="hb-tl-h">{say('sec.timeline')}</h2>
        <p className="hb-muted">{say('ui.tickShared')}</p>
        {sample && (
          <p className="hb-sample small noprint" role="note">
            {say('ui.sampleTicks')}
          </p>
        )}
        {failed && (
          <p className="notice warn small" role="alert">
            {say('ui.tickFailed')}
          </p>
        )}
        <ol className="hb-phases">
          {guide.timeline.map((ph, n) => {
            const keys = ph.steps.map((s) => s.id);
            return (
              <li key={ph.id} className="card hb-phase" aria-labelledby={`hb-ph-${ph.id}`}>
                <div className="hb-phase-h">
                  <span className="hb-phase-n" aria-hidden>
                    {n + 1}
                  </span>
                  <h3 id={`hb-ph-${ph.id}`}>{say(`phase.${ph.id}` as HbKey)}</h3>
                  <Count keys={keys} ticks={ticks} say={say} />
                </div>
                <ul className="hb-ticks">
                  {ph.steps.map((s) => (
                    <Tick
                      key={s.id}
                      id={s.id}
                      text={say(s.text)}
                      state={ticks[s.id]}
                      onToggle={onToggle}
                      say={say}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card hb-sec2 hb-where" id="where" aria-labelledby="hb-where-h">
        <h2 id="hb-where-h">{say('sec.where')}</h2>
        <dl className="hb-dl">
          {where.map((w) => (
            <div key={w.id} className={w.value ? '' : 'is-missing'}>
              <dt>{say(`where.${w.id}` as HbKey)}</dt>
              <dd>{w.value || say('where.missing')}</dd>
            </div>
          ))}
          {guide.instructions && (
            <div>
              <dt>{say('where.instructions')}</dt>
              <dd>{guide.instructions}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="hb-sec2" id="cards" aria-labelledby="hb-cards-h">
        <h2 id="hb-cards-h">{say('sec.cards')}</h2>
        <p className="hb-muted">{say('cards.intro')}</p>
        {groups.length === 0 && <p className="empty">{say('cards.none')}</p>}
        {groups.map((g) => (
          <div key={g.kind} className="hb-group">
            <h3>{say(`group.${g.kind}` as HbKey)}</h3>
            <div className="hb-cards">
              {g.cards.map((c) => (
                <Card key={c.id} card={c} ticks={ticks} onToggle={onToggle} say={say} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="card hb-sec2" id="other" aria-labelledby="hb-other-h">
        <h2 id="hb-other-h">{say('sec.other')}</h2>
        <Other
          title={say('other.property')}
          say={say}
          note={say('note.property')}
          rows={guide.property.map((x, i) => ({
            key: `p${i}`,
            left: `${x.label}${x.owner ? ` · ${x.owner}` : ''}`,
            right: x.amount === null ? '' : formatInr(x.amount),
            sub: x.note,
          }))}
        />
        {guide.heldByOthers.length > 0 && (
          <Other
            title={say('other.held')}
            say={say}
            note={say('note.held')}
            rows={guide.heldByOthers.map((x, i) => ({
              key: `h${i}`,
              left: `${x.label}${x.owner ? ` · ${x.owner}` : ''}`,
              right: x.amount === null ? '' : formatInr(x.amount),
              sub: x.note,
            }))}
          />
        )}
        <Other
          title={say('other.owed')}
          say={say}
          note={say('note.owed')}
          rows={guide.owed.map((x, i) => ({
            key: `o${i}`,
            left: x.counterparty,
            right: formatInr(x.outstanding),
            sub: say(hbT('other.expected', { on: x.expectedOn })),
          }))}
        />
        <div className="hb-other">
          <h3>{say('sec.moving')}</h3>
          <p>
            {say(
              hbT('moving.sips', { count: guide.moving.sipCount, amount: guide.moving.sipMonthly }),
            )}
          </p>
        </div>
        <Other
          title={say('moving.maturing')}
          say={say}
          note={say('note.maturing')}
          rows={guide.moving.maturing.map((m, i) => ({
            key: `m${i}`,
            left: `${fmt.date(m.on)} · ${m.bank}, ${m.code}${m.owner ? ` · ${m.owner}` : ''}`,
            right: formatInr(m.amount),
          }))}
        />
        {guide.moving.renewals.length > 0 && (
          <Other
            title={say('moving.renewals')}
            say={say}
            rows={guide.moving.renewals.map((r, i) => ({
              key: `r${i}`,
              left: r.insurer,
              right: fmt.date(r.on),
            }))}
          />
        )}
      </section>

      <section className="card hb-sec2" id="people" aria-labelledby="hb-people-h">
        <h2 id="hb-people-h">{say('sec.people')}</h2>
        <ul className="hb-plist">
          {guide.people.map((x) => (
            <li key={x.name}>
              <strong>{x.name}</strong>
              <span className="hb-muted">
                {[
                  x.age !== null ? say(hbT('people.age', { age: x.age })) : '',
                  x.isMinor ? say('people.child') : '',
                  x.guardian ? say(hbT('people.lookedAfter', { name: x.guardian })) : '',
                  x.panLast4 ? say(hbT('people.pan', { last4: x.panLast4 })) : '',
                  x.residency ? say(hbT('people.residency', { value: x.residency })) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        {guide.people.some((x) => x.isMinor) && (
          <p className="hb-cardnote">{say('note.minors')}</p>
        )}
      </section>

      <section className="card hb-sec2 hb-kids" id="children" aria-labelledby="hb-kids-h">
        <div className="hb-kids-top">
          <KidsArt />
          <div>
            <h2 id="hb-kids-h">{say('sec.children')}</h2>
            <p className="hb-kids-hello">{say('kids.hello')}</p>
          </div>
        </div>
        <p className="hb-kids-note">{say('kids.note')}</p>
        <ul className="hb-kids-list">
          <li>
            <Heart aria-hidden size={22} />
            <span>{say('kids.sad')}</span>
          </li>
          <li>
            <ShieldCheck aria-hidden size={22} />
            <span>{say('kids.money')}</span>
          </li>
          <li>
            <MessageCircle aria-hidden size={22} />
            <span>{say('kids.ask')}</span>
          </li>
          <li>
            <Smile aria-hidden size={22} />
            <span>{say('kids.notAlone')}</span>
          </li>
        </ul>
        <h3 className="hb-kids-care">
          <Users aria-hidden size={20} /> {say('kids.care')}
        </h3>
        {kids.length === 0 ? (
          <p>{say('kids.careNone')}</p>
        ) : (
          <ul className="hb-carers">
            {kids.map((c) => (
              <li key={c.name}>
                <span className="hb-carer-dot" aria-hidden>
                  {(c.name.trim()[0] ?? '?').toUpperCase()}
                </span>
                <span className="hb-who">
                  <strong>{c.name}</strong>
                  {c.relation && <span className="hb-rel">{c.relation}</span>}
                </span>
                {c.tel && (
                  <a className="hb-dial" href={c.tel} aria-label={say(hbT('ui.dial', { name: c.name }))}>
                    <Phone aria-hidden size={16} />
                    {c.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="notice warn small hb-disclaimer">{say('disclaimer')}</p>
    </div>
  );
}

