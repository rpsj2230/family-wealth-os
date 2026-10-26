'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import './quickedit.css';

/** A side sheet: a modal dialog (focus stays inside, Escape asks first when there is something unsaved). */
export function Sheet({
  labelId,
  onRequestClose,
  onClose,
  children,
}: {
  labelId: string;
  onRequestClose: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="qe"
      aria-labelledby={labelId}
      onCancel={(e) => {
        e.preventDefault();
        onRequestClose();
      }}
      onClose={() => onClose()}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        // only a press that starts and ends on the dimmed area closes the sheet (not a text selection dragged out of a box)
        if (e.target === ref.current && downOnBackdrop.current) onRequestClose();
      }}
    >
      {children}
    </dialog>
  );
}
