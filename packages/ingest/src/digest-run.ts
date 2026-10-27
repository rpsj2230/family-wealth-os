/**
 * Runs the daily summary for every household that opted in. One message per household per day, even if the job runs twice:
 * a row in the delivery log is claimed first; only the claimant sends. "accepted_by_provider" is the strongest thing we ever record.
 */
export interface DigestHousehold {
  id: string;
  name: string;
  extraRecipients: string[];
}

export interface DigestMessage {
  subject: string;
  text: string;
  html: string;
}

export type Claim = 'claimed' | 'already_done' | 'in_progress';

export interface DigestStore {
  households(): Promise<DigestHousehold[]>;
  memberEmails(householdId: string): Promise<string[]>;
  claim(householdId: string, date: string): Promise<Claim>;
  finish(
    householdId: string,
    date: string,
    r: {
      status: 'accepted_by_provider' | 'failed';
      recipients: number;
      providerId?: string;
      error?: string;
    },
  ): Promise<void>;
  build(householdId: string, date: string): Promise<DigestMessage>;
}

export interface Mailer {
  send(m: DigestMessage & { to: string[] }): Promise<{ id: string }>;
}

export interface DigestResult {
  householdId: string;
  outcome: 'sent' | 'skipped_already_sent' | 'skipped_in_progress' | 'no_recipients' | 'failed';
  recipients: number;
  error?: string;
}

const EMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;

export async function runDigests(
  store: DigestStore,
  mailer: Mailer,
  date: string,
  opts: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<DigestResult[]> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const results: DigestResult[] = [];
  for (const h of await store.households()) {
    try {
      const claim = await store.claim(h.id, date);
      if (claim === 'already_done') {
        results.push({ householdId: h.id, outcome: 'skipped_already_sent', recipients: 0 });
        continue;
      }
      if (claim === 'in_progress') {
        results.push({ householdId: h.id, outcome: 'skipped_in_progress', recipients: 0 });
        continue;
      }
      const to = [
        ...new Set(
          [...(await store.memberEmails(h.id)), ...h.extraRecipients]
            .map((e) => e.trim().toLowerCase())
            .filter((e) => EMAIL.test(e)),
        ),
      ];
      if (to.length === 0) {
        await store.finish(h.id, date, {
          status: 'failed',
          recipients: 0,
          error: 'no valid recipients',
        });
        results.push({ householdId: h.id, outcome: 'no_recipients', recipients: 0 });
        continue;
      }
      const msg = await store.build(h.id, date);
      let lastErr = '';
      let sent: { id: string } | null = null;
      for (let attempt = 1; attempt <= maxAttempts && !sent; attempt++) {
        try {
          sent = await mailer.send({ ...msg, to });
        } catch (e) {
          lastErr = (e as Error).message.slice(0, 300);
          if (attempt < maxAttempts) await sleep(1000 * 2 ** (attempt - 1));
        }
      }
      if (sent) {
        await store.finish(h.id, date, {
          status: 'accepted_by_provider',
          recipients: to.length,
          providerId: sent.id,
        });
        results.push({ householdId: h.id, outcome: 'sent', recipients: to.length });
      } else {
        await store.finish(h.id, date, { status: 'failed', recipients: to.length, error: lastErr });
        results.push({
          householdId: h.id,
          outcome: 'failed',
          recipients: to.length,
          error: lastErr,
        });
      }
    } catch (e) {
      // one household's problem must not stop the others
      const error = (e as Error).message.slice(0, 300);
      try {
        await store.finish(h.id, date, { status: 'failed', recipients: 0, error });
      } catch {
        /* nothing more we can do */
      }
      results.push({ householdId: h.id, outcome: 'failed', recipients: 0, error });
    }
  }
  return results;
}

/**
 * A test send: the day's summary, marked "[Test]" in the subject, to the people who can sign in (never to the extra recipients), for
 * every household that switched the summary on. It does not claim or write the delivery log and does nothing on Telegram, so it
 * cannot use up the real summary of the day or stop it going out.
 */
export async function runDigestTest(
  store: Pick<DigestStore, 'households' | 'memberEmails' | 'build'>,
  mailer: Mailer,
  date: string,
): Promise<DigestResult[]> {
  const out: DigestResult[] = [];
  for (const h of await store.households()) {
    try {
      const to = [
        ...new Set(
          (await store.memberEmails(h.id))
            .map((e) => e.trim().toLowerCase())
            .filter((e) => EMAIL.test(e)),
        ),
      ];
      if (to.length === 0) {
        out.push({ householdId: h.id, outcome: 'no_recipients', recipients: 0 });
        continue;
      }
      const msg = await store.build(h.id, date);
      await mailer.send({ ...msg, subject: `[Test] ${msg.subject}`, to });
      out.push({ householdId: h.id, outcome: 'sent', recipients: to.length });
    } catch (e) {
      out.push({
        householdId: h.id,
        outcome: 'failed',
        recipients: 0,
        error: (e as Error).message.slice(0, 300),
      });
    }
  }
  return out;
}
