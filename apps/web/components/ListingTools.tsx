'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatInr } from '@fwos/core';
import { matchesFilter, matchesSearch, parseCell, sortKeyed, toCsv } from '@/lib/listing';

interface Col {
  key: string;
  label: string;
}
interface TableModel {
  el: HTMLTableElement;
  headers: string[];
  blocks: HTMLTableRowElement[][];
  separators: HTMLTableRowElement[];
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const headerText = (th: Element) => {
  const c = th.cloneNode(true) as HTMLElement;
  c.querySelectorAll('.sr-only, svg, button').forEach((n) => n.remove());
  return clean(c.textContent);
};
const cellText = (td: Element) => {
  const f = td.querySelector(
    'select, input:not([type=hidden]):not([type=checkbox]):not([type=radio])',
  ) as HTMLSelectElement | HTMLInputElement | null;
  if (f)
    return f instanceof HTMLSelectElement
      ? clean(f.selectedOptions[0]?.textContent)
      : clean(f.value);
  if (!td.querySelector('.editbtn')) return clean(td.textContent);
  // the "Edit" button is an action, not data: it is left out of sorting, filtering and the CSV
  const c = td.cloneNode(true) as HTMLElement;
  c.querySelectorAll('.editbtn').forEach((n) => n.remove());
  return clean(c.textContent);
};
const isDataRow = (tr: HTMLTableRowElement, cols: number) =>
  tr.cells.length >= Math.max(2, Math.min(cols, 3)) &&
  ![...tr.cells].some((c) => c.colSpan > 1) &&
  !/\b(secthead|sum|total|foot)\b/.test(tr.className);

function readTables(root: HTMLElement): TableModel[] {
  const out: TableModel[] = [];
  root.querySelectorAll<HTMLTableElement>('table').forEach((el) => {
    if (el.closest('[data-notools]') || el.hasAttribute('data-notools')) return;
    const heads = [...el.querySelectorAll('thead th')].map(headerText);
    if (heads.length < 2 || !el.tBodies[0]) return;
    const blocks: HTMLTableRowElement[][] = [[]];
    const separators: HTMLTableRowElement[] = [];
    for (const body of [...el.tBodies]) {
      for (const tr of [...body.rows]) {
        if (isDataRow(tr, heads.length)) blocks[blocks.length - 1]!.push(tr);
        else {
          separators.push(tr);
          blocks.push([]);
        }
      }
    }
    out.push({ el, headers: heads, blocks, separators });
  });
  return out;
}

/**
 * A footer row marked `data-totals` follows the rows that are showing (except rows marked `data-nosum`): a cell marked `data-sum` adds up its column, `data-wavg="n"`
 * averages it weighted by column n (counting from 0), and `data-count` counts the rows.
 */
function liveTotals(t: TableModel) {
  const foot = t.el.querySelector<HTMLTableRowElement>('tfoot tr[data-totals]');
  if (!foot) return;
  // a row marked `data-nosum` (a deposit past its date: not counted) is listed but stays out of the totals
  const rows = t.blocks.flat().filter((r) => !r.hidden && r.dataset.nosum === undefined);
  const num = (r: HTMLTableRowElement, i: number) => {
    const c = r.cells[i] ? parseCell(cellText(r.cells[i]!)) : null;
    return c && c.kind === 'num' ? c.n : null;
  };
  [...foot.cells].forEach((cell, i) => {
    const count = cell.dataset.count;
    if (count !== undefined) {
      const el = cell.querySelector<HTMLElement>('[data-count-n]');
      if (el) el.textContent = String(rows.length);
      return;
    }
    if (cell.dataset.sum !== undefined) {
      const v = rows.reduce((a, r) => a + (num(r, i) ?? 0), 0);
      cell.textContent = rows.length ? formatInr(Math.round(v)) : '–';
    } else if (cell.dataset.wavg !== undefined) {
      const w = Number(cell.dataset.wavg);
      let top = 0;
      let bottom = 0;
      for (const r of rows) {
        const v = num(r, i);
        const wt = num(r, w);
        if (v !== null && wt !== null) {
          top += v * wt;
          bottom += wt;
        }
      }
      cell.textContent = bottom > 0 ? `${(top / bottom).toFixed(2)}%` : '–';
    }
  });
}

/**
 * A grand total outside the tables, marked `data-grand`: its `data-gt="inv|mat|cur"` elements add up the lines that are showing
 * (rows carrying `data-inv`, `data-mat`, `data-cur`), so it follows the search and the column filters. `data-gt="n"` counts the lines.
 */
function grandTotals(el: HTMLElement) {
  const box = el.querySelector<HTMLElement>('[data-grand]');
  if (!box) return;
  const sum = { inv: 0, mat: 0, cur: 0 };
  let n = 0;
  el.querySelectorAll<HTMLTableRowElement>('tr[data-cur]').forEach((r) => {
    if (r.hidden || r.closest('[hidden]')) return;
    n += 1;
    sum.inv += Number(r.dataset.inv ?? 0);
    sum.mat += Number(r.dataset.mat ?? 0);
    sum.cur += Number(r.dataset.cur ?? 0);
  });
  box.querySelectorAll<HTMLElement>('[data-gt]').forEach((c) => {
    const k = c.dataset.gt as 'inv' | 'mat' | 'cur' | 'n';
    c.textContent = k === 'n' ? String(n) : n ? formatInr(Math.round(sum[k])) : '–';
  });
  const f = box.querySelector<HTMLElement>('[data-gt-filtered]');
  if (f) f.hidden = !isFiltering(el);
}

/** True when a search or column filter is narrowing the lists (the toolbar marks it). */
const isFiltering = (el: HTMLElement) => el.dataset.filtering === '1';

const titleOf = (el: Element) => {
  const s = el.closest('section, details, .card');
  const h = s?.querySelector('h1, h2, h3, summary');
  return clean(h?.textContent);
};

/**
 * Search, column filters, sort by any column and CSV export for every table inside it, with no change to how the tables are
 * produced. Hidden and reordered rows are only presentation: nothing is saved, and clearing the tools restores the page.
 * Tables marked `data-notools` (editable grids) are left alone. List items marked `data-item` with `data-f-<key>` values
 * are handled too, with the columns given in `listCols`.
 */
export function ListingTools({
  children,
  name,
  listCols,
}: {
  children: ReactNode;
  name: string;
  listCols?: Col[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [cols, setCols] = useState<Col[]>(listCols ?? []);
  const [count, setCount] = useState<{ shown: number; total: number }>({ shown: 0, total: 0 });
  const applying = useRef(false);
  const original = useRef(new WeakMap<HTMLElement, number>());

  const apply = useCallback(() => {
    const el = root.current;
    if (!el) return;
    applying.current = true;
    let shown = 0;
    let total = 0;
    const labels = new Map<string, Col>();
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== '');

    for (const t of readTables(el)) {
      t.headers.forEach((h) => h && labels.set(h, { key: h, label: h }));
      const idx = (label: string) => t.headers.indexOf(label);
      t.blocks.forEach((rows) =>
        rows.forEach((r, i) => {
          if (!original.current.has(r)) original.current.set(r, i);
        }),
      );
      const tableTitle = titleOf(t.el);
      for (const [bi, rows] of t.blocks.entries()) {
        // a row is found by its own text, its group heading (a person) and the table's heading (a bank)
        const context = `${tableTitle} ${clean(t.separators[bi - 1]?.textContent)}`;
        const matches = (r: HTMLTableRowElement) =>
          matchesSearch(
            `${context} ${clean(r.textContent)} ${[...r.querySelectorAll('select')]
              .map((x) => clean((x as HTMLSelectElement).selectedOptions[0]?.textContent))
              .join(' ')}`,
            q,
          ) &&
          active.every(([label, expr]) => {
            const i = idx(label);
            return i < 0 || !r.cells[i] || matchesFilter(cellText(r.cells[i]!), expr);
          });
        const base = [...rows].sort(
          (a, b) => (original.current.get(a) ?? 0) - (original.current.get(b) ?? 0),
        );
        const ci = sort ? idx(sort.col) : -1;
        const ordered =
          sort && ci >= 0
            ? sortKeyed(base, (r) => parseCell(r.cells[ci] ? cellText(r.cells[ci]!) : ''), sort.dir)
            : base;
        const parent = rows[0]?.parentElement;
        if (parent && rows.length > 0) {
          // put the rows back in their (sorted) order, in the same place among the group's other rows
          const after = rows[rows.length - 1]!.nextElementSibling;
          for (const r of ordered) parent.insertBefore(r, after);
        }
        for (const r of ordered) r.hidden = !matches(r);
        total += ordered.length;
        shown += ordered.filter((r) => !r.hidden).length;
      }
      // group headings and totals disappear with the rows they describe
      t.separators.forEach((sep) => {
        const next = t.blocks[t.separators.indexOf(sep) + 1] ?? [];
        sep.hidden =
          (q !== '' || active.length > 0) && next.length > 0 && next.every((r) => r.hidden);
      });
      liveTotals(t);
      const card = t.el.closest('section.card, .xlbank');
      if (card) {
        const visible = t.blocks.flat().some((r) => !r.hidden);
        (card as HTMLElement).hidden = (q !== '' || active.length > 0) && !visible;
      }
      // header cues
      t.el.querySelectorAll('thead th').forEach((th, i) => {
        const h = t.headers[i]!;
        const on = sort && sort.col === h;
        th.setAttribute('aria-sort', on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none');
        (th as HTMLElement).dataset.sortable = '1';
        th.setAttribute('tabindex', '0');
      });
    }

    el.dataset.filtering = q !== '' || active.length > 0 ? '1' : '0';
    grandTotals(el);

    // list items
    el.querySelectorAll<HTMLElement>('[data-item]').forEach((item) => {
      if (!original.current.has(item))
        original.current.set(item, [...(item.parentElement?.children ?? [])].indexOf(item));
    });
    const groups = new Map<HTMLElement, HTMLElement[]>();
    el.querySelectorAll<HTMLElement>('[data-item]').forEach((item) => {
      const p = item.parentElement!;
      groups.set(p, [...(groups.get(p) ?? []), item]);
    });
    for (const [parent, items] of groups) {
      const base = [...items].sort(
        (a, b) => (original.current.get(a) ?? 0) - (original.current.get(b) ?? 0),
      );
      const sorted = sort
        ? sortKeyed(
            base,
            (r) => parseCell(r.dataset[`f${sort.col[0]!.toUpperCase()}${sort.col.slice(1)}`] ?? ''),
            sort.dir,
          )
        : base;
      const after = items[items.length - 1]!.nextElementSibling;
      for (const r of sorted) parent.insertBefore(r, after);
      for (const r of sorted) {
        const ok =
          matchesSearch(clean(r.textContent), q) &&
          active.every(([key, expr]) =>
            matchesFilter(r.dataset[`f${key[0]!.toUpperCase()}${key.slice(1)}`] ?? '', expr),
          );
        r.hidden = !ok;
      }
      total += sorted.length;
      shown += sorted.filter((r) => !r.hidden).length;
      const card = parent.closest('section.card');
      if (card && (q !== '' || active.length > 0))
        (card as HTMLElement).hidden = sorted.every((r) => r.hidden);
      else if (card) (card as HTMLElement).hidden = false;
    }
    if (!listCols) {
      const next = [...labels.values()];
      setCols((prev) =>
        prev.length === next.length && prev.every((c, i) => c.key === next[i]!.key) ? prev : next,
      );
    }
    setCount((c) => (c.shown === shown && c.total === total ? c : { shown, total }));
    requestAnimationFrame(() => {
      applying.current = false;
    });
  }, [q, sort, filters, listCols]);

  useEffect(() => {
    apply();
  }, [apply]);

  // the page can re-render under us (a saved change, a refresh): apply again to what is new
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => {
      if (applying.current) return;
      clearTimeout(timer);
      timer = setTimeout(apply, 80);
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      clearTimeout(timer);
    };
  }, [apply]);

  // click or Enter on a column heading sorts by it
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const pick = (e: Event) => {
      const th = (e.target as HTMLElement).closest('thead th');
      if (
        !th ||
        !el.contains(th) ||
        (th.closest('table') as HTMLElement | null)?.closest('[data-notools]')
      )
        return;
      if ((e.target as HTMLElement).closest('a, button, input, select')) return;
      const label = headerText(th);
      if (!label) return;
      setSort((s) =>
        s && s.col === label
          ? s.dir === 1
            ? { col: label, dir: -1 }
            : null
          : { col: label, dir: 1 },
      );
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if ((e.target as HTMLElement).matches('th')) {
          e.preventDefault();
          pick(e);
        }
      }
    };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('click', pick);
      el.removeEventListener('keydown', key);
    };
  }, []);

  const exportCsv = () => {
    const el = root.current;
    if (!el) return;
    const tables = readTables(el);
    const rows: string[][] = [];
    const same =
      tables.length > 0 &&
      tables.every((t) => t.headers.join('|') === tables[0]!.headers.join('|'));
    if (tables.length > 0) {
      if (same) rows.push(['Section', ...tables[0]!.headers]);
      for (const t of tables) {
        const visible = t.blocks.flat().filter((r) => !r.hidden);
        if (visible.length === 0) continue;
        if (!same) {
          if (rows.length) rows.push([]);
          rows.push([titleOf(t.el)]);
          rows.push(t.headers);
        }
        // in page order, which is the order the person sees
        const ordered = [...t.el.querySelectorAll('tr')].filter((r) =>
          (visible as Element[]).includes(r),
        );
        for (const r of ordered)
          rows.push([
            ...(same ? [titleOf(t.el)] : []),
            ...[...(r as HTMLTableRowElement).cells].map(cellText),
          ]);
      }
    }
    const items = [...el.querySelectorAll<HTMLElement>('[data-item]')].filter((i) => !i.hidden);
    if (items.length > 0 && listCols) {
      if (rows.length) rows.push([]);
      rows.push(listCols.map((c) => c.label));
      for (const i of items)
        rows.push(
          listCols.map((c) => i.dataset[`f${c.key[0]!.toUpperCase()}${c.key.slice(1)}`] ?? ''),
        );
    }
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const activeFilters = Object.values(filters).filter((v) => v.trim() !== '').length;
  return (
    <div ref={root} className="listing">
      <div
        className="listtools noprint"
        role="search"
        aria-label="Search, filter, sort and export this list"
      >
        <input
          type="search"
          className="lt-search"
          placeholder="Search…"
          aria-label="Search this list"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="lt-sort">
          <span className="sr-only">Sort by</span>
          <select
            aria-label="Sort by"
            value={sort?.col ?? ''}
            onChange={(e) =>
              setSort(e.target.value ? { col: e.target.value, dir: sort?.dir ?? 1 } : null)
            }
          >
            <option value="">Sort: page order</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn compact"
          onClick={() => sort && setSort({ ...sort, dir: sort.dir === 1 ? -1 : 1 })}
          disabled={!sort}
          aria-label={
            sort
              ? `Sorted ${sort.dir === 1 ? 'ascending' : 'descending'}; switch direction`
              : 'Choose a column to sort'
          }
        >
          {sort ? (sort.dir === 1 ? '↑ Low to high' : '↓ High to low') : '↕'}
        </button>
        <button
          type="button"
          className="btn compact"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((s) => !s)}
        >
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <button
          type="button"
          className="btn compact"
          onClick={exportCsv}
          disabled={count.shown === 0}
        >
          Export CSV
        </button>
        <span className="small muted" aria-live="polite">
          {count.shown === count.total
            ? `${count.total} rows`
            : `${count.shown} of ${count.total} rows`}
        </span>
        {(q || sort || activeFilters > 0) && (
          <button
            type="button"
            className="btn compact ghost"
            onClick={() => {
              setQ('');
              setSort(null);
              setFilters({});
            }}
          >
            Clear
          </button>
        )}
      </div>
      {showFilters && (
        <div className="listfilters noprint" role="group" aria-label="Column filters">
          {cols.map((c) => (
            <label key={c.key}>
              {c.label}
              <input
                value={filters[c.key] ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                placeholder="text, >100000, 10..20"
                aria-label={`Filter ${c.label}`}
              />
            </label>
          ))}
          <p className="small muted">
            Text matches part of the cell; use &gt;, &lt;, = or a range such as 10..20 for numbers
            and dates; start with ! to exclude.
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
