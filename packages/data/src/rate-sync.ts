import type { SupabaseClient } from '@supabase/supabase-js';
import { sameBank } from '@fwos/core';
import { planSync, type CorrectionReason, type ParsedOffer, type StoredOffer } from '@fwos/ingest';

/**
 * Stores rates read from a bank's page (or from text you pasted from it): new ones are added, changed ones updated, a rate you typed is
 * never overwritten, and a rate that was read wrongly before is noted so the reader is told next time. Shared by the weekly job and by the
 * "paste the page" box in Settings. Returns one line saying what changed.
 */
export async function saveRatesRead(args: {
  db: SupabaseClient;
  household: string;
  bank: string;
  read: ParsedOffer[];
  /** names of the banks where you hold something, to keep one spelling of each bank's name */
  heldNames: string[];
  today: string;
  /** a comparison page may cover only part of what the bank offers, so it never removes a rate that is not on it */
  thirdParty: boolean;
  sourceUrl: string | undefined;
  /** what the "where from" line says */
  sourceNote: string;
}): Promise<string> {
  const { db, household, read, heldNames, today, thirdParty } = args;
  const bankName = args.bank;
  const all = await db
    .from('rate_offers')
    .select(
      'id, bank, product, account_kind, tenure_from_months, tenure_to_months, balance_from, balance_to, rate, source_kind, ai_rate, correction_reason, misread_count',
    )
    .eq('household_id', household);
  const existing: StoredOffer[] = ((all.data ?? []) as Record<string, unknown>[])
    .filter((e) => sameBank(e.bank as string, bankName))
    .map((e) => ({
      id: e.id as string,
      bank: e.bank as string,
      product: e.product as 'savings' | 'fd',
      accountKind: e.account_kind as string,
      tenureFromMonths: e.tenure_from_months as number,
      tenureToMonths: e.tenure_to_months as number,
      balanceFrom: e.balance_from === null ? null : Number(e.balance_from),
      balanceTo: e.balance_to === null ? null : Number(e.balance_to),
      rate: Number(e.rate),
      sourceKind: e.source_kind as 'manual' | 'ai',
      aiRate: e.ai_rate === null ? null : Number(e.ai_rate),
      correctionReason: (e.correction_reason as CorrectionReason | null) ?? null,
      misreadCount: Number(e.misread_count ?? 0),
    }));
  // one spelling of the bank name: the one already stored, else the name of your account's bank
  const canon = existing[0]?.bank ?? heldNames.find((n) => sameBank(n, bankName)) ?? bankName;
  const fetched = read.map((o) => ({ ...o, bank: canon }));
  // a comparison page may cover only part of what the bank offers, so it never removes a rate that is not on it
  const plan = planSync(existing, fetched, { replaceAbsent: !thirdParty });
  const must = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  const touch = {
    checked_on: today,
    source_url: args.sourceUrl,
    // the column holds at most 120 characters; a longer note must shorten, not fail the whole bank
    source_note:
      args.sourceNote.length > 120
        ? `${args.sourceNote.slice(0, 117).trimEnd()}…`
        : args.sourceNote,
  };
  if (plan.insert.length)
    must(
      await db.from('rate_offers').insert(
        plan.insert.map((o) => ({
          household_id: household,
          bank: o.bank,
          product: o.product,
          account_kind: o.accountKind,
          tenure_from_months: o.tenureFromMonths,
          tenure_to_months: o.tenureToMonths,
          balance_from: o.balanceFrom,
          balance_to: o.balanceTo,
          rate: o.rate,
          conditions: o.conditions,
          source_kind: 'ai',
          ...touch,
        })),
      ),
    );
  for (const c of plan.change)
    must(
      await db
        .from('rate_offers')
        .update({ rate: c.to, ...touch })
        .eq('id', c.id),
    );
  if (plan.confirm.length) must(await db.from('rate_offers').update(touch).in('id', plan.confirm));
  if (plan.remove.length) must(await db.from('rate_offers').delete().in('id', plan.remove));
  for (const d of plan.pageDiffers)
    must(
      await db
        .from('rate_offers')
        .update({ page_rate: d.pageRate, page_seen_on: today })
        .eq('id', d.id),
    );
  for (const d of plan.pageMoved)
    must(
      await db
        .from('rate_offers')
        .update({ page_rate: d.pageRate, page_seen_on: today })
        .eq('id', d.id),
    );
  if (plan.pageAgrees.length)
    must(
      await db
        .from('rate_offers')
        .update({ page_rate: null, page_seen_on: null, checked_on: today })
        .in('id', plan.pageAgrees),
    );
  if (plan.resolved.length)
    must(
      await db
        .from('rate_offers')
        .update({
          source_kind: 'ai',
          ai_rate: null,
          correction_reason: null,
          corrected_on: null,
          misread_count: 0,
          page_rate: null,
          page_seen_on: null,
          ...touch,
        })
        .in('id', plan.resolved),
    );
  const known = new Set(
    (
      (await db.from('rate_hints').select('hint').eq('household_id', household).eq('active', true))
        .data ?? []
    ).map((h) => h.hint as string),
  );
  for (const m of plan.stillMisread) {
    const cur = existing.find((e) => e.id === m.id)!;
    must(
      await db
        .from('rate_offers')
        .update({
          misread_count: cur.misreadCount + 1,
          page_rate: m.wrong,
          page_seen_on: today,
          correction_reason: m.diagnosis.cause,
        })
        .eq('id', m.id),
    );
    if (!known.has(m.diagnosis.hint))
      must(
        await db.from('rate_hints').insert({
          household_id: household,
          bank: canon,
          cause: m.diagnosis.cause,
          hint: m.diagnosis.hint,
        }),
      );
  }

  const unchanged = plan.confirm.length;
  return (
    `read ${fetched.length} rates: ${plan.insert.length} new, ${plan.change.length} changed, ${unchanged} unchanged` +
    (plan.remove.length ? `, ${plan.remove.length} no longer on the page` : '') +
    (plan.resolved.length
      ? `; ${plan.resolved.length} of your corrections now match the page`
      : '') +
    (plan.stillMisread.length
      ? `; ${plan.stillMisread.length} still read wrongly (rule saved for next time)`
      : '') +
    (plan.pageDiffers.length + plan.pageMoved.length
      ? `; ${plan.pageDiffers.length + plan.pageMoved.length} typed rates differ from the page`
      : '')
  );
}
