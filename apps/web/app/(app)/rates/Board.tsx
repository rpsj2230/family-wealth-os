import Link from 'next/link';
import {
  BOARD_SORTS,
  rateAgoText,
  formatInr,
  moveText,
  niceDay,
  ratePct,
  tenureText,
  type BankCard,
  type BoardSort,
  type BoardView,
  type SlabStep,
} from '@fwos/core';
import { BankBadge } from '@/components/BankBadge';
import { slugify } from '@/lib/slug';
import './rates.css';

/** Savings slabs drawn as steps: the higher the bar, the higher the rate. Every step is also written out for a screen reader. */
export function SlabLadder({ steps }: { steps: SlabStep[] }) {
  if (steps.length === 0) return <p className="muted small">No savings rate on file yet.</p>;
  return (
    <div
      className="rt-ladder"
      role="img"
      aria-label={`Savings rate by balance: ${steps.map((s) => `${s.label} ${ratePct(s.rate)}`).join(', ')}`}
    >
      {steps.map((s) => (
        <div
          key={s.label + s.rate}
          className={`rt-step ${s.best ? 'best' : ''}`}
          aria-hidden="true"
        >
          <span className="r">{ratePct(s.rate)}</span>
          <span className="barwrap">
            <span className="bar" style={{ height: `${s.heightPct}%` }} />
          </span>
          <span className="l" title={s.label}>
            {s.short}
          </span>
        </div>
      ))}
    </div>
  );
}

/** View (banks I use or all) and sort, as links so the choice is in the address. */
export function BoardToolbar({
  base,
  view,
  sort,
  extra = '',
}: {
  base: string;
  view: BoardView;
  sort: BoardSort;
  /** anything else the address must keep, such as "&tab=banks" */
  extra?: string;
}) {
  const href = (v: BoardView, s: BoardSort) => `${base}?view=${v}&sort=${s}${extra}`;
  return (
    <nav className="rt-toolbar" aria-label="Show and sort banks">
      <div className="rt-group">
        <span className="rt-label">Show</span>
        <Link className={`fchip ${view === 'held' ? 'on' : ''}`} href={href('held', sort)}>
          Banks I use
        </Link>
        <Link className={`fchip ${view === 'all' ? 'on' : ''}`} href={href('all', sort)}>
          All banks on file
        </Link>
      </div>
      <div className="rt-group">
        <span className="rt-label">Sort</span>
        {BOARD_SORTS.map((o) => (
          <Link
            key={o.key}
            className={`fchip ${sort === o.key ? 'on' : ''}`}
            href={href(view, o.key)}
          >
            {o.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function CheckedPill({ card, staleDays }: { card: BankCard; staleDays: number }) {
  if (card.ageDays === null) return <span className="pill warn">no rate checked yet</span>;
  return (
    <span
      className={`pill ${card.stale ? 'warn' : 'ok'}`}
      title={`Newest check ${card.checkedOn ? niceDay(card.checkedOn) : ''}. Older than ${staleDays} days counts as stale.`}
    >
      {card.stale ? 'stale: ' : 'checked '}
      {rateAgoText(card.ageDays)}
    </span>
  );
}

/** One bank: its best rates, the savings steps, how it moved, where its rates came from, and anything that needs a look. */
export function BankCardView({
  card,
  staleDays,
  base,
}: {
  card: BankCard;
  staleDays: number;
  /** where the per-bank page lives: /rates or /demo/rates */
  base: string;
}) {
  const move = moveText(card.lastMove);
  const attn = card.differs > 0 || card.misread > 0 || card.source.health === 'bad';
  const href = `${base}/${slugify(card.bank)}`;
  const s = card.source;
  return (
    <article
      className={`rt-card ${attn ? 'attn' : ''}`}
      aria-labelledby={`b-${slugify(card.bank)}`}
    >
      <div className="rt-head">
        <BankBadge name={card.bank} size={34} />
        <h2 id={`b-${slugify(card.bank)}`}>
          <Link href={href}>{card.bank}</Link>
        </h2>
        {card.held > 0 && (
          <div className="rt-held">
            You hold
            <b>{formatInr(Math.round(card.held))}</b>
          </div>
        )}
      </div>

      <div className="rt-figs">
        <div className={`rt-fig ${card.bestSaving ? '' : 'empty-fig'}`}>
          <div className="k">Savings, best</div>
          <div className="v">{card.bestSaving ? ratePct(card.bestSaving.rate) : '–'}</div>
          <div className="s">
            {card.bestSaving
              ? `${card.savingsCount} balance step${card.savingsCount === 1 ? '' : 's'}`
              : 'not on file'}
          </div>
        </div>
        <div className={`rt-fig ${card.bestFd ? '' : 'empty-fig'}`}>
          <div className="k">NRE deposit, best</div>
          <div className="v">{card.bestFd ? ratePct(card.bestFd.rate) : '–'}</div>
          <div className="s">{card.bestFd ? tenureText(card.bestFd) : 'not on file'}</div>
        </div>
      </div>

      {card.ladder.length > 0 && (
        <div>
          <p className="rt-subhead">Savings rate by balance</p>
          <SlabLadder steps={card.ladder} />
        </div>
      )}

      <div className="rt-facts">
        <CheckedPill card={card} staleDays={staleDays} />
        {move ? (
          <span className={`rt-move ${move.dir}`}>
            <span aria-hidden="true">
              {move.dir === 'up' ? '▲' : move.dir === 'down' ? '▼' : '•'}
            </span>{' '}
            Last move: {move.what ? `${move.what}, ` : ''}
            {move.text}
          </span>
        ) : (
          <span className="muted">No change logged yet</span>
        )}
      </div>

      <div className="rt-from">
        <p className="rt-subhead" style={{ margin: 0 }}>
          Where from
        </p>
        {card.origins.length === 0 && (
          <span className="muted">No rates on file for this bank.</span>
        )}
        {card.origins.map((o) => (
          <div key={`${o.kind}${o.note}${o.url}`} className="rt-line">
            <span className={`srcchip ${o.kind === 'ai' ? 'auto' : 'manual'}`}>
              {o.kind === 'ai' ? 'Bank page' : 'You'}
            </span>
            {o.url ? (
              <a href={o.url} target="_blank" rel="noreferrer">
                {o.note}
              </a>
            ) : (
              <span>{o.note}</span>
            )}
            <span className="muted">
              · {niceDay(o.on)} · {o.count} rate{o.count === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>

      {(card.differs > 0 || card.misread > 0) && (
        <div className="rt-note warn" role="status">
          {card.differs > 0 && (
            <p>
              The bank page says something different on {card.differs} rate
              {card.differs === 1 ? '' : 's'} you typed. <Link href={href}>Review them</Link>.
            </p>
          )}
          {card.misread > 0 && (
            <p>
              The refresh read {card.misread} rate{card.misread === 1 ? '' : 's'} wrongly again
              after your correction; a rule was saved for next time.
            </p>
          )}
        </div>
      )}

      {(s.health === 'bad' ||
        (s.health === 'warn' && card.differs === 0 && card.misread === 0)) && (
        <div className={`rt-note ${s.health === 'bad' ? 'bad' : 'warn'}`} role="status">
          <p>
            <b>Monthly refresh:</b> {s.headline}
          </p>
          {s.fix && (
            <p>
              {s.fix.text}{' '}
              {s.fix.href && <Link href={s.fix.href}>{s.fix.hrefLabel ?? 'Open'}</Link>}
            </p>
          )}
        </div>
      )}
      {s.health === 'idle' && s.url === null && (
        <p className="muted small" style={{ margin: 0 }}>
          No rate page listed, so nothing is read automatically.{' '}
          <Link href="/settings#rates">Add one</Link>
        </p>
      )}

      <div className="rt-foot">
        <Link className="btn compact" href={href}>
          View and edit rates
        </Link>
        {s.health === 'ok' && (
          <span className="small muted">Page read {s.ranOn ? niceDay(s.ranOn) : ''}</span>
        )}
      </div>
    </article>
  );
}

export function RateBoard({
  cards,
  staleDays,
  base,
}: {
  cards: BankCard[];
  staleDays: number;
  base: string;
}) {
  if (cards.length === 0)
    return (
      <p className="empty">
        No rates on file for these banks yet. Paste your notes under Add or import, or list each
        bank&apos;s rate page in <Link href="/settings#rates">Settings</Link> and the Monday refresh
        reads it.
      </p>
    );
  return (
    <div className="rt-grid">
      {cards.map((c) => (
        <BankCardView key={c.bank} card={c} staleDays={staleDays} base={base} />
      ))}
    </div>
  );
}
