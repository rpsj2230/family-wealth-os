import {
  fdValueOn,
  personStyles,
  type FdRow,
  type PersonStyle,
  type ReportFd,
  type ReportFund,
} from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ctx } from './data';
import { buildDeposits, type DepositAsset, type FdLine } from './deposits';
import { loadInvestmentView, type InvestmentView } from './investments';
import { loadPortfolio } from './portfolio-data';

/** Deposits that count in the summaries: running, and matured ones waiting to be confirmed (closed and renewed ones are history). */
const COUNTED = new Set(['active', 'matured_unconfirmed']);

/** What each deposit puts in and pays out, as the summaries need it. The bank's maturity amount is used when it is recorded. */
export function reportFds(lines: FdLine[], fdRows: FdRow[], ownerId: string | null): ReportFd[] {
  const by = new Map(fdRows.map((f) => [f.asset_id, f]));
  return lines
    .filter((l) => COUNTED.has(l.status) && (!ownerId || l.ownerId === ownerId))
    .map((l) => {
      const f = by.get(l.id);
      const compounding = f?.compounding ?? 'quarterly';
      const computed = fdValueOn({
        principal: l.principal,
        annualRate: l.rate,
        bookedOn: new Date(`${l.bookedOn}T00:00:00Z`),
        asOf: new Date(`${l.maturityOn}T00:00:00Z`),
        maturityOn: new Date(`${l.maturityOn}T00:00:00Z`),
        compounding,
      });
      return {
        id: l.id,
        bank: l.bank,
        owner: l.owner,
        kind: l.kind === 'unknown' ? 'Not set' : l.kind,
        principal: l.principal,
        rate: l.rate,
        bookedOn: l.bookedOn,
        maturityOn: l.maturityOn,
        maturityAmount: Math.round((l.bankMaturity ?? computed) * 100) / 100,
        compounding,
      } satisfies ReportFd;
    });
}

/** The funds of the Investments view in the shape the summaries need, for one person or everyone. */
export function reportFunds(view: InvestmentView, ownerId: string | null): ReportFund[] {
  return view.groups
    .filter((g) => !ownerId || g.ownerId === ownerId)
    .flatMap((g) =>
      g.funds.map((f): ReportFund => ({
        id: f.assetId,
        name: f.name,
        owner: g.name,
        category: f.category.label,
        amc: f.amc,
        value: f.value,
        invested: f.invested,
        units: f.units,
        startedOn: f.startedOn,
        xirr: f.xirr,
        sipMonthly: f.sipMonthly,
        sipStopped: f.sipStopped,
        txns: f.txns.map((t) => ({
          date: t.date,
          kind: t.kind,
          units: t.units,
          amount: t.amount,
        })),
        lots: f.lots.map((l) => ({ acquiredOn: l.acquiredOn, units: l.units, cost: l.cost })),
        hasStatement: f.hasStatement,
      })),
    );
}

export interface ReportsInput {
  today: string;
  people: PersonStyle[];
  styles: Record<string, PersonStyle>;
  fdLines: FdLine[];
  fdRows: FdRow[];
  view: InvestmentView | null;
}

/** Everything the Reports page reads. Funds are loaded only for the tab that needs them. */
export async function loadReportsInput(
  supabase: Ctx['supabase'],
  need: { funds: boolean },
): Promise<ReportsInput> {
  const [loaded, assets, banks, settings] = await Promise.all([
    loadPortfolio(supabase),
    supabase
      .from('assets')
      .select(
        'id, owner_id, institution_id, type, status, nickname, account_kind, is_joint, joint_holder_id',
      ),
    supabase.from('institutions').select('id, name, deposit_insured'),
    loadSettings(supabase as unknown as SupabaseClient),
  ]);
  const depositAssets: DepositAsset[] = (assets.data ?? []).map((a) => ({
    id: a.id as string,
    ownerId: a.owner_id as string,
    institutionId: (a.institution_id as string | null) ?? null,
    type: a.type as string,
    status: a.status as string,
    nickname: a.nickname as string,
    accountKind: (a.account_kind as string | null) ?? null,
    isJoint: !!a.is_joint,
    jointHolderId: (a.joint_holder_id as string | null) ?? null,
  }));
  const bankName = new Map((banks.data ?? []).map((b) => [b.id as string, b.name as string]));
  const deposits = buildDeposits(
    depositAssets,
    loaded.portfolio.valued,
    loaded.fdRows,
    bankName,
    loaded.ownerName,
    loaded.today,
    settings.config.deposits.insuranceLimit,
    new Set(
      (banks.data ?? []).filter((b) => b.deposit_insured === false).map((b) => b.id as string),
    ),
  );
  const people = [...loaded.ownerName.entries()].map(([id, name]) => ({ id, name }));
  const styles = personStyles(people);
  return {
    today: loaded.today.toISOString().slice(0, 10),
    people: Object.values(styles),
    styles,
    fdLines: deposits.fds,
    fdRows: loaded.fdRows,
    view: need.funds ? await loadInvestmentView(supabase, loaded) : null,
  };
}
