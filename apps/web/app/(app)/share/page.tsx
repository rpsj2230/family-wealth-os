import Link from 'next/link';
import { PageHead } from '@/components/PageHead';
import { loadContext } from '@/lib/data';
import { SharePanel } from './SharePanel';
import { whatsappSummary } from './actions';
import './share.css';

export const dynamic = 'force-dynamic';

export default async function SharePage() {
  const { householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const r = await whatsappSummary();
  return (
    <>
      <PageHead
        title="Share today’s summary"
        subtitle="The same short summary as the daily e-mail, as text you can send to someone on WhatsApp. Nothing is sent from here; you choose the person in WhatsApp."
        actions={
          <Link className="btn" href="/settings?tab=notifications">
            Automatic delivery
          </Link>
        }
      />
      <section className="card" aria-labelledby="share-h">
        <h2 id="share-h">Today’s text</h2>
        {r.ok ? (
          <SharePanel text={r.text} />
        ) : (
          <p className="empty">
            The summary could not be prepared just now. Try again in a minute, or open{' '}
            <Link href="/">Home</Link>.
          </p>
        )}
        <p className="muted small">
          It has the estimated net worth, what changed and what needs attention. Amounts are
          estimates from the last values recorded, not bank statements. Account numbers never
          appear.
        </p>
      </section>
      <section className="card" aria-labelledby="auto-h">
        <h2 id="auto-h">Want it to arrive by itself?</h2>
        <p className="muted small">
          WhatsApp does not allow free automatic messages from a personal number. Telegram does, and
          so does e-mail: both are set up in{' '}
          <Link href="/settings?tab=notifications">Settings &gt; Notifications</Link>.
        </p>
      </section>
    </>
  );
}
