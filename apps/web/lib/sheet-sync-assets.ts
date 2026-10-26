/**
 * The app's accounts as the Google Sheet sync needs them: for every line of the sheet's register, the figures the app shows today.
 * Pure: the numbers come from the same functions the pages use (the bank blocks of Accounts, the fund estimates of Investments, what a loan
 * still owes), so the sheet always gets what the screen shows.
 */
import type { AssetRow, BankBlock, BankRow } from '@fwos/core';
import type { SyncAsset } from '@fwos/ingest';
import type { ForeignLine } from './accounts-summary';
import type { LoanLine } from './others-summary';

export interface PositionInput {
  asset_id: string;
  fund_name: string | null;
  invested: number | null;
  started_on: string | null;
  sip_stopped: boolean;
}

export interface SyncSource {
  assets: AssetRow[];
  /** the bank blocks of Accounts: today's value of savings and held money, and each deposit's terms and maturity amount */
  blocks: BankBlock[];
  /** funds and the ULIP: today's value, units times the live price where the app has it */
  fundValue: Map<string, number | null>;
  positions: PositionInput[];
  loans: LoanLine[];
  foreign: ForeignLine[];
  ownerName: Map<string, string>;
  institutionName: Record<string, string>;
}

const last4FromLabel = (label: string): string | null => {
  const m = /(\d{4})(?!.*\d{4})/.exec(label);
  return m ? m[1]! : null;
};

/** One entry for each asset that has a line in the sheet's register; assets of other kinds (property, policies) have none. */
export function buildSyncAssets(src: SyncSource): SyncAsset[] {
  const rows = new Map<string, BankRow>();
  for (const b of src.blocks)
    for (const s of b.sections) for (const r of s.rows) rows.set(r.assetId, r);
  const position = new Map(src.positions.map((p) => [p.asset_id, p]));
  const loan = new Map(src.loans.map((l) => [l.assetId, l]));
  const foreign = new Map(src.foreign.map((f) => [f.assetId, f]));
  const out: SyncAsset[] = [];

  for (const a of src.assets) {
    const label = (a.label ?? '').trim();
    const base = {
      id: a.id,
      label,
      owner: src.ownerName.get(a.owner_id) ?? '',
      institution: a.institution_id ? (src.institutionName[a.institution_id] ?? null) : null,
      holder: a.holder_name ?? null,
      joint: !!a.is_joint,
      accountKind: (a.account_kind === 'NRE'
        ? 'NRE'
        : a.account_kind === 'NRO'
          ? 'NRO'
          : null) as SyncAsset['accountKind'],
      status: a.status,
      sortOrder: a.sort_order ?? null,
      value: null as number | null,
      foreign: null as SyncAsset['foreign'],
      fd: null as SyncAsset['fd'],
      fund: null as SyncAsset['fund'],
      loan: null as SyncAsset['loan'],
    };
    // the sheet's own line decides the last four digits when there is one; otherwise the account's
    const last4 = label
      ? last4FromLabel(label)
      : a.type === 'fixed_deposit'
        ? (a.linked_last4 ?? a.identifier_last4 ?? null)
        : (a.identifier_last4 ?? null);
    const names = (...n: (string | null | undefined)[]) => [
      ...new Set(n.map((x) => (x ?? '').trim()).filter(Boolean)),
    ];

    if (a.type === 'bank_account') {
      const row = rows.get(a.id);
      const f = foreign.get(a.id);
      if (a.currency !== 'INR') {
        out.push({
          ...base,
          kind: 'cash_sg',
          last4,
          names: names(label, a.nickname),
          value: f?.inr ?? row?.current ?? null,
          foreign:
            f && f.amount !== null && f.rate !== null ? { amount: f.amount, rate: f.rate } : null,
        });
      } else
        out.push({
          ...base,
          kind: 'cash',
          last4,
          names: names(label, a.nickname),
          value: row?.current ?? null,
        });
    } else if (a.type === 'fixed_deposit') {
      const fd = rows.get(a.id)?.fd;
      out.push({
        ...base,
        kind: 'fd',
        last4,
        names: names(label, a.nickname),
        fd: fd
          ? {
              principal: fd.principal,
              rate: fd.rate,
              bookedOn: fd.bookedOn,
              maturityOn: fd.maturityOn,
              maturityAmount: fd.maturityAmount,
              ref: fd.ref,
            }
          : null,
      });
    } else if (a.type === 'mutual_fund' || a.type === 'ulip') {
      const p = position.get(a.id);
      out.push({
        ...base,
        kind: a.type === 'ulip' ? 'ulip' : 'fund',
        last4: null,
        // the sheet's line, then the fund's own name, then the nickname
        names: names(label, p?.fund_name, a.nickname),
        value: src.fundValue.get(a.id) ?? null,
        fund:
          a.type === 'mutual_fund'
            ? {
                invested:
                  p?.invested === null || p?.invested === undefined ? null : Number(p.invested),
                startedOn: p?.started_on ?? null,
                stopped: !!p?.sip_stopped || a.status === 'stopped',
              }
            : null,
      });
    } else if (a.type === 'receivable') {
      const l = loan.get(a.id);
      out.push({
        ...base,
        kind: 'loan',
        last4: null,
        names: names(label, a.nickname),
        value: l ? (l.status === 'settled' || l.status === 'overpaid' ? 0 : l.outstanding) : null,
        loan: l ? { counterparty: l.counterparty, lentOn: l.lentOn } : null,
        // a loan given away is not owed back
        status: l?.status === 'gift' ? 'gifted' : a.status,
      });
    } else if (a.type === 'third_party_held') {
      out.push({
        ...base,
        kind: 'third_party',
        last4: null,
        names: names(label, a.nickname),
        value: rows.get(a.id)?.current ?? src.fundValue.get(a.id) ?? null,
      });
    }
  }
  return out;
}
