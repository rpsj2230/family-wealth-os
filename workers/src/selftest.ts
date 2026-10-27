/* eslint-disable no-console */
/**
 * On demand: checks every link of the "read my email and statements" chain and says which one is broken.
 *  1. every AI key that is switched on answers and a model it may use is found (the keys are tried in order in the real jobs);
 *  2. a made-up bank balance alert is read back correctly by the same reader the inbox uses;
 *  3. Gmail opens over IMAP and the label exists, with how many messages it holds and how old they are;
 *  4. what the inbox has done with messages so far.
 * Prints only counts, dates and sender domains: no message text, no key, no password.
 */
import { ImapFlow } from 'imapflow';
import { createClient } from '@supabase/supabase-js';
import { PROVIDER_NAME, testAiConnection, type AiProvider } from '@fwos/ingest';
import { loadStoredAiKeys, recordAiTest } from '@fwos/data';

const need = (n: string) => {
  const v = process.env[n];
  if (!v) {
    console.error(`${n} is required`);
    process.exit(2);
  }
  return v;
};
const db = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const today = new Date().toISOString().slice(0, 10);
let failures = 0;
const ok = (m: string) => console.log(`PASS  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`FAIL  ${m}`);
  console.log(`::error::${m}`);
};

async function checkAi(): Promise<void> {
  const hh = await db.from('households').select('id');
  const id = hh.data?.[0]?.id as string | undefined;
  const cfg = await db
    .from('integration_settings')
    .select('inbox_label')
    .eq('household_id', id ?? '')
    .maybeSingle();
  label = (cfg.data as { inbox_label: string | null } | null)?.inbox_label ?? 'FWOS/Inbox';
  householdId = id ?? null;
  const keys = id ? await loadStoredAiKeys(db, id, 'service') : [];
  if (keys.length === 0) {
    bad(
      'No AI key is switched on. Add an Anthropic, OpenRouter, Groq or Gemini key, or switch one on, in Settings > Connections.',
    );
    return;
  }
  // the real jobs try the keys in this order and go to the next when one fails; here each is tested on its own so a broken fallback shows too
  const results: { provider: AiProvider; ok: boolean }[] = [];
  for (const [n, k] of keys.entries()) {
    const name = `${n + 1}. ${PROVIDER_NAME[k.provider]}`;
    const r = await testAiConnection({ provider: k.provider, key: k.key, today });
    for (const st of r.steps) (st.ok ? ok : bad)(`${name}: ${st.text}`);
    results.push({ provider: k.provider, ok: r.ok });
    // the Settings page shows when each key was last tested and how it went
    await recordAiTest(
      db,
      id!,
      'service',
      k.provider,
      r.ok,
      r.ok
        ? `Read a test alert with ${r.model ?? k.provider}`
        : (r.steps.find((x) => !x.ok)?.text ?? 'Failed'),
    );
  }
  const working = results.filter((r) => r.ok).length;
  if (working > 0 && working < results.length)
    console.log(
      `INFO  ${working} of ${results.length} keys work; the jobs go on to the next key when one fails, but fix the others in Settings > Connections.`,
    );
}

let label = 'FWOS/Inbox';
let householdId: string | null = null;

async function checkMail(): Promise<void> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: need('SMTP_USER'), pass: need('SMTP_APP_PASSWORD') },
    logger: false,
  });
  try {
    await client.connect();
  } catch (e) {
    bad(
      `Gmail did not open over IMAP (${(e as Error).message}). Check IMAP is switched on in Gmail and the app password is current.`,
    );
    return;
  }
  ok('Gmail opened over IMAP.');
  try {
    const boxes = await client.list();
    const exists = boxes.some(
      (b) => b.path === label || b.path.toLowerCase() === label.toLowerCase(),
    );
    if (!exists) {
      bad(
        `The Gmail label "${label}" does not exist. Create it in Gmail (or change the name in Settings) and apply it to the bank emails.`,
      );
      console.log(
        'Labels present: ' +
          boxes
            .map((b) => b.path)
            .filter((p) => !p.startsWith('['))
            .join(', '),
      );
      return;
    }
    ok(`The label "${label}" exists.`);
    const lock = await client.getMailboxLock(label);
    try {
      const all = (await client.search({ all: true })) || [];
      const week = (await client.search({ since: new Date(Date.now() - 7 * 86_400_000) })) || [];
      console.log(
        `INFO  The label holds ${all.length} messages, ${week.length} of them from the last 7 days.`,
      );
      if (all.length === 0)
        bad(
          `The label "${label}" is empty. Apply it to your bank emails (a Gmail filter on the bank's address that applies the label is easiest).`,
        );
      const rows: string[] = [];
      for await (const m of client.fetch(all.slice(-8), { envelope: true, uid: true })) {
        const domain = (m.envelope?.from?.[0]?.address ?? '').split('@')[1] ?? '?';
        rows.push(
          `${new Date(m.envelope?.date ?? Date.now()).toISOString().slice(0, 10)}  ${domain}`,
        );
      }
      if (rows.length)
        console.log('INFO  Latest messages (date, sender domain):\n  ' + rows.join('\n  '));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function checkLog(): Promise<void> {
  if (!householdId) return;
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const r = await db
    .from('inbox_messages')
    .select('outcome, received_on')
    .eq('household_id', householdId)
    .gte('received_on', since);
  const rows = (r.data ?? []) as { outcome: string; received_on: string }[];
  const by = new Map<string, number>();
  for (const x of rows) by.set(x.outcome, (by.get(x.outcome) ?? 0) + 1);
  console.log(
    `INFO  Messages handled in the last 60 days: ${rows.length}` +
      (rows.length ? ` (${[...by].map(([k, v]) => `${v} ${k}`).join(', ')})` : ''),
  );
}

async function main() {
  await checkAi();
  await checkMail();
  await checkLog();
  console.log(
    failures === 0
      ? 'RESULT  Everything checked is working.'
      : `RESULT  ${failures} problem(s) found, see FAIL lines above.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Self-test failed to run:', (e as Error).message);
  process.exit(1);
});
