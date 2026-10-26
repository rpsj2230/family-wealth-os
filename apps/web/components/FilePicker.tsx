'use client';

import { useEffect, useRef } from 'react';

const size = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

/**
 * A file box for an import form. When the file was already chosen on the Import front page it is carried into this form
 * (shown as a line with its name) instead of asking for it a second time.
 */
export function FilePicker({
  label,
  accept,
  file,
  name = 'file',
}: {
  label: string;
  accept: string;
  /** a file chosen earlier; it is submitted with the form */
  file?: File | null | undefined;
  name?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // runs after every render on purpose: a form that has just been submitted is reset by the browser, which empties the file,
  // and the same file must still be there for the next step (preview, then import)
  useEffect(() => {
    if (!file || !ref.current || (ref.current.files?.length ?? 0) > 0) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    ref.current.files = dt.files;
  });
  if (file)
    return (
      <div className="filechip">
        <span className="filechip-name">{file.name}</span>
        <span className="muted small">{size(file.size)}</span>
        <input ref={ref} name={name} type="file" accept={accept} hidden />
      </div>
    );
  return (
    <label>
      {label}
      <input name={name} type="file" accept={accept} required />
    </label>
  );
}
