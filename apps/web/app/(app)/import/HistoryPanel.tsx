'use client';

import { useState } from 'react';
import { HistoryForm } from './HistoryForm';

/**
 * The "History from all monthly tabs" box of Import > Excel workbook: it asks for the workbook itself (the front door does
 * that for the other route) and, once one is chosen, hands it to the history form.
 */
export function HistoryPanel({ demo = false }: { demo?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="form">
      <label>
        Workbook (.xlsx)
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          data-testid="history-file"
        />
      </label>
      {file ? (
        <HistoryForm key={file.name + file.size + file.lastModified} file={file} demo={demo} />
      ) : (
        <p className="muted small">Choose the workbook to read every monthly tab.</p>
      )}
    </div>
  );
}
