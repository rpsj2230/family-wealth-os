import { supabaseEnv } from '@/lib/supabase/env';
import { signIn } from './actions';

const MESSAGES: Record<string, string> = {
  invalid: 'The email or password is not correct.',
  setup:
    'The app is not connected to its database yet. Add the Supabase environment variables and redeploy.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = supabaseEnv() !== null;
  return (
    <main className="auth">
      <img className="logo" src="/brand/rp-logo.png" alt="RP" />
      <h1>Family Wealth OS</h1>
      {!configured && <p className="notice warn">{MESSAGES.setup}</p>}
      {error && configured && MESSAGES[error] && (
        <p className="notice warn" role="alert">
          {MESSAGES[error]}
        </p>
      )}
      <form action={signIn} className="card form">
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" className="btn primary" disabled={!configured}>
          Sign in
        </button>
      </form>
      <p className="muted small">Private household system. Access is by invitation only.</p>
    </main>
  );
}
