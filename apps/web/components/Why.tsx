'use client';

import Link from 'next/link';
import { CircleHelp, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BASIS_HELP,
  BASIS_WORD,
  LEVEL_WORD,
  exCount,
  exRange,
  type Explain,
  type ExplainBasis,
  type ExplainLevel,
} from '@fwos/core';
import './why.css';

/** At or below this width the explainer is a sheet from the bottom of the screen instead of a card beside the figure. */
const SHEET_MAX = 640;
const GAP = 8;
const MARGIN = 12;
const WIDTH = 420;

const BASIS_GLYPH: Record<ExplainBasis, string> = {
  statement: '✓',
  recorded: '✎',
  calculated: '=',
  estimated: '~',
  missing: '✗',
};
const LEVEL_GLYPH: Record<ExplainLevel, string> = {
  complete: '✓',
  partly_estimated: '~',
  estimated: '~',
  missing: '✗',
};

/** The basis as a chip: the word and a mark as well as the colour, so it never depends on colour alone. */
export function BasisChip({ basis }: { basis: ExplainBasis }) {
  return (
    <span className={`why-chip ${basis}`} title={BASIS_HELP[basis]}>
      <span aria-hidden="true">{BASIS_GLYPH[basis]}</span> {BASIS_WORD[basis]}
    </span>
  );
}

/** The body of an explainer: what, how, the inputs with their basis and dates, how complete, notes and where to fix it. */
export function WhyBody({
  e,
  titleId,
  onNavigate,
}: {
  e: Explain;
  titleId: string;
  onNavigate?: () => void;
}): ReactNode {
  return (
    <>
      <h2 id={titleId} className="why-title">
        {e.title}
      </h2>
      {(e.exact || e.shown) && (
        <p className="why-exact" data-testid="why-exact">
          {e.exact && (
            <>
              Exact: <b>{e.exact}</b>
            </>
          )}
          {e.shown && e.shown !== e.exact && <span className="muted"> · shown as {e.shown}</span>}
        </p>
      )}
      <p className="why-what">{e.what}</p>

      <h3 className="why-h">How it is worked out</h3>
      <p className="why-how">{e.how}</p>

      {e.inputs.length > 0 && (
        <>
          <h3 className="why-h">Where it comes from</h3>
          <ul className="why-inputs">
            {e.inputs.map((x, k) => {
              const span = x.from || x.to ? exRange(x.from, x.to) : null;
              return (
                <li key={`${x.label}-${k}`}>
                  <div className="why-in-top">
                    <span className="why-in-label">{x.label}</span>
                    <BasisChip basis={x.basis} />
                  </div>
                  <div className="why-in-val">
                    <b>{x.value}</b>
                    {x.count && <span> · {exCount(x.count)}</span>}
                    {span && <span> · {span}</span>}
                  </div>
                  {x.note && <div className="why-in-note">{x.note}</div>}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h3 className="why-h">How complete is it?</h3>
      <p className={`why-level ${e.completeness.level}`}>
        <b>
          <span aria-hidden="true">{LEVEL_GLYPH[e.completeness.level]}</span>{' '}
          {LEVEL_WORD[e.completeness.level]}
        </b>
        <span> {e.completeness.text}</span>
      </p>

      {e.notes.length > 0 && (
        <ul className="why-notes">
          {e.notes.map((n, k) => (
            <li key={k}>{n}</li>
          ))}
        </ul>
      )}

      {(e.fix || (e.also && e.also.length > 0)) && (
        <p className="why-links">
          {e.fix && (
            <Link href={e.fix.href} className="btn compact primary" onClick={() => onNavigate?.()}>
              {e.fix.label}
            </Link>
          )}
          {(e.also ?? []).map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="btn compact"
              onClick={() => onNavigate?.()}
            >
              {a.label}
            </Link>
          ))}
        </p>
      )}
    </>
  );
}

interface Place {
  style: CSSProperties;
}

/**
 * The "?" next to a figure. A small round button; press it (mouse, touch, Enter or Space) to open a card that says what the figure
 * is, how it was worked out with the actual numbers, which data it rests on and from which date to which date, and whether that
 * data is complete, estimated or missing. Escape, a press outside, or the close button shuts it and focus returns to the button.
 * On a phone it is a sheet from the bottom. It is drawn in a portal on the page's body, so a parent with overflow hidden (the dark
 * hero, a scrolling table) can never clip it, and it never widens the page.
 */
export function Why({
  explain,
  className = '',
  tone,
}: {
  explain: Explain;
  className?: string;
  /** on-dark: the button sits on a dark panel and uses the panel's light text colour */
  tone?: 'on-dark';
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [sheet, setSheet] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const panelId = `${uid}-panel`;

  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) btn.current?.focus();
  }, []);

  const measure = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (vw <= SHEET_MAX) {
      setSheet(true);
      setPlace(null);
      return;
    }
    setSheet(false);
    const r = b.getBoundingClientRect();
    const width = Math.min(WIDTH, vw - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(r.left + r.width / 2 - width / 2, vw - width - MARGIN));
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const placeBelow = below >= 280 || below >= above;
    setPlace({
      style: placeBelow
        ? { left, width, top: r.bottom + GAP, maxHeight: Math.max(160, below) }
        : { left, width, bottom: vh - r.top + GAP, maxHeight: Math.max(160, above) },
    });
  }, []);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  // when open: follow the figure on scroll and resize, close on Escape or a press outside, keep Tab inside
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close(true);
      } else if (ev.key === 'Tab' && panel.current) {
        const items = [
          ...panel.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ];
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (ev.shiftKey && (active === first || active === panel.current)) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && active === last) {
          ev.preventDefault();
          first.focus();
        } else if (!panel.current.contains(active)) {
          ev.preventDefault();
          first.focus();
        }
      }
    };
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      // a press on something that takes focus keeps that focus; on empty space the focus returns to the "?"
      const focusable = (t as Element).closest?.('a, button, input, select, textarea, [tabindex]');
      close(!focusable);
    };
    const onMove = (ev: Event) => {
      // scrolling inside the card itself must not move it
      if (ev.target instanceof Node && panel.current?.contains(ev.target)) return;
      measure();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, measure]);

  // move focus into the card once, when it first has a place, so a keyboard or screen-reader user lands in it
  const focused = useRef(false);
  useEffect(() => {
    if (!open) {
      focused.current = false;
      return;
    }
    if (!focused.current && (sheet || place)) {
      focused.current = true;
      panel.current?.focus({ preventScroll: true });
    }
  }, [open, place, sheet]);

  const label = `How “${explain.title}” is worked out`;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`why-btn ${tone === 'on-dark' ? 'on-dark' : ''} ${open ? 'open' : ''} ${className}`.trim()}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-why={explain.id}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <CircleHelp aria-hidden="true" focusable="false" strokeWidth={2.2} />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            {sheet && <div className="why-backdrop" aria-hidden="true" />}
            <div
              ref={panel}
              id={panelId}
              role="dialog"
              aria-modal="false"
              aria-labelledby={titleId}
              tabIndex={-1}
              className={`why-panel ${sheet ? 'sheet' : ''}`}
              style={sheet ? undefined : (place?.style ?? { visibility: 'hidden' })}
              data-testid="why-panel"
            >
              <button
                type="button"
                className="why-close"
                aria-label="Close"
                onClick={() => close(true)}
              >
                <X aria-hidden="true" focusable="false" strokeWidth={2.2} />
              </button>
              <WhyBody e={explain} titleId={titleId} onNavigate={() => close(false)} />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/**
 * A card or section heading with its "?" beside it: pass the heading element (`<h2>`) as children. Keeps the title and the button on
 * one line without putting the button inside the heading, so the heading's own name stays clean for screen readers.
 */
export function WhyHead({
  why,
  children,
  tone,
}: {
  why: Explain;
  children: ReactNode;
  tone?: 'on-dark';
}) {
  return (
    <div className="why-line">
      {children}
      <Why explain={why} {...(tone ? { tone } : {})} />
    </div>
  );
}
