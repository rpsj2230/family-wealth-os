'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { tablesToXlsx, type ReportTable } from '@fwos/core';

/** Downloads every table of the report as one Excel workbook, a sheet each, with the period and filters under each title. */
export function XlsxButton({
  tables,
  lines,
  fileName,
}: {
  tables: ReportTable[];
  lines: string[];
  fileName: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn compact"
      data-testid="centre-xlsx"
      onClick={() => {
        const bytes = tablesToXlsx(tables, lines);
        const blob = new Blob([bytes as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? 'Downloaded' : 'Download Excel'}
    </button>
  );
}

/** Opens the browser's print dialog: the report prints on its own (menus and controls hidden), and "Save as PDF" makes a PDF. */
export function PrintButton() {
  return (
    <button type="button" className="btn compact" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}

const KEY = 'fwos.reports.recent';
type Recent = { href: string; title: string; at: string };
const read = (): Recent[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter(
          (r): r is Recent =>
            !!r &&
            typeof r.href === 'string' &&
            r.href.startsWith('/') &&
            typeof r.title === 'string',
        )
      : [];
  } catch {
    return [];
  }
};

/**
 * The last reports opened on this device, newest first: kept in this browser only (nothing is sent anywhere), so each person sees
 * their own. The current report is added when the page opens.
 */
export function RecentReports({ href, title }: { href: string; title: string }) {
  const [list, setList] = useState<Recent[]>([]);
  useEffect(() => {
    const next = [
      { href, title, at: new Date().toISOString() },
      ...read().filter((r) => r.href !== href),
    ].slice(0, 8);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // private browsing: the list simply stays empty
    }
    setList(next.filter((r) => r.href !== href));
  }, [href, title]);
  if (list.length === 0) return <p className="muted small">Reports you open appear here.</p>;
  return (
    <ul className="list small" data-testid="centre-recent">
      {list.map((r) => (
        <li key={r.href} className="listlink">
          <Link href={r.href}>{r.title}</Link>
        </li>
      ))}
    </ul>
  );
}
