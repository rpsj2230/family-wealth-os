import type { DigestEmail } from '@fwos/core';
import { previewFrames } from '@/lib/digest-preview';
import './digestpreview.css';

/**
 * Today's e-mail shown the way it will arrive: the subject and preview line as a mail list shows them, then the message in a
 * sandboxed frame at phone width and at laptop width, then the plain text that Telegram and WhatsApp carry. The frames run nothing
 * (`sandbox=""`), scroll inside their own box and never widen the page.
 */
export function DigestFrames({ email }: { email: DigestEmail }) {
  const frames = previewFrames(email);
  return (
    <div className="dp">
      <section className="card dp-list" aria-labelledby="dp-subject-h">
        <h2 id="dp-subject-h">In the mail list</h2>
        <p className="dp-subject" data-testid="dp-subject">
          {email.subject}
        </p>
        <p className="dp-pre muted small" data-testid="dp-preheader">
          {email.preheader}
        </p>
      </section>
      {frames.map((f) => (
        <section key={f.key} className="card dp-frame" aria-labelledby={`dp-${f.key}-h`}>
          <h2 id={`dp-${f.key}-h`}>
            {f.label} <span className="muted small">({f.width} px wide)</span>
          </h2>
          <div className="dp-scroll">
            <iframe
              title={f.title}
              data-testid={`dp-${f.key}`}
              sandbox={f.sandbox}
              srcDoc={f.srcDoc}
              style={{ width: f.width }}
              loading="lazy"
            />
          </div>
        </section>
      ))}
      <section className="card" aria-labelledby="dp-text-h">
        <h2 id="dp-text-h">The same numbers as text</h2>
        <p className="muted small">
          This is what Telegram carries and what a mail app shows when it cannot draw the page.
        </p>
        <pre className="dp-text" data-testid="dp-text">
          {email.text}
        </pre>
      </section>
    </div>
  );
}
