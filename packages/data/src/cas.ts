import {
  casPdfText,
  isPasswordError,
  parseCas,
  runCasImport,
  type CasFund,
  type CasIo,
  type CasReport,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

/** Reads and writes for the fund-statement importer. Works with a user client (RLS) or the service role. */
export function casIo(db: SupabaseClient, hh: string): CasIo {
  return {
    async funds(ownerId): Promise<CasFund[]> {
      const assets = must(
        await db
          .from('assets')
          .select('id, nickname')
          .eq('household_id', hh)
          .eq('owner_id', ownerId)
          .eq('type', 'mutual_fund'),
        'funds',
      ) as { id: string; nickname: string }[];
      if (assets.length === 0) return [];
      const pos = must(
        await db
          .from('mf_positions')
          .select('asset_id, fund_name, amfi_code, isin, folio_last4')
          .eq('household_id', hh)
          .in(
            'asset_id',
            assets.map((a) => a.id),
          ),
        'fund positions',
      ) as {
        asset_id: string;
        fund_name: string;
        amfi_code: string | null;
        isin: string | null;
        folio_last4: string | null;
      }[];
      const byAsset = new Map(pos.map((p) => [p.asset_id, p]));
      return assets.map((a) => {
        const p = byAsset.get(a.id);
        return {
          assetId: a.id,
          name: p?.fund_name ?? a.nickname,
          amfiCode: p?.amfi_code ?? null,
          isin: p?.isin ?? null,
          folioLast4: p?.folio_last4 ?? null,
        };
      });
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
    async save({ assetId, scheme, transactions, position, valuation, closed }) {
      // the same line twice on one day is two lines: the reference carries an occurrence number
      const seen = new Map<string, number>();
      const rows = transactions.map((t) => {
        const base = `${t.date}|${t.kind}|${t.amount}|${t.units}|${scheme.folio}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return {
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
          source_ref: `${base}|${n}`.slice(0, 200),
        };
      });
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
      const upd: Record<string, unknown> = {
        invested: position.invested,
        folio_last4: position.folioLast4,
        cas_as_of: position.casAsOf,
        provenance: 'cas',
      };
      if (position.startedOn) upd.started_on = position.startedOn;
      if (position.isin) upd.isin = position.isin;
      if (position.amfiCode) upd.amfi_code = position.amfiCode;
      if (position.sipMonthly !== null) {
        upd.sip_monthly = position.sipMonthly;
        upd.sip_stopped = position.sipStopped ?? false;
      }
      must(
        await db
          .from('mf_positions')
          .update(upd)
          .eq('asset_id', assetId)
          .eq('household_id', hh)
          .select('asset_id'),
        'update position',
      );
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
        if (!latest[0] || valuation.asOf > latest[0].as_of)
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

export interface CasPdfResult {
  outcome: 'imported' | 'partial' | 'failed';
  ownerId: string | null;
  report: CasReport | null;
  detail: string;
}

/**
 * Opens a fund statement with each candidate's passwords (the PAN, or the password chosen when the statement was requested)
 * until one fits, checks the statement belongs to that person, and imports it. No password or PAN is logged or returned. The statement is logged in `cas_imports` (once per source).
 */
export async function importCasPdf(
  db: SupabaseClient,
  hh: string,
  pdf: Uint8Array,
  candidates: { ownerId: string; passwords: string[]; panLast4: string | null }[],
  opts: { sourceRef: string; today: string; receivedOn?: string },
): Promise<CasPdfResult> {
  const done = async (res: CasPdfResult): Promise<CasPdfResult> => {
    await db.from('cas_imports').upsert(
      {
        household_id: hh,
        owner_id: res.ownerId,
        source_ref: opts.sourceRef.slice(0, 200),
        received_on: opts.receivedOn ?? opts.today,
        schemes: res.report
          ? res.report.matched +
            res.report.created +
            res.report.skipped +
            res.report.needsReview.length
          : 0,
        transactions: res.report?.transactionsAdded ?? 0,
        outcome: res.outcome,
        detail: res.detail.slice(0, 2000),
      },
      { onConflict: 'household_id,source_ref' },
    );
    return res;
  };
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
    return done({
      outcome: 'failed',
      ownerId: null,
      report: null,
      detail: isPasswordError(lastError)
        ? candidates.some((c) => c.passwords.length > 0)
          ? 'The password did not open the statement. Use the password you chose when you requested it (CAMS and KFintech let you choose one; if you chose your PAN, type it in capital letters).'
          : 'The statement is password-protected: type its password (the one you chose when requesting it, or your PAN).'
        : `The PDF could not be read (${(lastError as Error | null)?.message ?? 'unknown error'}).`,
    });
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
    return done({
      outcome: 'failed',
      ownerId: null,
      report: null,
      detail:
        'The statement opened without a password, but its PAN does not match anyone saved in Settings.',
    });
  if (stmt.pan && panLast4 && stmt.pan.slice(-4) !== panLast4)
    return done({
      outcome: 'failed',
      ownerId: owner,
      report: null,
      detail:
        'This statement belongs to a different person than the one chosen (the PAN on it does not match).',
    });
  if (stmt.schemes.length === 0)
    return done({
      outcome: 'failed',
      ownerId: owner,
      report: null,
      detail: stmt.warnings.join(' ') || 'Nothing recognised.',
    });
  const report = await runCasImport(owner, stmt, casIo(db, hh), { today: opts.today });
  const partial = report.needsReview.length > 0;
  return done({
    outcome: partial ? 'partial' : 'imported',
    ownerId: owner,
    report,
    detail: [...report.lines, ...stmt.warnings].join('\n'),
  });
}
