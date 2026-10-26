'use client';

import { useState, useTransition } from 'react';
import { whatsappSummary } from './actions';

export function WhatsAppButton() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr('');
            const r = await whatsappSummary();
            if (!r.ok) return setErr('Could not prepare the summary.');
            window.open(`https://wa.me/?text=${encodeURIComponent(r.text)}`, '_blank', 'noopener');
          })
        }
      >
        {pending ? 'Preparing…' : 'Share today’s summary on WhatsApp'}
      </button>
      {err && <span className="fail small"> {err}</span>}
    </>
  );
}
