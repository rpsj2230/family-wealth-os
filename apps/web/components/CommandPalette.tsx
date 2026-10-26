'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GROUPS } from './AppNav';

interface Hit {
  label: string;
  hint: string;
  href: string;
}

/** Pages that are not in the menu but are things people look for. */
const EXTRA: Hit[] = [
  { label: 'Update fund units and prices', hint: 'Investments', href: '/investments?tab=update' },
  { label: 'Match funds to official schemes', hint: 'Investments', href: '/investments?tab=match' },
  { label: 'Edit many accounts at once', hint: 'Accounts', href: '/accounts/edit' },
  { label: 'Change the order of banks', hint: 'Accounts', href: '/accounts/reorder' },
  { label: 'Move bank-level notes up to the bank', hint: 'Accounts', href: '/accounts/tidy-notes' },
  { label: 'Tax harvest: gains, losses and refunds', hint: 'Tax', href: '/tax' },
  { label: 'AI key, Gmail label, bank rate pages', hint: 'Settings', href: '/settings#email' },
  { label: 'Telegram daily summary', hint: 'Settings', href: '/settings#telegram' },
  { label: 'Tax rules per year', hint: 'Settings', href: '/settings#tax' },
  { label: 'People, dates of birth and PAN', hint: 'Settings', href: '/settings' },
];

const score = (hay: string, tokens: string[]) => {
  const h = hay.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    const i = h.indexOf(t);
    if (i < 0) return -1;
    s += i === 0 ? 3 : h[i - 1] === ' ' ? 2 : 1;
  }
  return s;
};

/** Quick find: press Ctrl or Cmd + K (or "/") anywhere to jump to a page, bank, account, fund, goal or task. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [dyn, setDyn] = useState<Hit[] | null>(null);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const pages = useMemo<Hit[]>(
    () => [
      ...GROUPS.flatMap((g) =>
        g.items.map((i) => ({ label: i.label, hint: g.title, href: i.href })),
      ),
      ...EXTRA,
    ],
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        /input|textarea|select/i.test((e.target as HTMLElement | null)?.tagName ?? '') ||
        (e.target as HTMLElement | null)?.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setAt(0);
    setTimeout(() => input.current?.focus(), 0);
    if (dyn === null)
      fetch('/api/search')
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: Hit[] }) => setDyn(d.items))
        .catch(() => setDyn([]));
  }, [open, dyn]);

  const results = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = [...pages, ...(dyn ?? [])];
    if (tokens.length === 0) return pages.slice(0, 9);
    return all
      .map((h) => ({ h, s: score(`${h.label} ${h.hint}`, tokens) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.h);
  }, [q, pages, dyn]);

  const go = useCallback(
    (h: Hit | undefined) => {
      if (!h) return;
      setOpen(false);
      router.push(h.href);
    },
    [router],
  );

  return (
    <>
      <button
        type="button"
        className="searchbtn"
        onClick={() => setOpen(true)}
        aria-label="Find a page, account or fund (Ctrl K)"
      >
        <Search aria-hidden size={16} />
        <span className="searchbtn-text">Find…</span>
        <kbd className="searchbtn-key">Ctrl K</kbd>
      </button>
      {open && (
        <div className="palette-back" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Find"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setAt(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setAt((a) => Math.min(results.length - 1, a + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setAt((a) => Math.max(0, a - 1));
                } else if (e.key === 'Enter') go(results[at]);
              }}
              placeholder="Find a page, bank, account, fund, goal or task"
              aria-label="Find"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
            />
            <ul id="palette-list" role="listbox">
              {results.length === 0 && (
                <li className="palette-empty">
                  Nothing matches. Try a bank name, a fund name or a page.
                </li>
              )}
              {results.map((h, i) => (
                <li key={`${h.href}${h.label}`} role="option" aria-selected={i === at}>
                  <button
                    type="button"
                    className={i === at ? 'on' : ''}
                    onMouseEnter={() => setAt(i)}
                    onClick={() => go(h)}
                  >
                    <span>{h.label}</span>
                    <span className="muted small">{h.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
            {dyn === null && <p className="muted small palette-foot">Loading your accounts…</p>}
          </div>
        </div>
      )}
    </>
  );
}
