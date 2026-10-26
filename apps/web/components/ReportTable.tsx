'use client';

import { dayLabel, formatInr, tableToCsv, type Cell, type Col, type ReportTable } from '@fwos/core';
import { useState } from 'react';
import './reports.css';

const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;

function show(c: Col, v: Cell): string {
  if (v === null || v === undefined || v === '') return '–';
  switch (c.kind) {
    case 'money':
      return formatInr(Number(v));
    case 'int':
      return Number(v).toLocaleString('en-IN');
    case 'pct':
      return pct(Number(v), 1);
    case 'rate':
      return pct(Number(v));
    case 'date':
      return dayLabel(String(v));
    default:
      return String(v);
  }
}

const numeric = (c: Col) => c.kind !== 'text' && c.kind !== 'date';
const tone = (c: Col, v: Cell) =>
  (c.key === 'gain' || c.key === 'gainPct' || c.key === 'net' || c.key === 'xirr') &&
  typeof v === 'number'
    ? v < 0
      ? 'fail'
      : v > 0
        ? 'gain'
        : ''
    : '';

/** Downloads the table as a CSV file that opens in a spreadsheet. */
export function CsvButton({ table }: { table: ReportTable }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn compact"
      onClick={() => {
        const blob = new Blob(['﻿' + tableToCsv(table)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${table.id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? 'Downloaded' : 'Download CSV'}
    </button>
  );
}

/** A report as a sheet: columns aligned, figures in Indian grouping, the grand total in the last row. */
export function ReportSheet({ table }: { table: ReportTable }) {
  return (
    <div className="xlwrap rptwrap">
      <table className="tbl rpt" aria-label={table.title}>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c.key} className={numeric(c) ? 'num' : ''} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 ? (
            <tr>
              <td colSpan={table.columns.length} className="empty">
                Nothing to show yet.
              </td>
            </tr>
          ) : (
            table.rows.map((r, i) => (
              <tr key={i}>
                {table.columns.map((c) => (
                  <td
                    key={c.key}
                    className={`${numeric(c) ? 'num' : ''} ${tone(c, r[c.key] ?? null)}`}
                  >
                    {show(c, r[c.key] ?? null)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {table.total && table.rows.length > 0 && (
          <tfoot>
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  className={`${numeric(c) ? 'num' : ''} ${tone(c, table.total?.[c.key] ?? null)}`}
                  scope="row"
                >
                  {show(c, table.total?.[c.key] ?? null)}
                </th>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
