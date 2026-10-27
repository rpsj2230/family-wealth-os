import type { FundImportDiff, OnFileState } from '@fwos/core';
import {
  applyFundDiff,
  fundCsvToStatement,
  mergeReports,
  openStatement,
  planCasImport,
  type CasFund,
  type CasIo,
  type CasReport,
  type CasStatement,
  type PasswordCandidate,
  type PlanConfig,
  type Selection,
  type SkippedFolios,
  type TxnCsvRow,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFundStates, type FundPosition } from './fund-state';
import { loadSettings } from './settings';
import { syncSipEstimates } from './sip-estimates';

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

/** Reads and writes for the fund-statement importer. Works with a user client (RLS) or the service role. */
export function casIo(db: SupabaseClient, hh: string): CasIo {
  return {
    async funds(ownerId, ctx): Promise<CasFund[]> {
      const assets = must(
        await db
          .from('assets')
          .select('id, nickname, status')
          .eq('household_id', hh)
          .eq('owner_id', ownerId)
          .eq('type', 'mutual_fund'),
        'funds',
      ) as { id: string; nickname: string; status: string }[];
      if (assets.length === 0) return [];
      const ids = assets.map((a) => a.id);
      const pos = must(
        await db
          .from('mf_positions')
          .select(
            'asset_id, fund_name, amfi_code, isin, folio_last4, units_as_of, started_on, units, invested, sip_monthly, sip_stopped, cas_detail_from, cas_detail_to',
          )
          .eq('household_id', hh)
          .in('asset_id', ids),
        'fund positions',
      ) as (FundPosition & {
        fund_name: string;
        amfi_code: string | null;
        isin: string | null;
        folio_last4: string | null;
        units_as_of: string | null;
        started_on: string | null;
      })[];
      const byAsset = new Map(pos.map((p) => [p.asset_id, p]));
      const states: Map<string, OnFileState> = await loadFundStates(
        db,
        hh,
        ids,
        pos,
        ctx?.dates ?? [],
      );
      return assets.map((a) => {
        const p = byAsset.get(a.id);
        const state = states.get(a.id);
        return {
          assetId: a.id,
          name: p?.fund_name ?? a.nickname,
          amfiCode: p?.amfi_code ?? null,
          isin: p?.isin ?? null,
          folioLast4: p?.folio_last4 ?? null,
          status: a.status,
          unitsAsOf: p?.units_as_of ?? null,
          startedOn: p?.started_on ?? null,
          ...(state ? { state } : {}),
        };
      });
    },
    async rememberIgnored({ assetId, verdict, basis }) {
      must(
        await db
          .from('fund_import_ignores')
          .upsert(
            { household_id: hh, asset_id: assetId, verdict, basis: basis.slice(0, 120) },
            { onConflict: 'asset_id,verdict,basis', ignoreDuplicates: true },
          )
          .select('id'),
        'remember choice',
      );
    },
    async markSold({ assetId, asOf }) {
      // closed, no units, the SIP stopped from the statement date (when one was running), a zero value on that date; the estimated lines go with it
      const cur = must(
        await db
          .from('mf_positions')
          .select('sip_monthly, sip_stopped')
          .eq('asset_id', assetId)
          .eq('household_id', hh)
          .limit(1),
        'current SIP',
      ) as { sip_monthly: number | null; sip_stopped: boolean }[];
      must(
        await db
          .from('assets')
          .update({ status: 'closed' })
          .eq('id', assetId)
          .eq('household_id', hh)
          .select('id'),
        'close fund',
      );
      must(
        await db
          .from('mf_positions')
          .update({ units: 0, units_as_of: asOf })
          .eq('asset_id', assetId)
          .eq('household_id', hh)
          .select('asset_id'),
        'zero units',
      );
      if (cur[0] && cur[0].sip_monthly && !cur[0].sip_stopped) {
        const r = await db.rpc('apply_sip_change', {
          p_household: hh,
          p_asset: assetId,
          p_monthly: 0,
          p_effective_on: asOf,
        });
        if (r.error) throw new Error(`stop SIP: ${r.error.message}`);
      }
      must(
        await db
          .from('mf_transactions')
          .delete()
          .eq('asset_id', assetId)
          .eq('source', 'estimate')
          .select('id'),
        'drop estimates',
      );
      const latest = must(
        await db
          .from('observations')
          .select('as_of')
          .eq('asset_id', assetId)
          .is('superseded_by', null)
          .order('as_of', { ascending: false })
          .limit(1),
        'latest value',
      ) as { as_of: string }[];
      if (!latest[0] || asOf > latest[0].as_of)
        must(
          await db
            .from('observations')
            .insert({
              household_id: hh,
              asset_id: assetId,
              kind: 'balance',
              amount: 0,
              currency: 'INR',
              fx_rate: null,
              as_of: asOf,
              received_at: new Date().toISOString(),
              source: 'statement',
              source_ref: `cas-sold:${asOf}`,
              confidence: 'verified',
              note: `Not on the fund statement dated ${asOf}, so treated as sold`,
            })
            .select('id'),
          'record value',
        );
    },
    async isinToAmfi(isin) {
      const r = must(
        await db
          .from('amfi_schemes')
          .select('code')
          .or(`isin_growth.eq.${isin},isin_reinvest.eq.${isin}`)
          .limit(1),
        'scheme lookup',
      ) as { code: string }[];
      return r[0]?.code ?? null;
    },
    async createFund({ ownerId, name, isin, amfiCode, folioLast4, closed }) {
      const a = must(
        await db
          .from('assets')
          .insert({
            household_id: hh,
            type: 'mutual_fund',
            owner_id: ownerId,
            nickname: name.slice(0, 120),
            currency: 'INR',
            status: closed ? 'closed' : 'active',
          })
          .select('id')
          .single(),
        'create fund',
      ) as { id: string };
      must(
        await db.from('mf_positions').insert({
          asset_id: a.id,
          household_id: hh,
          fund_name: name.slice(0, 200),
          plan_type: /direct/i.test(name)
            ? 'direct'
            : /regular/i.test(name)
              ? 'regular'
              : 'regular_or_unknown',
          invested: 0,
          provenance: 'cas',
          amfi_code: amfiCode,
          isin,
          folio_last4: folioLast4,
        }),
        'create position',
      );
      return a.id;
    },
    async save({ assetId, transactions, lineSource, replace, position, valuation, closed, sip }) {
      // lines the statement replaces are set aside first, so nothing is counted twice at any moment (they are never deleted)
      if (replace)
        for (let i = 0; i < replace.keys.length; i += 200) {
          const r = await db.rpc('supersede_fund_lines', {
            p_household: hh,
            p_asset: assetId,
            p_refs: replace.keys.slice(i, i + 200),
            p_statement_ref: replace.statementRef,
            p_statement_on: replace.statementOn || null,
            p_reason: replace.reason,
          });
          if (r.error) throw new Error(`set aside replaced lines: ${r.error.message}`);
        }
      // a statement that has a line which an earlier statement had set aside brings it back as its own
      if (lineSource === 'cas' && transactions.length > 0)
        for (let i = 0; i < transactions.length; i += 200) {
          const r = await db.rpc('restore_fund_lines', {
            p_household: hh,
            p_asset: assetId,
            p_refs: transactions.slice(i, i + 200).map((t) => t.key),
          });
          if (r.error) throw new Error(`restore lines: ${r.error.message}`);
        }
      // only the lines that are not stored yet arrive here; each carries the reference it is stored under
      const rows = transactions.map((t) => ({
        household_id: hh,
        asset_id: assetId,
        txn_on: t.date,
        kind: t.kind,
        amount: t.amount,
        units: t.units,
        nav: t.nav,
        balance_units: t.balance,
        description: t.description,
        source: lineSource,
        source_ref: t.key,
      }));
      let added = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const r = must(
          await db
            .from('mf_transactions')
            .upsert(rows.slice(i, i + 200), {
              onConflict: 'asset_id,source_ref',
              ignoreDuplicates: true,
            })
            .select('id'),
          'save transactions',
        ) as { id: string }[];
        added += r.length;
      }
      // only the fields that are new or changed
      const upd: Record<string, unknown> = {};
      if (position.invested !== undefined) upd.invested = position.invested;
      if (position.startedOn) upd.started_on = position.startedOn;
      if (position.folioLast4) upd.folio_last4 = position.folioLast4;
      if (position.casAsOf) upd.cas_as_of = position.casAsOf;
      if (position.coverTo) {
        upd.cas_detail_from = position.coverFrom ?? null;
        upd.cas_detail_to = position.coverTo;
      }
      if (position.isin) upd.isin = position.isin;
      if (position.amfiCode) upd.amfi_code = position.amfiCode;
      if (position.units !== undefined && position.unitsAsOf) {
        // the units held on that date; a later hand-entered count is never replaced by an older statement
        const cur = must(
          await db
            .from('mf_positions')
            .select('units_as_of')
            .eq('asset_id', assetId)
            .eq('household_id', hh)
            .limit(1),
          'current units',
        ) as { units_as_of: string | null }[];
        if (!cur[0]?.units_as_of || cur[0].units_as_of <= position.unitsAsOf) {
          upd.units = position.units;
          upd.units_as_of = position.unitsAsOf;
        }
      }
      if (Object.keys(upd).length > 0) {
        upd.provenance = 'cas';
        must(
          await db
            .from('mf_positions')
            .update(upd)
            .eq('asset_id', assetId)
            .eq('household_id', hh)
            .select('asset_id'),
          'update position',
        );
      }
      // each SIP change takes effect on its own date, never on the day the statement was read
      for (const c of sip) {
        const r = await db.rpc('apply_sip_change', {
          p_household: hh,
          p_asset: assetId,
          p_monthly: c.monthly,
          p_effective_on: c.effectiveOn,
        });
        if (r.error) throw new Error(`record SIP: ${r.error.message}`);
      }
      if (closed)
        must(
          await db
            .from('assets')
            .update({ status: 'closed' })
            .eq('id', assetId)
            .eq('household_id', hh)
            .select('id'),
          'close fund',
        );
      if (valuation) {
        if (valuation.snapshot && valuation.amount >= 0)
          must(
            await db.from('mf_snapshots').upsert(
              {
                asset_id: assetId,
                household_id: hh,
                as_of: valuation.asOf,
                units: valuation.units,
                nav: valuation.nav && valuation.nav > 0 ? valuation.nav : null,
                value: valuation.amount,
                invested: valuation.invested,
                source: 'cas',
              },
              { onConflict: 'asset_id,as_of' },
            ),
            'save snapshot',
          );
        if (valuation.observation)
          must(
            await db.from('observations').insert({
              household_id: hh,
              asset_id: assetId,
              kind: 'balance',
              amount: valuation.amount,
              currency: 'INR',
              fx_rate: null,
              as_of: valuation.asOf,
              received_at: new Date().toISOString(),
              source: 'statement',
              source_ref: `cas:${valuation.asOf}`,
              confidence: 'verified',
              note: 'Value from a fund statement (units times NAV)',
            }),
            'record value',
          );
      }
      return { added };
    },
  };
}

/** The tolerances and thresholds of the comparison, from Settings. */
async function planRules(db: SupabaseClient, hh: string): Promise<Partial<PlanConfig>> {
  const c = (await loadSettings(db, hh)).config;
  return {
    sipMinInstalments: c.estimates.sipMinInstalments,
    unitTolerance: c.funds.unitTolerance,
    moneyTolerance: c.funds.moneyTolerance,
  };
}

export interface CasPdfResult {
  outcome: 'imported' | 'partial' | 'failed';
  /** the first person the statement was applied to (the one whose password opened it when it names nobody) */
  ownerId: string | null;
  /** one report for everyone in the file */
  report: CasReport | null;
  /** the report of each person in the file */
  people?: { ownerId: string; report: CasReport }[];
  /** folios of someone who is not in the family list: named, not applied */
  skipped?: SkippedFolios[];
  detail: string;
  /** "2 funds updated: +5 transactions; 1 SIP stopped; 1 fund sold" */
  summary: string;
}

type Candidate = PasswordCandidate;

/**
 * A fund statement that lists balances held with a depository only, or that mentions demat holdings (a combined CAMS + KFintech
 * statement can carry a demat section), cannot show that a fund was sold, so it is not complete.
 */
const isComplete = (stmt: CasStatement) =>
  !stmt.schemes.some((s) => s.holdingsOnly) && !stmt.dematMention;

const skippedLine = (k: SkippedFolios) =>
  `${k.schemes.length} scheme${k.schemes.length === 1 ? '' : 's'} on folios of someone not in your family list (PAN ending ${k.panLast4 ?? 'unknown'}): skipped`;

export type CasPreview =
  | { ok: false; detail: string }
  | {
      ok: true;
      /** the first person in the file, and the comparison for them */
      ownerId: string;
      diff: FundImportDiff;
      /** one comparison for every person whose folios are in the file */
      people: { ownerId: string; diff: FundImportDiff }[];
      /** folios of someone who is not in the family list: named, and not applied */
      skipped: SkippedFolios[];
      basis: 'email' | 'pan' | 'unknown';
      warnings: string[];
      periodFrom: string | null;
      periodTo: string | null;
    };

/**
 * What a statement would change, without writing anything: opens it (the password is used here and nowhere kept), splits it by
 * person (the PAN on each folio), reads what is on file and compares. Only a statement keyed on a PAN lists everything a person
 * holds, so only that kind can show a fund as sold by leaving it out.
 */
export async function previewCasPdf(
  db: SupabaseClient,
  hh: string,
  pdf: Uint8Array,
  candidates: Candidate[],
  opts: { today: string },
): Promise<CasPreview> {
  const o = await openStatement(pdf, candidates);
  if (!o.ok) return { ok: false, detail: o.detail };
  const rules = await planRules(db, hh);
  const io = casIo(db, hh);
  const people: { ownerId: string; diff: FundImportDiff }[] = [];
  for (const g of o.groups)
    people.push({
      ownerId: g.ownerId,
      diff: await planCasImport(g.ownerId, g.stmt, io, {
        ...rules,
        today: opts.today,
        complete: isComplete(g.stmt),
      }),
    });
  return {
    ok: true,
    ownerId: people[0]!.ownerId,
    diff: people[0]!.diff,
    people,
    skipped: o.skipped,
    basis: o.stmt.basis ?? 'unknown',
    warnings: o.stmt.warnings,
    periodFrom: o.stmt.periodFrom,
    periodTo: o.stmt.periodTo,
  };
}

/** What an import keeps with its log: the one-line summary, the remarks and the change list. */
function changeRecord(report: CasReport, diffNotes: string[]) {
  return { summary: report.summary, notes: diffNotes, items: report.changes };
}

/**
 * Opens a fund statement, compares it with what is on file and writes only what is new or changed: all of it (the mailbox job), or
 * only the items in `select` (the person's choice at the preview). Each person's folios in the file are applied to that person. The
 * statement is logged in `cas_imports` (once per source) with the full list of changes.
 */
export async function importCasPdf(
  db: SupabaseClient,
  hh: string,
  pdf: Uint8Array,
  candidates: Candidate[],
  opts: {
    sourceRef: string;
    today: string;
    receivedOn?: string;
    select?: Selection;
    /** the statement came by e-mail: a password that fits none of the saved ones is explained for that case */
    fromMail?: boolean;
  },
): Promise<CasPdfResult> {
  const done = async (
    res: Omit<CasPdfResult, 'summary'> & { summary?: string },
    changes: unknown = null,
  ): Promise<CasPdfResult> => {
    const out: CasPdfResult = { ...res, summary: res.summary ?? res.detail };
    await db.from('cas_imports').upsert(
      {
        household_id: hh,
        owner_id: res.ownerId,
        source_ref: opts.sourceRef.slice(0, 200),
        received_on: opts.receivedOn ?? opts.today,
        schemes: res.report ? res.report.statementFunds : 0,
        transactions: res.report?.transactionsAdded ?? 0,
        outcome: res.outcome,
        detail: res.detail.slice(0, 2000),
        changes,
      },
      { onConflict: 'household_id,source_ref' },
    );
    return out;
  };
  const o = await openStatement(pdf, candidates, opts.fromMail);
  if (!o.ok) return done({ outcome: 'failed', ownerId: o.ownerId, report: null, detail: o.detail });
  const io = casIo(db, hh);
  const rules = await planRules(db, hh);
  const people: { ownerId: string; report: CasReport }[] = [];
  const notes: string[] = [];
  for (const g of o.groups) {
    const diff = await planCasImport(g.ownerId, g.stmt, io, {
      ...rules,
      today: opts.today,
      complete: isComplete(g.stmt),
    });
    const report = await applyFundDiff(diff, io, opts.select ?? null, {
      statementRef: opts.sourceRef,
    });
    people.push({ ownerId: g.ownerId, report });
    notes.push(...diff.notes);
  }
  await syncSipEstimates(db, { householdId: hh, today: new Date(`${opts.today}T00:00:00Z`) });
  const report = mergeReports(people.map((p) => p.report));
  const skippedLines = o.skipped.map(skippedLine);
  const partial = report.needsReview.length > 0;
  await markRequestsArrived(db, hh, o.ownerId, opts.today);
  return done(
    {
      outcome: partial ? 'partial' : 'imported',
      ownerId: people[0]!.ownerId,
      report,
      people,
      skipped: o.skipped,
      summary: report.summary,
      detail: [report.summary, ...report.lines, ...skippedLines, ...o.stmt.warnings].join('\n'),
    },
    changeRecord(report, [...notes, ...skippedLines]),
  );
}

export interface FundCsvOwnerResult {
  ownerId: string;
  diff: FundImportDiff;
  /** lines of the file left out, and why */
  notes: string[];
  /** set once the changes are applied */
  report: CasReport | null;
}

/**
 * Compares fund-transaction lines (see `fundCsvToStatement`) for one person with what is on file. With `apply` it then writes only
 * what is new or changed (all of it, or the items in `select`); without it nothing is written, so the preview is the same
 * comparison the import acts on.
 */
export async function importFundCsv(
  db: SupabaseClient,
  hh: string,
  ownerId: string,
  rows: TxnCsvRow[],
  opts: { today: string; apply: boolean; select?: Selection },
): Promise<FundCsvOwnerResult> {
  const { statement, notes } = fundCsvToStatement(rows, opts.today);
  const io = casIo(db, hh);
  const diff = await planCasImport(ownerId, statement, io, {
    ...(await planRules(db, hh)),
    today: opts.today,
    source: 'file',
  });
  const report = opts.apply ? await applyFundDiff(diff, io, opts.select ?? null) : null;
  if (report)
    await syncSipEstimates(db, { householdId: hh, today: new Date(`${opts.today}T00:00:00Z`) });
  return { ownerId, diff, notes: [...notes, ...statement.warnings], report };
}

/**
 * A statement for this person has been read: the requests for a full statement that were still waiting for them are now arrived. A
 * failure here never fails the import (the request note is a convenience).
 */
export async function markRequestsArrived(
  db: SupabaseClient,
  hh: string,
  ownerId: string,
  today: string,
): Promise<void> {
  try {
    const done = await db
      .from('statement_requests')
      .update({ status: 'arrived', arrived_on: today })
      .eq('household_id', hh)
      .eq('owner_id', ownerId)
      .eq('status', 'asked')
      .select('task_id');
    // the reminder left for a late request is no longer needed
    const tasks = ((done.data ?? []) as { task_id: string | null }[])
      .map((r) => r.task_id)
      .filter((x): x is string => !!x);
    if (tasks.length > 0)
      await db
        .from('tasks')
        .update({ status: 'done', done_at: new Date().toISOString() })
        .in('id', tasks)
        .eq('status', 'open');
  } catch {
    /* the import itself is done */
  }
}

/**
 * Everyone's passwords for opening statements, for the background jobs (service role only): the saved PAN in capitals and in small
 * letters, then any extra statement passwords the person saved. Nothing here is ever logged or returned to a page.
 */
export async function loadStatementCandidates(
  db: SupabaseClient,
  hh: string,
): Promise<Candidate[]> {
  const pans = must(
    await db.from('owner_pan').select('owner_id, pan').eq('household_id', hh),
    'saved PANs',
  ) as { owner_id: string; pan: string }[];
  const extra = must(
    await db.from('statement_passwords').select('owner_id, password').eq('household_id', hh),
    'statement passwords',
  ) as { owner_id: string; password: string }[];
  const byOwner = new Map<string, string[]>();
  for (const e of extra) byOwner.set(e.owner_id, [...(byOwner.get(e.owner_id) ?? []), e.password]);
  return pans.map((p) => ({
    ownerId: p.owner_id,
    passwords: [...new Set([p.pan, p.pan.toLowerCase(), ...(byOwner.get(p.owner_id) ?? [])])],
    panLast4: p.pan.slice(-4),
  }));
}

export interface CasMailResult {
  outcome: 'imported' | 'partial' | 'failed';
  reason: string;
  /** whose statement it was (the people the attachments opened for) */
  ownerIds: string[];
  funds: number;
  transactions: number;
}

/**
 * Imports the PDF attachments of one e-mail as fund statements: the same safety as the label job (it was extracted from there so
 * both jobs share it). The reason is one line, with no password and no PAN in it.
 */
export async function importCasAttachments(
  db: SupabaseClient,
  hh: string,
  m: {
    messageId: string;
    receivedOn: string;
    attachments: { filename: string; content: Uint8Array }[];
  },
  today: string,
): Promise<CasMailResult> {
  const candidates = await loadStatementCandidates(db, hh);
  const results: CasPdfResult[] = [];
  for (const a of m.attachments)
    results.push(
      await importCasPdf(db, hh, a.content, candidates, {
        sourceRef: `${m.messageId}|${a.filename}`,
        today,
        receivedOn: m.receivedOn,
        fromMail: true,
      }),
    );
  const ok = results.filter((r) => r.outcome !== 'failed');
  if (ok.length === 0)
    return {
      outcome: 'failed',
      reason: results
        .map((r) => r.detail)
        .join(' ')
        .slice(0, 300),
      ownerIds: [],
      funds: 0,
      transactions: 0,
    };
  const review = ok.flatMap((r) => r.report?.needsReview ?? []);
  // what changed, in one line (the full list is kept with the import: Import > Fund statement, recent statements)
  const changed = ok.map((r) => r.summary).filter((x) => x.length > 0);
  return {
    outcome: review.length > 0 ? 'partial' : 'imported',
    reason: `${changed.join(' | ')}${review.length ? `; check: ${review.join(', ')}` : ''}`,
    ownerIds: [
      ...new Set(
        ok.flatMap((r) => r.people?.map((p) => p.ownerId) ?? (r.ownerId ? [r.ownerId] : [])),
      ),
    ],
    funds: ok.reduce((n, r) => n + (r.report?.statementFunds ?? 0), 0),
    transactions: ok.reduce((n, r) => n + (r.report?.transactionsAdded ?? 0), 0),
  };
}
