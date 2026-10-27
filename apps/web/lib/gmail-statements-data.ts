import type { AppConfig } from '@fwos/core';
import type { Ctx } from './data';
import {
  buildGmailModel,
  type GmailModel,
  type GmailPerson,
  type RequestRow,
  type ScanRow,
} from './gmail-statements';

type Db = Ctx['supabase'];

/**
 * Reads the scan log, the requests for full statements and how many extra passwords each person has (never the passwords: the table
 * cannot be read from the app). Every query is small; a failed one only leaves its part empty.
 */
export async function loadGmailModel(
  db: Db,
  householdId: string | null,
  config: AppConfig['statementMail'],
  owners: { id: string; name: string; panLast4: string | null }[],
  today: string,
): Promise<GmailModel> {
  const [scans, requests, counts] = await Promise.all([
    db
      .from('statement_scans')
      .select(
        'trigger, requested_at, started_at, finished_at, mailbox, found, imported, problems, ok, note, detail',
      )
      .order('created_at', { ascending: false })
      .limit(6),
    db
      .from('statement_requests')
      .select('id, owner_id, registrar, requested_on, status, arrived_on')
      .order('requested_on', { ascending: false })
      .limit(12),
    householdId
      ? db.rpc('statement_password_counts', { p_household: householdId })
      : Promise.resolve({ data: [] as { owner_id: string; saved: number }[] }),
  ]);
  const saved = new Map(
    ((counts.data ?? []) as { owner_id: string; saved: number }[]).map((c) => [
      c.owner_id,
      Number(c.saved),
    ]),
  );
  const people: GmailPerson[] = owners.map((o) => ({
    id: o.id,
    name: o.name,
    panSaved: !!o.panLast4,
    passwords: saved.get(o.id) ?? 0,
  }));
  return buildGmailModel({
    config,
    scans: (scans.data ?? []) as ScanRow[],
    requests: (requests.data ?? []) as RequestRow[],
    people,
    today,
    now: new Date(),
  });
}
