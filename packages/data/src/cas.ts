import type { FundImportDiff, OnFileState } from '@fwos/core';
import {
  applyFundDiff,
  casPdfText,
  fundCsvToStatement,
  isPasswordError,
  parseCas,
  planCasImport,
  type CasFund,
  type CasIo,
  type CasReport,
  type CasStatement,
  type PlanConfig,
  type Selection,
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
            'asset_id, fund_name, amfi_code, isin, folio_last4, units_as_of, started_on, units, invested, sip_monthly, sip_stopped',
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
    async save({ assetId, transactions, position, valuation, closed, sip }) {
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
        source: 'cas',
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
  ownerId: string | null;
  report: CasReport | null;
  detail: string;
  /** "2 funds updated: +5 transactions; 1 SIP stopped; 1 fund sold" */
  summary: string;
}

type Candidate = { ownerId: string; passwords: string[]; panLast4: string | null };

type Opened =
  | { ok: true; stmt: CasStatement; ownerId: string }
  | { ok: false; ownerId: string | null; detail: string };

/**
 * Opens a fund statement with each candidate's passwords (the PAN, or the password chosen when the statement was requested)
 * until one fits, and checks the statement belongs to that person. No password or PAN is logged or returned.
 */
async function openStatement(pdf: Uint8Array, candidates: Candidate[]): Promise<Opened> {
  let text: string | null = null;
  let owner: string | null = null;
  let panLast4: string | null = null;
  let lastError: unknown = null;
  // an unprotected statement opens without a password
  try {
    text = await casPdfText(pdf);
  } catch (e) {
    lastError = e;
  }
  if (text === null)
    outer: for (const c of candidates) {
      for (const pw of c.passwords) {
        try {
          text = await casPdfText(pdf, pw);
          owner = c.ownerId;
          panLast4 = c.panLast4;
          break outer;
        } catch (e) {
          lastError = e;
          if (!isPasswordError(e)) break outer;
        }
      }
    }
  if (text === null)
    return {
      ok: false,
      ownerId: null,
      detail: isPasswordError(lastError)
        ? candidates.some((c) => c.passwords.length > 0)
          ? 'The password did not open the statement. Use the password you chose when you requested it (CAMS and KFintech let you choose one; if you chose your PAN, type it in capital letters).'
          : 'The statement is password-protected: type its password (the one you chose when requesting it, or your PAN).'
        : `The PDF could not be read (${(lastError as Error | null)?.message ?? 'unknown error'}).`,
    };
  const stmt = parseCas(text);
  if (owner === null) {
    const hit = candidates.filter(
      (c) => c.panLast4 && stmt.pan && c.panLast4 === stmt.pan.slice(-4),
    );
    if (hit.length === 1) {
      owner = hit[0]!.ownerId;
      panLast4 = hit[0]!.panLast4;
    }
  }
  if (owner === null)
    return {
      ok: false,
      ownerId: null,
      detail:
        'The statement opened without a password, but its PAN does not match anyone saved in Settings.',
    };
  if (stmt.pan && panLast4 && stmt.pan.slice(-4) !== panLast4)
    return {
      ok: false,
      ownerId: owner,
      detail:
        'This statement belongs to a different person than the one chosen (the PAN on it does not match).',
    };
  if (stmt.schemes.length === 0)
    return {
      ok: false,
      ownerId: owner,
      detail: stmt.warnings.join(' ') || 'Nothing recognised.',
    };
  return { ok: true, stmt, ownerId: owner };
}

/** A fund statement that lists balances held with a depository only cannot show that a fund was sold, so it is not complete. */
const isComplete = (stmt: CasStatement) => !stmt.schemes.some((s) => s.holdingsOnly);

export type CasPreview =
  | { ok: false; detail: string }
  | {
      ok: true;
      ownerId: string;
      diff: FundImportDiff;
      warnings: string[];
      periodFrom: string | null;
      periodTo: string | null;
    };

/**
 * What a statement would change, without writing anything: opens it (the password is used here and nowhere kept), reads what is on
 * file and compares. A fund statement for the whole PAN lists everything held, so a fund missing from it has been sold.
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
  const diff = await planCasImport(o.ownerId, o.stmt, casIo(db, hh), {
    ...(await planRules(db, hh)),
    today: opts.today,
    complete: isComplete(o.stmt),
  });
  return {
    ok: true,
    ownerId: o.ownerId,
    diff,
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
 * only the items in `select` (the person's choice at the preview). The statement is logged in `cas_imports` (once per source) with
 * the full list of changes.
 */
export async function importCasPdf(
  db: SupabaseClient,
  hh: string,
  pdf: Uint8Array,
  candidates: Candidate[],
  opts: { sourceRef: string; today: string; receivedOn?: string; select?: Selection },
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
  const o = await openStatement(pdf, candidates);
  if (!o.ok) return done({ outcome: 'failed', ownerId: o.ownerId, report: null, detail: o.detail });
  const io = casIo(db, hh);
  const diff = await planCasImport(o.ownerId, o.stmt, io, {
    ...(await planRules(db, hh)),
    today: opts.today,
    complete: isComplete(o.stmt),
  });
  const report = await applyFundDiff(diff, io, opts.select ?? null);
  await syncSipEstimates(db, { householdId: hh, today: new Date(`${opts.today}T00:00:00Z`) });
  const partial = report.needsReview.length > 0;
  return done(
    {
      outcome: partial ? 'partial' : 'imported',
      ownerId: o.ownerId,
      report,
      summary: report.summary,
      detail: [report.summary, ...report.lines, ...o.stmt.warnings].join('\n'),
    },
    changeRecord(report, diff.notes),
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
