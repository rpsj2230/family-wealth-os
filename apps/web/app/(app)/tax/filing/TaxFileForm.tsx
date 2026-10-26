'use client';

import { useActionState } from 'react';
import { FilePicker } from '@/components/FilePicker';
import { uploadTaxFile, type TaxFileState } from './actions';

export function TaxFileForm({
  owners,
  fy,
  file,
  defaultOwner,
}: {
  owners: { id: string; name: string }[];
  fy: string;
  /** a file already chosen on the Import front page */
  file?: File | null;
  defaultOwner?: string;
}) {
  const [res, act, pending] = useActionState<TaxFileState | null, FormData>(uploadTaxFile, null);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <FilePicker
        label="Form 26AS or Annual Information Statement (PDF, text file, saved web page or JSON)"
        accept=".pdf,.txt,.htm,.html,.json,.csv"
        file={file}
      />
      <div className="formgrid g3">
        <label>
          Whose statement
          <select name="owner" required defaultValue={defaultOwner || undefined}>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Financial year (only if the file does not say)
          <input name="fy" defaultValue={fy} placeholder="2025-26" />
        </label>
        <label>
          PAN, to open an AIS PDF (used once, never saved)
          <input name="pan" autoComplete="off" placeholder="ABCDE1234F" />
        </label>
      </div>
      <p className="muted small">
        A protected PDF is opened with the date of birth saved in Settings (Form 26AS) or your PAN
        and date of birth (AIS) automatically. Download Form 26AS from TRACES as PDF, text or HTML,
        and the AIS from the income-tax e-filing portal.
      </p>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={pending}>
          {pending ? 'Reading…' : 'Read this file'}
        </button>
        {res && (
          <span className={res.ok ? 'ok small' : 'fail small'} role={res.ok ? 'status' : 'alert'}>
            {res.message}
          </span>
        )}
      </div>
      {res?.warnings && res.warnings.length > 0 && (
        <ul className="list small">
          {res.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
