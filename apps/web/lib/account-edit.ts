/**
 * Rules behind the "correct tags and details" grid. Pure, so they are tested without a browser.
 * A row carries the values as they are stored; the grid keeps a second copy and sends only what changed.
 */
import type { AssetRow, BankBlock, FdRow } from '@fwos/core';

export const KINDS = ['NRE', 'NRO', 'FCNR', 'SB', 'resident', 'joint', 'other'] as const;
export const STATUSES = [
  'active',
  'matured',
  'matured_unconfirmed',
  'renewed',
  'closed',
  'stopped',
] as const;

export interface EditRow {
  id: string;
  bankKey: string;
  kind: 'cash' | 'fd' | 'held';
  ownerId: string;
  institutionId: string;
  label: string;
  accountKind: string;
  isJoint: boolean;
  last4: string;
  linkedLast4: string;
  notes: string;
  status: string;
  holderName: string;
  /** what the Accounts page shows when the type is empty, e.g. "NRE" */
  inferred: string;
  /** deposits only; the rate is in percent, amounts in rupees */
  fdRate: string;
  fdBookedOn: string;
  fdMaturityOn: string;
  fdPrincipal: string;
  fdMaturityAmount: string;
  fdRefLast4: string;
}

type Field = Exclude<keyof EditRow, 'id' | 'bankKey' | 'kind' | 'inferred'>;
const FIELDS: Field[] = [
  'ownerId',
  'institutionId',
  'label',
  'accountKind',
  'isJoint',
  'last4',
  'linkedLast4',
  'notes',
  'status',
  'holderName',
  'fdRate',
  'fdBookedOn',
  'fdMaturityOn',
  'fdPrincipal',
  'fdMaturityAmount',
  'fdRefLast4',
];

/** The keys the database function takes, for a row that differs from the stored one. */
export function diffRow(now: EditRow, was: EditRow): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (now[f] === was[f]) continue;
    const v = now[f];
    switch (f) {
      case 'fdRate':
        out.fdRate = v === '' ? null : Number(String(v).replace('%', '')) / 100;
        break;
      case 'fdPrincipal':
      case 'fdMaturityAmount':
        out[f] = v === '' ? null : Number(String(v).replace(/[₹,\s]/g, ''));
        break;
      case 'isJoint':
        out.isJoint = !!v;
        break;
      case 'accountKind':
        out.accountKind = v === '' ? null : v;
        break;
      default:
        out[f] =
          typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
    }
  }
  return Object.keys(out).length > 0 ? { id: now.id, ...out } : null;
}

/** Problems with a row that can be seen without asking the database. */
export function rowProblems(r: EditRow): string[] {
  const out: string[] = [];
  const d4 = /^[A-Za-z0-9-]{1,4}$/;
  if (r.last4 && !d4.test(r.last4)) out.push('last four digits: 1 to 4 letters or digits');
  if (r.linkedLast4 && !d4.test(r.linkedLast4))
    out.push('linked account digits: 1 to 4 letters or digits');
  if (r.fdRefLast4 && !d4.test(r.fdRefLast4))
    out.push('deposit number digits: 1 to 4 letters or digits');
  if (r.kind === 'fd') {
    const rate = Number(String(r.fdRate).replace('%', ''));
    if (r.fdRate !== '' && !(rate >= 0 && rate <= 30)) out.push('rate must be between 0 and 30%');
    if (r.fdBookedOn && r.fdMaturityOn && r.fdMaturityOn <= r.fdBookedOn)
      out.push('maturity must be after the start');
    const p = Number(String(r.fdPrincipal).replace(/[₹,\s]/g, ''));
    if (!(p > 0)) out.push('the amount invested must be more than zero');
  }
  if (r.notes.length > 500) out.push('note longer than 500 characters');
  if (r.label.length > 120) out.push('label longer than 120 characters');
  return out;
}

/**
 * Suggested types for rows that have none: a deposit takes the type of the savings account it is linked to (by its last four
 * digits) at the same bank, otherwise the type that all of that person's typed accounts at that bank share. Nothing is suggested
 * where the evidence disagrees.
 */
export function suggestKinds(rows: EditRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.accountKind) continue;
    let pick: string | null = null;
    if (r.kind === 'fd' && r.linkedLast4) {
      const link = rows.find(
        (x) =>
          x.kind === 'cash' &&
          x.bankKey === r.bankKey &&
          x.accountKind &&
          x.last4 === r.linkedLast4,
      );
      if (link) pick = link.accountKind;
    }
    if (!pick) {
      const kinds = new Set(
        rows
          .filter(
            (x) =>
              x.id !== r.id &&
              x.bankKey === r.bankKey &&
              x.ownerId === r.ownerId &&
              x.accountKind &&
              x.kind !== 'held',
          )
          .map((x) => x.accountKind),
      );
      if (kinds.size === 1) pick = [...kinds][0]!;
    }
    if (pick) out[r.id] = pick;
  }
  return out;
}

const pctText = (rate: number) => String(Math.round(rate * 1e6) / 1e4);

/** The grid's rows, bank by bank in the sheet's order, from the same blocks the Accounts page draws. */
export function gridBanks(
  blocks: BankBlock[],
  assets: AssetRow[],
  fds: FdRow[],
): { key: string; name: string; rows: (EditRow & { code: string })[] }[] {
  const asset = new Map(assets.map((a) => [a.id, a]));
  const fd = new Map(fds.map((f) => [f.asset_id, f]));
  return blocks.map((b) => ({
    key: b.key,
    name: b.name,
    rows: b.sections
      .flatMap((s) => s.rows)
      .sort((x, y) => x.order - y.order)
      .flatMap((r) => {
        const a = asset.get(r.assetId);
        if (!a) return [];
        const f = fd.get(r.assetId);
        const kind = (KINDS as readonly string[]).includes(a.account_kind ?? '')
          ? (a.account_kind as string)
          : '';
        return [
          {
            id: a.id,
            code: r.code,
            bankKey: b.key,
            kind: r.kind,
            ownerId: a.owner_id,
            institutionId: a.institution_id ?? '',
            label: a.label ?? '',
            accountKind: kind,
            isJoint: !!a.is_joint,
            last4: a.identifier_last4 ?? '',
            linkedLast4: a.linked_last4 ?? '',
            notes: a.notes ?? '',
            status: a.status,
            holderName: a.holder_name ?? '',
            inferred: !kind && r.kindInferred && r.accountKind ? r.accountKind : '',
            fdRate: f ? pctText(f.rate) : '',
            fdBookedOn: f?.booked_on ?? '',
            fdMaturityOn: f?.maturity_on ?? '',
            fdPrincipal: f ? String(f.principal) : '',
            fdMaturityAmount:
              f?.bank_maturity_amount !== null && f?.bank_maturity_amount !== undefined
                ? String(f.bank_maturity_amount)
                : '',
            fdRefLast4: f?.fd_ref_last4 ?? '',
          },
        ];
      }),
  }));
}
