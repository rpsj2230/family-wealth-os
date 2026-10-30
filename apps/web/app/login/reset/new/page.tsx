import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MIN_PASSWORD } from '@/lib/reset-mail';
import { createClient } from '@/lib/supabase/server';
import { supabaseEnv } from '@/lib/supabase/env';
import { setNewPassword } from '../../actions';

const MESSAGES: Record<string, string> = {
  short: `Use at least ${MIN_PASSWORD} characters.`,
  match: 'The two passwords are not the same.',
  failed:
    'The password could not be set (it may be too common, or the link has expired). Try another, or ask for a new link.',
};

/** Choosing a new password: after a reset link, or from Settings when signed in. */
export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { error, done } = await searchParams;
  if (!supabaseEnv()) redirect('/login?error=setup');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !done) redirect('/login/forgot?error=expired');
  return (
    <main className="auth">
      <img className="logo" src="/brand/rp-logo.png" alt="RP" />
      <h1>Set a new password</h1>
      {done ? (
        <>
          <p className="notice" role="status" data-testid="reset-done">
            Your password is changed. Use it the next time you sign in.
          </p>
          <p>
            <Link className="btn primary" href="/">
              Go to Home
            </Link>
          </p>
        </>
      ) : (
        <>
          {error && MESSAGES[error] && (
            <p className="notice warn" role="alert">
              {MESSAGES[error]}
            </p>
          )}
          <p className="muted small">For {user?.email}</p>
          <form action={setNewPassword} className="card form">
            <label>
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
              />
            </label>
            <label>
              The same again
              <input
                name="again"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
              />
            </label>
            <button type="submit" className="btn primary">
              Save the new password
            </button>
          </form>
          <p className="muted small">At least {MIN_PASSWORD} characters. A long phrase is best.</p>
        </>
      )}
    </main>
  );
}
