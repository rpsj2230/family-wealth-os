'use client';

import type { ReactNode } from 'react';

/** A submit button that asks "are you sure?" first. Use it for removing something that cannot be brought back. */
export function ConfirmButton({
  message,
  children,
  className = 'btn compact ghost',
  label,
}: {
  message: string;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <button
      className={className}
      aria-label={label}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
