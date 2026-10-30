import Link from 'next/link';
import { supabaseEnv } from '@/lib/supabase/env';
import { requestReset } from '../actions';

const MESSAGES: Record<string, string> = {
  email: 'Type the email address you sign in with.',
  expired:
    'That link has expired or was already used. Ask for a new one below; only the newest link works.',
};

/** Forgotten password: an email with a link to set a new one. */
export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const configured = supabaseEnv() !== null;
  return (
    <main className="auth">
      <img className="logo" src="/brand/rp-logo.png" alt="RP" />
      <h1>Forgot your password?</h1>
      {error && MESSAGES[error] && (
        <p className="notice warn" role="alert">
          {MESSAGES[error]}
        </p>
      )}
      {sent ? (
        <p className="notice" role="status" data-testid="reset-sent">
          If that address has a login, an email with a link to set a new password is on its way.
          Open it on this device; the link works once and expires soon. Check the spam folder if it
          does not arrive in a few minutes.
        </p>
      ) : (
        <form action={requestReset} className="card form">
          <label>
            Email you sign in with
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <button type="submit" className="btn primary" disabled={!configured}>
            Email me a link
          </button>
        </form>
      )}
      <p className="small">
        <Link href="/login">Back to sign in</Link>
      </p>
      <p className="muted small">
        No access to that email any more? Another adult of the household who signs in as an admin
        can reset it from the Supabase dashboard (Authentication → Users → the person → Send
        password recovery).
      </p>
    </main>
  );
}
