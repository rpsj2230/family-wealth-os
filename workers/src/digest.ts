/* eslint-disable no-console */
/**
 * Daily summary e-mail for every household that opted in. Runs in GitHub Actions.
 * Mail goes through your own Gmail account over SMTP with an app password (free, no domain needed).
 */
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { DEFAULT_APP_URL, buildDigest } from '@fwos/core';
import {
  buildDigestInput,
  buildHandbookDoc,
  ensureHarvestTasks,
  loadNeeds,
  syncNeededTasks,
  recordFundSnapshots,
  ensureInterestRefundRecords,
  ensureRefundRecords,
  planInterestRefunds,
  loadHarvestPositions,
  loadSettings,
  planHarvest,
} from '@fwos/data';
import {
  parseChatIds,
  runDigests,
  runDigestTest,
  sendTelegram,
  type Claim,
  type DigestStore,
} from '@fwos/ingest';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMTP_USER, SMTP_APP_PASSWORD, APP_URL } =
  process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SMTP_USER || !SMTP_APP_PASSWORD) {
  console.error(
    'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMTP_USER and SMTP_APP_PASSWORD are required',
  );
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const appUrl = APP_URL || DEFAULT_APP_URL;

// The report date is the date in Singapore, where you live.
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

interface LogRow {
  status: string;
  attempts: number;
  updated_at: string;
}

const store: DigestStore = {
  async households() {
    const s = await db
      .from('digest_settings')
      .select('household_id, extra_recipients, households(name)')
      .eq('enabled', true);
    if (s.error) throw new Error(`settings: ${s.error.message}`);
    return (s.data ?? []).map((r) => ({
      id: r.household_id as string,
      name: (r.households as unknown as { name: string } | null)?.name ?? 'Household',
      extraRecipients: (r.extra_recipients as string[]) ?? [],
    }));
  },
  async memberEmails(householdId) {
    const m = await db
      .from('household_members')
      .select('user_id')
      .eq('household_id', householdId)
      .in('role', ['admin', 'member']);
    if (m.error) throw new Error(`members: ${m.error.message}`);
    const emails: string[] = [];
    for (const r of m.data ?? []) {
      const u = await db.auth.admin.getUserById(r.user_id as string);
      if (u.data.user?.email) emails.push(u.data.user.email);
    }
    return emails;
  },
  async claim(householdId, d): Promise<Claim> {
    const ins = await db
      .from('digest_log')
      .insert({ household_id: householdId, digest_date: d, status: 'sending' });
    if (!ins.error) return 'claimed';
    if (ins.error.code !== '23505') throw new Error(`claim: ${ins.error.message}`);
    const cur = await db
      .from('digest_log')
      .select('status, attempts, updated_at')
      .eq('household_id', householdId)
      .eq('digest_date', d)
      .eq('channel', 'email')
      .single();
    const row = cur.data as LogRow | null;
    if (!row) throw new Error('claim: row vanished');
    if (row.status === 'accepted_by_provider') return 'already_done';
    const stuck = Date.now() - Date.parse(row.updated_at) > 30 * 60_000;
    if (row.status === 'sending' && !stuck) return 'in_progress';
    const upd = await db
      .from('digest_log')
      .update({
        status: 'sending',
        attempts: row.attempts + 1,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('household_id', householdId)
      .eq('digest_date', d)
      .eq('channel', 'email');
    if (upd.error) throw new Error(`claim retry: ${upd.error.message}`);
    return 'claimed';
  },
  async finish(householdId, d, r) {
    const u = await db
      .from('digest_log')
      .update({
        status: r.status,
        recipients: r.recipients,
        provider_id: r.providerId ?? null,
        error: r.error ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('household_id', householdId)
      .eq('digest_date', d)
      .eq('channel', 'email');
    if (u.error) throw new Error(`finish: ${u.error.message}`);
  },
  async build(householdId, d) {
    const h = await db.from('households').select('name').eq('id', householdId).single();
    const s = await db.from('digest_settings').select('*').eq('household_id', householdId).single();
    // schedule this year's tax-gain harvesting as reminder tasks (once per person per year), so they reach the summary
    try {
      const hv = await loadHarvestPositions(db, { householdId });
      const st = await loadSettings(db, householdId);
      const plan = planHarvest(hv.positions, d, {
        rules: st.rules,
        config: st.config.harvest,
        ytdRealised: hv.ytdRealised,
      });
      const n = await ensureHarvestTasks(db, householdId, plan, hv.ownerName, d, {
        month: st.config.reminders.harvestMonth,
        day: st.config.reminders.harvestDay,
      });
      if (n > 0) console.log(`Added ${n} tax-harvest reminder task(s).`);
      const r = await ensureRefundRecords(db, householdId, plan);
      const ir = await ensureInterestRefundRecords(
        db,
        householdId,
        await planInterestRefunds(db, st.config, st.rules, d, householdId),
      );
      if (r + ir > 0) console.log(`Updated ${r + ir} expected tax-refund record(s).`);
    } catch (e) {
      console.warn(`Tax-harvest reminders skipped: ${(e as Error).message}`);
    }
    // what is still needed from you (statements, answers, a setting), kept as tasks before the summary reads them
    try {
      const t = await syncNeededTasks(db, householdId, await loadNeeds(db, householdId));
      if (t.added + t.closed > 0)
        console.log(`Needed from you: ${t.open} open, ${t.added} added, ${t.closed} closed.`);
    } catch (e) {
      console.warn(`Needed-from-you tasks skipped: ${(e as Error).message}`);
    }
    // today's units, price and value for every fund: the history behind each fund's graph
    try {
      const n = await recordFundSnapshots(db, householdId);
      if (n > 0) console.log(`Recorded ${n} fund snapshot(s).`);
    } catch (e) {
      console.warn(`Fund snapshots skipped: ${(e as Error).message}`);
    }
    // keep the family handbook current for the read-only emergency viewer
    try {
      const doc = await buildHandbookDoc(db, { householdId });
      const up = await db.from('emergency_documents').upsert({
        household_id: householdId,
        content: doc,
        generated_at: new Date().toISOString(),
      });
      if (up.error) throw new Error(up.error.message);
    } catch (e) {
      console.warn(`Handbook not refreshed: ${(e as Error).message}`);
    }
    const input = await buildDigestInput(db, {
      householdId,
      date: d,
      householdName: (h.data as { name: string } | null)?.name ?? 'Household',
      appUrl,
      // a setting that is absent (an older row) behaves as on
      includeRetirement:
        (s.data as { include_retirement?: boolean | null } | null)?.include_retirement ?? true,
      includeGoals: (s.data as { include_goals?: boolean | null } | null)?.include_goals ?? true,
    });
    const g = buildDigest(input);
    return { subject: g.subject, text: g.text, html: g.html };
  },
};

// remember each summary as it is built, so Telegram sends the same text without building it twice
const built = new Map<string, string>();
const buildOnce = store.build;
store.build = async (householdId, d) => {
  const m = await buildOnce(householdId, d);
  built.set(householdId, m.text);
  return m;
};

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: SMTP_USER, pass: SMTP_APP_PASSWORD },
});
const mailer = {
  async send(m: { to: string[]; subject: string; text: string; html: string }) {
    const info = await transport.sendMail({
      from: `Family Wealth OS <${SMTP_USER}>`,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
    return { id: String(info.messageId ?? 'accepted') };
  },
};
// "digest test" (run the workflow by hand with Test ticked): one e-mail to the people who can sign in, marked [Test], with no
// delivery-log entry and no Telegram message, so it never uses up or blocks the real summary of the day
if (['1', 'true'].includes(String(process.env.DIGEST_TEST ?? '').toLowerCase())) {
  const sent = await runDigestTest(store, mailer, date);
  console.log(JSON.stringify({ date, test: true, results: sent }, null, 2));
  if (sent.length === 0) console.log('No household has switched the daily summary on yet.');
  process.exit(sent.some((r) => r.outcome === 'failed' || r.outcome === 'no_recipients') ? 1 : 0);
}
const results = await runDigests(store, mailer, date);
console.log(JSON.stringify({ date, results }, null, 2));

/** The same summary on Telegram, for every household that saved a bot and a chat. Once a day; a failure is logged, never fatal. */
async function pushTelegram() {
  const cfg = await db
    .from('integration_settings')
    .select('household_id, telegram_bot_token, telegram_chat_ids')
    .not('telegram_bot_token', 'is', null)
    .not('telegram_chat_ids', 'is', null);
  if (cfg.error) throw new Error(cfg.error.message);
  for (const row of cfg.data ?? []) {
    const hh = row.household_id as string;
    const chats = parseChatIds(String(row.telegram_chat_ids ?? ''));
    if (chats.length === 0) continue;
    const ins = await db
      .from('digest_log')
      .insert({ household_id: hh, digest_date: date, channel: 'telegram', status: 'sending' });
    if (ins.error) {
      if (ins.error.code !== '23505') throw new Error(ins.error.message);
      const cur = await db
        .from('digest_log')
        .select('status, attempts')
        .eq('household_id', hh)
        .eq('digest_date', date)
        .eq('channel', 'telegram')
        .single();
      const c = cur.data as { status: string; attempts: number } | null;
      if (!c || c.status === 'accepted_by_provider') {
        console.log(`Telegram: ${hh} already has today's summary.`);
        continue;
      }
      await db
        .from('digest_log')
        .update({ status: 'sending', attempts: c.attempts + 1, error: null })
        .eq('household_id', hh)
        .eq('digest_date', date)
        .eq('channel', 'telegram');
    }
    let error: string | null = null;
    try {
      const text = built.get(hh) ?? (await store.build(hh, date)).text;
      for (const chat of chats) {
        const r = await sendTelegram(
          async (u, init) => fetch(u, init),
          String(row.telegram_bot_token),
          chat,
          text,
        );
        if (!r.ok) error = `${error ? `${error}; ` : ''}chat ${chat}: ${r.error}`;
      }
    } catch (e) {
      error = (e as Error).message;
    }
    await db
      .from('digest_log')
      .update({
        status: error ? 'failed' : 'accepted_by_provider',
        recipients: chats.length,
        error: error ? error.slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('household_id', hh)
      .eq('digest_date', date)
      .eq('channel', 'telegram');
    console.log(
      error
        ? `::warning::Telegram not sent: ${error}`
        : `Telegram: sent to ${chats.length} chat(s).`,
    );
  }
}
try {
  await pushTelegram();
} catch (e) {
  console.warn(`::warning::Telegram step failed: ${(e as Error).message}`);
}
if (results.some((r) => r.outcome === 'failed' || r.outcome === 'no_recipients')) {
  console.error(
    '::error::At least one summary could not be sent; see the delivery log in the app.',
  );
  process.exitCode = 1;
}
if (results.length === 0) console.log('No household has switched the daily summary on yet.');
