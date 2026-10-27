'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { confirmMatured } from '@/app/(app)/accounts/actions';
import { CONFIRMED_NOTICE } from '@/lib/matured-list';
import { showNotice } from '@/lib/notice';

/**
 * "Confirm matured" on a deposit whose date has passed within the window. It sets the status to matured through the same database
 * function as the edit panel (which checks the person is a member), the row leaves the list, and a notice says so. In the public
 * sample nothing is sent: the row just goes, as it would, and the notice says nothing was saved.
 */
export function ConfirmMatured({
  assetId,
  name,
  sample = false,
}: {
  assetId: string;
  name: string;
  sample?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function hideRow(el: HTMLElement | null) {
    // a table row, or a list item on the Maturities tab; `hidden` alone loses to a display rule, so the style is set too
    const row = el?.closest<HTMLElement>('tr, li');
    if (row) {
      row.hidden = true;
      row.style.display = 'none';
    }
  }

  return (
    <span className="confirmmat">
      <button
        type="button"
        className="btn compact confirmbtn"
        disabled={pending}
        aria-label={`Confirm ${name} has matured`}
        title="The money has been paid out. This hides the deposit from the list."
        onClick={(ev) => {
          const el = ev.currentTarget;
          setError(null);
          if (sample) {
            hideRow(el);
            showNotice(`${CONFIRMED_NOTICE} (This is a sample: nothing was saved.)`);
            return;
          }
          start(async () => {
            const r = await confirmMatured(assetId);
            if (!r.ok) {
              setError(r.message);
              return;
            }
            hideRow(el);
            showNotice(CONFIRMED_NOTICE);
            router.refresh();
          });
        }}
      >
        {pending ? 'Saving…' : 'Confirm matured'}
      </button>
      {error && (
        <span className="small fail" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
