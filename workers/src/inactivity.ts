/* eslint-disable no-console */
/**
 * The inactivity alert, run by the daily job (digest.ts) for every household that has an emergency_access row
 * (docs/USER-GUIDE.md, "If you stop using the portal"). The steps and texts are in @fwos/core, the runner in @fwos/ingest, the
 * database reads and conditional writes in @fwos/data. This file only wires them: the service-role client, the members' e-mails
 * (found the way the summary finds them), the Gmail mailer and CallMeBot for WhatsApp.
 *
 * The log carries counts only. DRY_RUN=1 (or INACTIVITY_DRY_RUN=1, the workflow's "Inactivity alert: dry run" box) decides and logs
 * without sending or recording anything.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  callMeBot,
  emailChannel,
  runInactivity,
  whatsappChannel,
  type InactivityMailer,
} from '@fwos/ingest';
import { inactivityReady, supabaseInactivityStore } from '@fwos/data';

export async function runInactivityAlert(o: {
  db: SupabaseClient;
  mailer: InactivityMailer;
  memberEmails(householdId: string): Promise<string[]>;
  appUrl: string;
  serverSecret: string;
  dryRun: boolean;
}): Promise<void> {
  if (!(await inactivityReady(o.db))) {
    console.log('inactivity: waiting for the database update (20261030000100_emergency_guide.sql)');
    return;
  }
  const loginEmails = async (ids: string[]) => {
    const out: string[] = [];
    for (const id of ids) {
      const u = await o.db.auth.admin.getUserById(id);
      if (u.data.user?.email) out.push(u.data.user.email);
    }
    return out;
  };
  const store = supabaseInactivityStore(o.db, { memberEmails: o.memberEmails, loginEmails });
  const whatsapp = callMeBot(async (url, init) => {
    const r = await fetch(url, init);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  });
  const results = await runInactivity(
    store,
    { mailer: o.mailer, channels: [emailChannel(o.mailer), whatsappChannel(whatsapp)] },
    {
      now: new Date().toISOString(),
      appUrl: o.appUrl,
      serverSecret: o.serverSecret,
      dryRun: o.dryRun,
      log: (line) => console.log(line),
    },
  );
  if (results.length === 0) console.log('inactivity: no household has an access row yet');
  if (results.some((r) => r.note === 'error'))
    console.log('::warning::inactivity: one household could not be checked');
}
