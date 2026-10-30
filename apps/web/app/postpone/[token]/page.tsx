import type { Metadata } from 'next';
import Link from 'next/link';
import { postponeAlert } from '../../confirm/actions';

export const metadata: Metadata = {
  title: 'Postpone the alert',
  robots: { index: false, follow: false },
};

/**
 * The "I'm fine — postpone" page from the owner's warning. Public (no sign-in), outside the app frame, shows nothing from the
 * household. Pressing the button counts as using the portal; opening the link alone does not (a mail scanner opens links).
 */
export default async function PostponePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; bad?: string }>;
}) {
  const { token } = await params;
  const { done, bad } = await searchParams;
  return (
    <main className="auth" data-testid="alert-postpone">
      <img className="logo" src="/brand/rp-logo.png" alt="RP" />
      <h1>{done ? 'Postponed' : 'Are you all right?'}</h1>
      {done ? (
        <p className="notice ok" role="status">
          Glad to hear it. Nobody will be told: the count of days starts again from now, as if you
          had signed in.
        </p>
      ) : bad ? (
        <p className="notice warn" role="alert">
          This link does not work any more: it was already used, or someone from the household has
          signed in since. To be sure, <Link href="/login">sign in</Link>: that postpones it too.
        </p>
      ) : (
        <form action={postponeAlert} className="card form">
          <input type="hidden" name="token" value={token} />
          <p>Press the button and nobody will be told. Signing in does the same.</p>
          <button type="submit" className="btn primary">
            I’m fine — postpone
          </button>
        </form>
      )}
      <p className="small">
        <Link href="/login">Sign in to the portal</Link>
      </p>
    </main>
  );
}
