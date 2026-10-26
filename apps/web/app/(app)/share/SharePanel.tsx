'use client';

import { useState } from 'react';

/** Today's summary as text: read it, copy it, or open WhatsApp with it ready to send. Nothing is sent from here. */
export function SharePanel({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }
  return (
    <>
      <pre className="sharetext" aria-label="Today’s summary">
        {text}
      </pre>
      <div className="row">
        <a
          className="btn primary"
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open WhatsApp with this text
        </a>
        <button type="button" className="btn" onClick={copy}>
          Copy the text
        </button>
        <span role="status" className="small">
          {state === 'copied' && <span className="ok saved">✓ Copied.</span>}
          {state === 'failed' && (
            <span className="fail">Could not copy: select the text above and copy it.</span>
          )}
        </span>
      </div>
    </>
  );
}
