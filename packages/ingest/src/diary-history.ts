/**
 * Diary notes as history. Before the workbook, the household kept dated notes of every account: each bank and person, the deposits
 * (amount, maturity, rate), the savings balance, the Singapore balances and money lent. Such a note is the same thing as one monthly
 * tab, so it goes through the same importer (history.ts and history-import.ts): accounts and deposits already on file are matched, a
 * deposit that is not is added as an ended record with an estimated start, a value already on file is never overwritten, and running it
 * twice adds nothing.
 *
 * `diaryWorkbook` lays the notes out as tabs in the workbook's older layout (Bank | Type | Rate | Start Date | Maturity Date | Amount ...
 * with a "This Time" date). `alignDiary` first writes each bank the way the accounts on file name it, and moves a deposit's maturity
 * onto the one on file when the same person's deposit at the same bank, for the same amount, matures within a few days of it (a note
 * written "3/5 April 2024" is the deposit the bank records on the 3rd).
 *
 * Pure: no database.
 */
import ExcelJS from 'exceljs';
import { bankKey, personKey, type ExistingAsset } from './history-match';
import { daysBetween } from './history-dates';

export interface DiaryLine {
  /** the bank as the note writes it ("Yesbank", "IDFC"); for Singapore "UOB" or "DBS"; for money lent "Others" */
  bank: string;
  /** whose account (the bank's group); empty for Singapore accounts and money lent */
  person?: string;
  kind: 'fd' | 'cash' | 'sg' | 'loan' | 'memo' | 'fund_summary';
  /** rupees */
  amount: number;
  /** deposits: the rate (decimal) and maturity (ISO date) */
  rate?: number;
  maturity?: string;
  /** Singapore accounts: the balance in dollars */
  sgd?: number;
  /** money lent and memos: the counterparty; a fund summary: its label */
  label?: string;
  /** the account type, for savings: NRE unless said */
  accountKind?: 'NRE' | 'NRO';
}

export interface DiaryNote {
  /** the tab's title: a month, "Jul 2020" */
  title: string;
  /** the day the note was written (or brought up to date) */
  asOf: string;
  lines: DiaryLine[];
}

/** When an account was opened, as far as the notes tell: after one day and by another. */
export interface DiaryOpening {
  bank: string;
  person: string;
  /** the latest day it can have been opened (it is in a note of that day) */
  by: string;
  /** the last day it was certainly not open yet (it is missing from a note of that day), when known */
  after?: string;
  note: string;
}

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** The bank on file a note means: the same name, or one that starts with the other ("IDFC" is "IDFC First Bank"). */
export function bankOnFile(raw: string, banks: string[]): string | null {
  if (/^(uob|dbs|others)$/i.test(raw)) return null;
  const k = bankKey(raw).replace(/bank$/, '');
  return (
    banks.find((b) => bankKey(b) === bankKey(raw)) ??
    banks.find((b) => {
      const e = bankKey(b).replace(/bank$/, '');
      return k.length >= 3 && e.length >= 3 && (e.startsWith(k) || k.startsWith(e));
    }) ??
    null
  );
}

/**
 * Writes each bank the way the accounts on file name it, and moves a deposit's maturity onto the one on file when the same person's
 * deposit at that bank for the same amount matures within `days` days.
 */
export function alignDiary(
  notes: DiaryNote[],
  existing: ExistingAsset[],
  days = 7,
): { notes: DiaryNote[]; renamedBanks: number; movedMaturities: number } {
  const banks = [...new Set(existing.map((a) => a.bank).filter((b): b is string => !!b))];
  const nameOf = new Map<string, string>();
  const bankFor = (raw: string): string => {
    const hit = nameOf.get(raw);
    if (hit) return hit;
    const name = bankOnFile(raw, banks) ?? raw;
    nameOf.set(raw, name);
    return name;
  };
  let movedMaturities = 0;
  const deposits = existing.filter((a) => a.fd);
  const out = notes.map((n) => ({
    ...n,
    lines: n.lines.map((l) => {
      const bank = bankFor(l.bank);
      if (l.kind !== 'fd' || !l.maturity) return { ...l, bank };
      const twin = deposits.find(
        (a) =>
          personKey(a.ownerName) === personKey(l.person) &&
          bankKey(a.bank) === bankKey(bank) &&
          Math.abs(a.fd!.principal - l.amount) < 1 &&
          a.fd!.maturityOn !== l.maturity &&
          Math.abs(daysBetween(a.fd!.maturityOn, l.maturity!)) <= days,
      );
      if (!twin) return { ...l, bank };
      movedMaturities++;
      return { ...l, bank, maturity: twin.fd!.maturityOn };
    }),
  }));
  const renamedBanks = [...nameOf.entries()].filter(([a, b]) => a !== b).length;
  return { notes: out, renamedBanks, movedMaturities };
}

/** One tab per note, in the workbook's older layout, with the note's day beside "This Time". */
export function diaryWorkbook(notes: DiaryNote[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const n of notes) {
    const ws = wb.addWorksheet(n.title);
    const set = (ref: string, v: ExcelJS.CellValue) => (ws.getCell(ref).value = v);
    [
      'Bank',
      'Type',
      'Rate',
      'Start Date',
      'Maturity Date',
      'Amount',
      'Maturity Amount',
      'Notes',
    ].forEach((h, i) => set(`${String.fromCharCode(65 + i)}2`, h));
    set('J2', 'Prev Time');
    set('K2', 'This Time');
    set('P7', 'This Time');
    set('Q7', d(n.asOf));
    let r = 3;
    for (const l of n.lines) {
      const group =
        l.kind === 'sg'
          ? l.bank.toUpperCase()
          : l.kind === 'loan' || l.kind === 'memo'
            ? 'Others'
            : `${l.bank} - ${l.person}`;
      set(`A${r}`, group);
      switch (l.kind) {
        case 'fd':
          set(`B${r}`, 'FD');
          if (l.rate !== undefined) set(`C${r}`, l.rate);
          set(`E${r}`, d(l.maturity!));
          break;
        case 'cash':
          set(`B${r}`, 'Cash');
          set(`E${r}`, `Cash-${l.accountKind ?? 'NRE'}`);
          break;
        case 'sg': {
          set(`B${r}`, 'Cash');
          set(`E${r}`, 'Cash SG');
          const base = l.sgd ? Math.round((l.amount / l.sgd) * 10000) / 10000 : null;
          if (l.sgd) set(`H${r}`, `Base: $1= Rs ${base} / Bal : $${l.sgd}`);
          break;
        }
        case 'loan':
          set(`B${r}`, l.label ?? 'Loan');
          set(`E${r}`, 'Cash Loan');
          break;
        case 'memo':
          set(`B${r}`, l.label ?? 'Papa');
          break;
        case 'fund_summary':
          set(`B${r}`, l.label ?? 'SIP & Share');
          break;
      }
      set(`F${r}`, l.amount);
      r++;
    }
  }
  return wb;
}

/**
 * When accounts the notes do not date were opened, from the records themselves: an account first recorded on a day was opened by
 * then, and after the last full snapshot before it (a day on which at least `minAccounts` accounts were recorded but this one was
 * not). An account in the very first snapshot has no lower bound.
 */
export function derivedOpenings(
  records: { assetId: string; asOf: string }[],
  minAccounts = 4,
): Map<string, { by: string; after: string | null }> {
  const first = new Map<string, string>();
  const perDay = new Map<string, Set<string>>();
  for (const r of records) {
    const f = first.get(r.assetId);
    if (!f || r.asOf < f) first.set(r.assetId, r.asOf);
    perDay.set(r.asOf, (perDay.get(r.asOf) ?? new Set()).add(r.assetId));
  }
  const snapshots = [...perDay.entries()]
    .filter(([, ids]) => ids.size >= minAccounts)
    .map(([day]) => day)
    .sort();
  const out = new Map<string, { by: string; after: string | null }>();
  for (const [id, by] of first) {
    const before = snapshots.filter((s) => s < by);
    out.set(id, { by, after: before.length ? before[before.length - 1]! : null });
  }
  return out;
}
