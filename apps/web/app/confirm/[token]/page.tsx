import type { Metadata } from 'next';
import Link from 'next/link';
import { confirmAlert } from '../actions';

export const metadata: Metadata = {
  title: 'Message received',
  robots: { index: false, follow: false },
};

/**
 * The "I have received this" page from the inactivity alert. Public (no sign-in), outside the app frame, and it shows nothing from
 * the household: only a thank-you and how to sign in. Pressing the button is what confirms, not opening the link.
 */
export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; bad?: string }>;
}) {
  const { token } = await params;
  const { done, bad } = await searchParams;
  return (
    <main className="auth" data-testid="alert-confirm">
      <img className="logo" src="/brand/rp-logo.png" alt="RP" />
      <h1>{done ? 'Thank you' : 'Did you receive the message?'}</h1>
      {done ? (
        <p className="notice ok" role="status">
          Thank you. The portal knows you have received the message, and nobody else on the list
          will be told. The household has been told that you confirmed.
        </p>
      ) : bad ? (
        <p className="notice warn" role="alert">
          This link does not work any more: it was already used up, a newer message replaced it, or
          someone from the household has signed in since. Nothing else needs doing here. If you were
          asked to act, the steps below still work.
        </p>
      ) : (
        <form action={confirmAlert} className="card form">
          <input type="hidden" name="token" value={token} />
          <p>
            Press the button to let the portal know you have the message. It then stops reminding
            you and does not tell the next person on the list.
          </p>
          <button type="submit" className="btn primary">
            I have received this
          </button>
        </form>
      )}
      <section className="card" aria-labelledby="howto-h">
        <h2 id="howto-h">How to open the family handbook</h2>
        <ol className="list">
          <li>
            Open the <Link href="/login">sign-in page</Link>.
          </li>
          <li>
            Sign in with the family login: the e-mail address and password the message names. The
            message says where the password is kept.
          </li>
          <li>
            Forgot the password? Press “Forgot your password?” on the sign-in page: a link to set a
            new one is sent to the family login’s e-mail address.
          </li>
          <li>The handbook opens after you sign in. It tells you what to do, step by step.</li>
        </ol>
      </section>
    </main>
  );
}
