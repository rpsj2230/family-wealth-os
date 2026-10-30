/**
 * Rules behind the one-account edit panel: which fields show first, which sit behind "More", what a save sends and how
 * the result is described in plain words. Pure, so it is tested without a browser.
 *
 * The panel edits one account or deposit. Details go through the same database function as the "edit many" table
 * (see account-edit.ts); a new balance and a savings interest rate go through the monthly update function, so the history,
 * the stale-balance checks and the dashboard all stay in step.
 */
import type { BankBlock, AssetRow, FdRow } from '@fwos/core';
import { KINDS, diffRow, gridBanks, rowProblems, type EditRow } from './account-edit';
import { parseAmount, parsePercent, type Change } from './monthly';

export interface QuickRow extends EditRow {
  code: string;
  bankName: string;
  ownerName: string;
  currency: string;
  /** savings: the last balance recorded, in the account's own currency */
  recorded: number | null;
  recordedOn: string | null;
  /** savings: the rate typed for this account, in percent; empty means the bank's published rate or the assumption in Settings */
  savingsRate: string;
  /** who is registered as nominee ('' when nobody wrote it down); absent where the page did not load it, and then not offered */
  nominee?: string;
}

/** What the person has typed in the panel beyond the row itself. */
export interface QuickDraft {
  balance: string;
  balanceOn: string;
  /** rupees per unit of a foreign currency, only for a foreign-currency account */
  fx: string;
  savingsRate: string;
  /** the nominee as typed; absent when the panel does not offer it */
  nominee?: string;
}

export type QuickField =
  | 'label'
  | 'balance'
  | 'savingsRate'
  | 'accountKind'
  | 'fdRate'
  | 'fdMaturityOn'
  | 'fdPrincipal'
  | 'fdMaturityAmount'
  | 'notes'
  | 'status'
  | 'ownerId'
  | 'institutionId'
  | 'joint'
  | 'last4'
  | 'linkedLast4'
  | 'fdRefLast4'
  | 'fdBookedOn'
  | 'holderName';

/**
 * The few fields people change are shown first; the rest wait behind "More". A balance is only offered for savings, and a
 * savings rate only for a rupee savings account (a deposit's rate is its own field).
 */
export function quickLayout(
  kind: EditRow['kind'],
  currency = 'INR',
): { main: QuickField[]; more: QuickField[] } {
  if (kind === 'fd')
    return {
      main: [
        'label',
        'fdRate',
        'fdMaturityOn',
        'fdPrincipal',
        'fdMaturityAmount',
        'accountKind',
        'status',
        'notes',
      ],
      more: ['fdBookedOn', 'fdRefLast4', 'linkedLast4', 'joint', 'ownerId', 'institutionId'],
    };
  if (kind === 'held')
    return {
      main: ['label', 'balance', 'status', 'notes'],
      more: ['holderName', 'accountKind', 'last4', 'joint', 'ownerId', 'institutionId'],
    };
  return {
    main: [
      'label',
      'balance',
      ...(currency === 'INR' ? (['savingsRate'] as const) : []),
      'accountKind',
      'status',
      'notes',
    ],
    more: ['last4', 'joint', 'ownerId', 'institutionId'],
  };
}

/** Plain names for the account types. The stored codes do not change. */
export const KIND_LABEL: Record<string, string> = {
  NRE: 'NRE (external)',
  NRO: 'NRO (ordinary)',
  FCNR: 'FCNR (foreign currency)',
  SB: 'Regular savings',
  resident: 'Resident account',
  joint: 'Joint account',
  other: 'Other',
};
export const KIND_OPTIONS = KINDS.map((k) => ({ value: k as string, label: KIND_LABEL[k] ?? k }));

const STATUS_WORDS: Record<string, string> = {
  active: 'Running',
  matured: 'Matured',
  matured_unconfirmed: 'Matured: money not yet accounted for',
  renewed: 'Renewed',
  closed: 'Closed',
  stopped: 'Stopped',
};
const SAVINGS_STATUS_WORDS: Record<string, string> = {
  active: 'Open',
  closed: 'Closed',
  stopped: 'Stopped',
};

/** The statuses that make sense for this kind of line; the current one is always listed so it never disappears. */
export function statusOptions(
  kind: EditRow['kind'],
  current: string,
): { value: string; label: string }[] {
  const words = kind === 'fd' ? STATUS_WORDS : SAVINGS_STATUS_WORDS;
  const allowed = kind === 'fd' ? ['active', 'matured', 'renewed', 'closed'] : Object.keys(words);
  const list = allowed.includes(current) ? allowed : [current, ...allowed];
  return list.map((v) => ({ value: v, label: words[v] ?? STATUS_WORDS[v] ?? v }));
}

/** The rows of the panel: every account and deposit, with what the panel needs beyond the table's fields. */
export function quickRows(
  blocks: BankBlock[],
  assets: AssetRow[],
  fds: FdRow[],
  ownerNames: Record<string, string>,
  jointHolders: Record<string, string> = {},
  /** nominee notes by asset; without them the panel does not offer the nominee */
  nominees?: Record<string, string>,
): QuickRow[] {
  const bankRows = new Map(
    blocks.flatMap((b) => b.sections.flatMap((s) => s.rows)).map((r) => [r.assetId, r]),
  );
  const asset = new Map(assets.map((a) => [a.id, a]));
  return gridBanks(blocks, assets, fds, jointHolders).flatMap((b) =>
    b.rows.map((r) => {
      const br = bankRows.get(r.id);
      const a = asset.get(r.id);
      return {
        ...r,
        bankName: b.name,
        ownerName: ownerNames[r.ownerId] ?? '',
        currency: br?.currency ?? 'INR',
        recorded: br?.recorded ?? null,
        recordedOn: br?.asOf ?? null,
        savingsRate:
          a?.interest_rate !== null && a?.interest_rate !== undefined
            ? String(Math.round(a.interest_rate * 1e6) / 1e4)
            : '',
        ...(nominees && r.kind !== 'held' ? { nominee: nominees[r.id] ?? '' } : {}),
      };
    }),
  );
}

const LABELS: Partial<Record<keyof EditRow, string>> = {
  ownerId: 'person',
  institutionId: 'bank',
  label: 'name',
  accountKind: 'type',
  isJoint: 'joint',
  jointHolderId: 'second name',
  last4: 'last four digits',
  linkedLast4: 'linked account',
  notes: 'note',
  status: 'status',
  holderName: 'held by',
  fdRate: 'interest rate',
  fdBookedOn: 'start date',
  fdMaturityOn: 'maturity date',
  fdPrincipal: 'amount invested',
  fdMaturityAmount: 'amount at maturity',
  fdRefLast4: 'deposit number',
};
const ROW_KEYS = Object.keys(LABELS) as (keyof EditRow)[];

export interface QuickSave {
  /** the changed details, in the shape the database function takes (null when none changed) */
  details: Record<string, unknown> | null;
  /** a new balance and/or savings rate for the monthly update function (null when neither changed) */
  monthly: Change | null;
  /** what the person must fix first, in plain words */
  problems: string[];
  /** what will change, in plain words: "name, interest rate, balance" */
  changes: string[];
  /** a new nominee note (null clears it); absent when it did not change */
  nominee?: string | null;
}

/** Compares the panel with what was stored: what to send, what is wrong, and what the person changed. */
export function buildQuickSave(
  was: QuickRow,
  now: EditRow,
  draft: QuickDraft,
  today: string,
  fxHint: Record<string, number> = {},
): QuickSave {
  const problems = [...rowProblems(now)];
  const changes: string[] = [];
  const details = diffRow(now, was);
  for (const k of ROW_KEYS) if (now[k] !== was[k]) changes.push(LABELS[k]!);
  const monthly: Change = { assetId: was.id };
  let touched = false;

  if (draft.balance.trim() !== '') {
    const v = parseAmount(draft.balance);
    if (v === null || v < 0)
      problems.push('the balance must be a plain number, for example 125000');
    else if (draft.balanceOn > today) problems.push('the balance date cannot be in the future');
    else {
      monthly.amount = v;
      monthly.asOf = draft.balanceOn || today;
      touched = true;
      changes.push('balance');
      if (was.currency !== 'INR') {
        const fx = draft.fx.trim() !== '' ? parseAmount(draft.fx) : (fxHint[was.currency] ?? null);
        if (!fx || fx <= 0) problems.push(`enter the ${was.currency} to rupee rate`);
        else monthly.fxRate = fx;
      }
    }
  }
  if (draft.savingsRate.trim() !== was.savingsRate.trim()) {
    const p = parsePercent(draft.savingsRate);
    if (p === undefined) problems.push('the interest rate must be between 0 and 100');
    else {
      monthly.interestRate = p;
      touched = true;
      changes.push('interest rate');
    }
  }
  let nominee: string | null | undefined;
  if (draft.nominee !== undefined && draft.nominee.trim() !== (was.nominee ?? '').trim()) {
    if (draft.nominee.trim().length > 200) problems.push('the nominee is longer than 200 letters');
    else {
      nominee = draft.nominee.trim() || null;
      changes.push('nominee');
    }
  }
  return {
    details,
    monthly: touched ? monthly : null,
    problems,
    changes: [...new Set(changes)],
    ...(nominee !== undefined ? { nominee } : {}),
  };
}

/** Everything the panel's provider needs, from the data an Accounts-type page has already loaded. */
export function quickModel(input: {
  blocks: BankBlock[];
  assets: AssetRow[];
  fds: FdRow[];
  ownerNames: Record<string, string>;
  institutions: { id: string; name: string }[];
  jointHolders?: Record<string, string>;
  /** nominee notes by asset (loadNominees); give them to offer the nominee in the panel */
  nominees?: Record<string, string>;
}): {
  rows: QuickRow[];
  owners: { id: string; name: string }[];
  institutions: { id: string; name: string }[];
} {
  return {
    rows: quickRows(
      input.blocks,
      input.assets,
      input.fds,
      input.ownerNames,
      input.jointHolders,
      input.nominees,
    ),
    owners: Object.entries(input.ownerNames).map(([id, name]) => ({ id, name })),
    institutions: [...input.institutions].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** What the "add an account or deposit" form holds while it is being filled in. */
export interface AddDraft {
  type: 'fixed_deposit' | 'bank_account';
  ownerId: string;
  institutionId: string;
  accountKind: 'NRE' | 'NRO' | '';
  isJoint: boolean;
  last4: string;
  notes: string;
  principal: string;
  ratePct: string;
  bookedOn: string;
  maturityOn: string;
  maturityAmount: string;
  refLast4: string;
}

export const emptyAdd = (over: Partial<AddDraft> = {}): AddDraft => ({
  type: 'fixed_deposit',
  ownerId: '',
  institutionId: '',
  accountKind: 'NRE',
  isJoint: false,
  last4: '',
  notes: '',
  principal: '',
  ratePct: '',
  bookedOn: '',
  maturityOn: '',
  maturityAmount: '',
  refLast4: '',
  ...over,
});

/**
 * What is missing before an account or deposit can be added, in plain words. The same checks run again on the server;
 * these only save a round trip.
 */
export function addProblems(d: AddDraft): string[] {
  const out: string[] = [];
  const d4 = /^[A-Za-z0-9-]{1,4}$/;
  if (!d.institutionId) out.push('choose the bank');
  if (!d.ownerId) out.push('choose whose it is');
  if (d.last4 && !d4.test(d.last4)) out.push('the last digits: up to 4 letters or numbers');
  if (d.type === 'fixed_deposit') {
    const principal = parseAmount(d.principal);
    if (!principal || principal <= 0) out.push('enter the amount invested');
    const rate = parseAmount(d.ratePct.replace('%', ''));
    if (rate === null || rate <= 0 || rate >= 30)
      out.push('enter the interest rate, for example 7.5');
    if (!d.bookedOn || !d.maturityOn || d.maturityOn <= d.bookedOn)
      out.push('enter a start date and a later maturity date');
    if (d.maturityAmount.trim() !== '' && !(parseAmount(d.maturityAmount) ?? 0))
      out.push('the amount at maturity must be a plain number');
    if (d.refLast4 && !/^[A-Za-z0-9-]{1,40}$/.test(d.refLast4))
      out.push('the deposit number: up to 4 letters or numbers');
  }
  return out;
}

/** "Saved: name, interest rate and balance." — what was kept, in plain words. */
export function savedMessage(changes: string[]): string {
  if (changes.length === 0) return 'Nothing was changed.';
  const list =
    changes.length === 1
      ? changes[0]!
      : `${changes.slice(0, -1).join(', ')} and ${changes[changes.length - 1]}`;
  return `Saved: ${list}.`;
}
