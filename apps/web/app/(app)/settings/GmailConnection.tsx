import Link from 'next/link';
import { lastScanText, type GmailModel } from '@/lib/gmail-statements';

/** One line on Settings > Connections for the Gmail statements scan: its state, the last scan and where to manage it. */
export function GmailConnection({ model, base = '/import' }: { model: GmailModel; base?: string }) {
  const tone = !model.enabled ? 'warn' : model.last && !model.last.ok ? 'bad' : 'ok';
  const word = !model.enabled ? 'Switched off' : model.never ? 'On, not run yet' : 'On';
  return (
    <section className="card conn-line" id="gmail-connection" aria-labelledby="gmail-conn-h">
      <div className="sectionhead">
        <h3 id="gmail-conn-h">Gmail fund statements</h3>
        <span className={`statuspill ${tone}`}>{word}</span>
      </div>
      <p className="muted small">
        Finds the statements CAMS, KFintech, NSDL and CDSL e-mail you, read only, no AI.{' '}
        {lastScanText(model)} <Link href={`${base}?tab=cas#gmail-statements`}>Open on Import</Link>
        {' · '}
        <Link href="/settings?tab=rules#gmail-statements">Senders and limits</Link>
      </p>
    </section>
  );
}
