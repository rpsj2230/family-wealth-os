/**
 * Applies ONE month of a history plan. All reads and writes go through `HistoryIo`, so the rules are tested without a database.
 *
 * Never destructive and safe to repeat:
 *  - a value is only ever added. One that is already on file for the same month with the same amount is left alone; one that differs
 *    on the same day is a conflict, kept as it is unless the person chose the sheet's value for that conflict, and then the sheet's
 *    value is added and the old one marked as replaced (the only change an observation ever allows);
 *  - values on later dates are never touched;
 *  - a deposit or account that is not on file is added once, as a closed record whose end date is flagged as estimated; one already
 *    on file keeps its terms (only a missing deposit number is filled in);
 *  - a fund's value is stored for cross-checking only and never as its valuation.
 */
import {
  HIST_FUND_REF,
  type HistoricalAsset,
  type HistoryConflict,
  type HistoryMonth,
  type HistoryPlan,
  type WriteObs,
} from './history';

export interface NewHistoricalAsset {
  type: 'fixed_deposit' | 'bank_account' | 'third_party_held';
  ownerName: string;
  bank: string | null;
  nickname: string;
  label: string;
  accountKind: 'NRE' | 'NRO' | null;
  joint: boolean;
  last4: string | null;
  currency: 'INR' | 'SGD';
  holderName: string | null;
  status: 'closed' | 'matured';
  notes: string;
  fd: {
    principal: number;
    rate: number;
    bookedOn: string;
    startEstimated: boolean;
    maturityOn: string;
    maturityAmount: number | null;
    ref: string | null;
    endedOn: string;
  } | null;
}

export interface ObservationInsert {
  assetId: string;
  kind: 'balance' | 'valuation';
  amount: number;
  currency: 'INR' | 'SGD';
  fxRate: number | null;
  asOf: string;
  sourceRef: string;
  note: string | null;
}

export interface HistoryIo {
  /** the id of the new asset, or null with a reason when it cannot be added (for example the person is not in the household) */
  createAsset(a: NewHistoricalAsset): Promise<{ id: string } | { error: string }>;
  insertObservation(o: ObservationInsert): Promise<string>;
  /** marks an observation as replaced by another one */
  supersede(oldId: string, newId: string): Promise<void>;
  /** sets the deposit number when the deposit has none; returns whether it did */
  fillFdNumber(assetId: string, ref: string): Promise<boolean>;
}

export type ConflictChoice = 'keep' | 'sheet';

export interface MonthResult {
  tab: string;
  ok: boolean;
  addedAssets: number;
  observations: number;
  checks: number;
  identical: number;
  conflictsKept: number;
  conflictsReplaced: number;
  copyDropped: number;
  fdNumbers: number;
  /** what could not be done, in words */
  errors: string[];
}

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function describe(h: HistoricalAsset): NewHistoricalAsset {
  const when = `${h.firstSeen} to ${h.lastSeen}`;
  const base = {
    ownerName: h.ownerName,
    bank: h.bank,
    label: h.label,
    accountKind: h.accountKind,
    joint: h.joint,
    last4: h.last4,
    currency: h.currency,
    holderName: h.holderName,
    status: h.status,
  };
  const note = `Added from the monthly tabs (${when}). The tabs do not say when it ended; ${h.endedOn} is the first month it is missing from, an estimate to correct if you know better.`;
  if (h.kind === 'fd' && h.fd) {
    return {
      ...base,
      type: 'fixed_deposit',
      nickname: `${h.label || 'FD'} (${h.fd.startEstimated ? 'first listed ' : ''}${h.fd.bookedOn}, ${h.fd.principal.toLocaleString('en-IN')})`,
      notes: h.fd.startEstimated
        ? `${note} The tabs also give no start date; ${h.fd.bookedOn} is the first month the deposit is listed.`
        : note,
      fd: {
        principal: h.fd.principal,
        rate: h.fd.rate,
        bookedOn: h.fd.bookedOn,
        startEstimated: h.fd.startEstimated,
        maturityOn: h.fd.maturityOn,
        maturityAmount: h.fd.maturityAmount,
        ref: h.fd.ref,
        endedOn: h.endedOn,
      },
    };
  }
  const held = h.holderName !== null;
  return {
    ...base,
    type: held ? 'third_party_held' : 'bank_account',
    nickname: held
      ? `Account held by ${h.holderName}`
      : `${h.label || 'Cash'}${h.accountKind && !new RegExp(h.accountKind, 'i').test(h.label) ? ' ' + h.accountKind : ''}`.replace(
          /\s+/g,
          ' ',
        ),
    notes: note,
    fd: null,
  };
}

/** The note stored with a value: why it replaces another, what a fund value is for, and that the account was not stated on the sheet. */
function noteFor(w: WriteObs, conflict: HistoryConflict | undefined): string | null {
  const parts = [
    conflict
      ? `Replaces ${inr(conflict.existing.amount)} (${conflict.existing.source}) on this date, as you chose when importing the monthly tabs.`
      : w.ref.startsWith(HIST_FUND_REF)
        ? 'The value in the monthly sheet, kept only to check the statement against.'
        : null,
    w.identity?.note ?? null,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(' ') : null;
}

/**
 * Applies the month `tab` of `plan`. `choices` maps a conflict's id to the person's answer; a conflict with no answer keeps what is on
 * file. A failure on one line is reported and the rest of the month still goes in; running the month again finishes it.
 */
export async function applyHistoryMonth(
  plan: HistoryPlan,
  tab: string,
  choices: Record<string, ConflictChoice>,
  io: HistoryIo,
): Promise<MonthResult> {
  const month: HistoryMonth | undefined = plan.months.find((m) => m.tab === tab);
  const res: MonthResult = {
    tab,
    ok: true,
    addedAssets: 0,
    observations: 0,
    checks: 0,
    identical: 0,
    conflictsKept: 0,
    conflictsReplaced: 0,
    copyDropped: 0,
    fdNumbers: 0,
    errors: [],
  };
  if (!month) {
    res.ok = false;
    res.errors.push(`The tab "${tab}" is not in this workbook.`);
    return res;
  }
  const byKey = new Map(plan.historical.map((h) => [h.key, h]));
  const created = new Map<string, string>();
  for (const key of month.groupKeys) {
    const h = byKey.get(key);
    if (!h || h.skipReason) continue;
    const spec = describe(h);
    const made = await io
      .createAsset(spec)
      .catch((e: unknown) => ({ error: (e as Error).message }));
    if ('error' in made) {
      res.errors.push(`${spec.label}: ${made.error}`);
      continue;
    }
    created.set(key, made.id);
    res.addedAssets++;
  }

  const conflictOf = new Map(plan.conflicts.map((c) => [c.id, c]));
  for (const w of month.writes) {
    if (w.status === 'identical') {
      res.identical++;
      continue;
    }
    if (w.status === 'copy_dropped') {
      res.copyDropped++;
      continue;
    }
    const assetId = w.assetId ?? (w.groupKey ? created.get(w.groupKey) : undefined);
    if (!assetId) {
      res.errors.push(
        `${w.label} (${w.cell}): the account was not added, so its value was not saved.`,
      );
      continue;
    }
    const conflict = w.status === 'conflict' ? conflictOf.get(w.id) : undefined;
    if (w.status === 'conflict') {
      if ((choices[w.id] ?? 'keep') !== 'sheet' || !conflict) {
        res.conflictsKept++;
        continue;
      }
    }
    try {
      const id = await io.insertObservation({
        assetId,
        kind: w.kind,
        amount: w.amount,
        currency: w.currency,
        fxRate: w.fxRate,
        asOf: w.asOf,
        sourceRef: w.ref,
        note: noteFor(w, conflict),
      });
      if (conflict) {
        await io.supersede(conflict.existing.id, id);
        res.conflictsReplaced++;
      } else if (w.check) res.checks++;
      else res.observations++;
    } catch (e) {
      res.errors.push(`${w.label} (${w.cell}): ${(e as Error).message}`);
    }
  }

  for (const f of month.fdRefFills) {
    try {
      if (await io.fillFdNumber(f.assetId, f.ref)) res.fdNumbers++;
    } catch (e) {
      res.errors.push(`Deposit number at ${f.cell}: ${(e as Error).message}`);
    }
  }
  res.ok = res.errors.length === 0;
  return res;
}
