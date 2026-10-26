/**
 * Importer for the household "Summary - Bank Reports" workbook (one sheet per month).
 *
 * The importer is a pure planner: it reads the workbook and returns an ImportPlan plus a reconciliation
 * report. It writes nothing. Rules are documented in docs/phase1/02-data-dictionary-and-migration-mapping.md.
 *
 * Principles
 *  - classify rows by what they ARE (column E overloaded), not by column position
 *  - never guess silently: anything ambiguous becomes an exception with a cell reference
 *  - identifiers are masked to the last 4 characters before they leave this module
 *  - every planned value keeps its source cell (`sourceRef`)
 */
import { withChangeRequest } from '@fwos/core';
import ExcelJS from 'exceljs';

// ----------------------------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------------------------
export type Severity = 'info' | 'warning' | 'needs_input';

export interface ImportException {
  code: string;
  severity: Severity;
  cell: string;
  message: string;
}

export interface PlannedOwner {
  key: string;
  displayName: string;
  isMinor: boolean;
}

export interface PlannedInstitution {
  key: string;
  name: string;
  kind: 'bank' | 'amc' | 'insurer' | 'broker' | 'person' | 'other';
}

export type PlannedAssetType =
  | 'bank_account'
  | 'fixed_deposit'
  | 'mutual_fund'
  | 'receivable'
  | 'ulip'
  | 'property'
  | 'third_party_held'
  | 'policy';

export interface PlannedAsset {
  key: string; // stable key used to link observations/FDs inside the plan
  type: PlannedAssetType;
  ownerKey: string;
  beneficialOwnerKey?: string;
  holderName?: string;
  institutionKey?: string;
  nickname: string;
  /** the label exactly as written in the sheet, e.g. "FD-NRE JO-0278" */
  label?: string;
  /** sheet row: the order you keep your accounts in */
  row?: number;
  /** joint with a spouse or child ("JO" in the sheet) */
  isJoint?: boolean;
  identifierLast4?: string;
  accountKind?: 'NRE' | 'NRO' | 'SB' | 'joint' | 'other';
  currency: 'INR' | 'SGD';
  status: 'active' | 'matured_unconfirmed' | 'stopped';
  notes?: string;
  sourceRef: string;
}

export interface PlannedObservation {
  assetKey: string;
  kind: 'balance' | 'valuation';
  amount: number; // in the asset's own currency
  currency: 'INR' | 'SGD';
  fxRate?: number; // INR per unit
  asOf: string; // YYYY-MM-DD
  confidence: 'manual_unverified';
  sourceRef: string;
}

export interface PlannedFd {
  assetKey: string;
  principal: number;
  rate: number;
  bookedOn: string;
  maturityOn: string;
  bankMaturityAmount: number;
  compounding: 'quarterly';
  refLast4?: string;
  /** the full deposit number as written in the sheet (deposit numbers are shown in full; account numbers and PANs are not) */
  ref?: string;
  sourceRef: string;
}

export interface PlannedFund {
  assetKey: string;
  fundName: string;
  planType: 'direct' | 'regular_or_unknown';
  holderKey: string; // PAN holder
  goalTag: string;
  currentValue: number;
  invested: number;
  startedOn: string | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  navHint: string | null;
  sourceRef: string;
}

export interface PlannedReceivable {
  assetKey: string;
  counterparty: string;
  lent: number;
  lentOn: string | null;
  repayments: { amount: number; on: string }[];
  expectedOn: string | null;
  outstanding: number;
  sourceRef: string;
}

export interface PlannedPolicy {
  kind: 'term' | 'health_sg' | 'health_in' | 'ulip' | 'nps';
  insurer: string;
  coverage: string;
  insuredKeys: string[];
  paidBy?: string;
  note?: string;
  sourceRef: string;
}

export interface PlannedProperty {
  assetKey: string;
  name: string;
  value: number;
  valuedOn: string;
  sourceRef: string;
}

export interface PlannedTask {
  title: string;
  status: 'open' | 'done';
  institutionKey?: string;
  ownerKey?: string;
  sourceRef: string;
}

export interface ControlTotals {
  sheetSumF: number | null; // the workbook's own SUM(F3:F113)
  importedF: number; // our sum of every classified F
  fdPrincipal: number;
  fdMaturityValue: number;
  sheetFdPrincipal: number | null; // from the pasted summary block
  sheetFdMaturity: number | null;
  cashNre: number;
  cashNro: number;
  cashSgInr: number;
  loans: number;
  funds: number;
  ulip: number;
  thirdParty: number;
  goalTotals: Record<string, number>;
  sheetGoalTotals: Record<string, number>;
}

export interface ImportPlan {
  asOf: string;
  owners: PlannedOwner[];
  institutions: PlannedInstitution[];
  assets: PlannedAsset[];
  observations: PlannedObservation[];
  fixedDeposits: PlannedFd[];
  funds: PlannedFund[];
  receivables: PlannedReceivable[];
  policies: PlannedPolicy[];
  properties: PlannedProperty[];
  tasks: PlannedTask[];
  exceptions: ImportException[];
  controlTotals: ControlTotals;
  reconciliation: { check: string; expected: number | null; actual: number; ok: boolean }[];
}

export interface ImportOptions {
  /** Date the balances in the workbook represent. Default: today's date supplied by the caller. */
  asOf: string;
  sheetName?: string;
  /** Owner assumed for rows whose owner is not stated in the workbook (Singapore banks, loans, third-party). */
  defaultOwner?: string;
  /** Your confirmed answers to ambiguous cells, keyed by cell ref. */
  resolutions?: Record<string, string>;
  /** Names of people who are owners in the household. */
  ownerNames?: string[];
  minors?: string[];
}

// ----------------------------------------------------------------------------------------------
// Cell helpers
// ----------------------------------------------------------------------------------------------
type Raw = string | number | Date | null;

function cellValue(ws: ExcelJS.Worksheet, ref: string): Raw {
  const v = ws.getCell(ref).value as unknown;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return o.result as Raw;
    if (typeof o.text === 'string') return o.text;
  }
  return null;
}

const str = (v: Raw): string =>
  (v === null || v instanceof Date ? '' : String(v)).replace(/\s+/g, ' ').trim();
const num = (v: Raw): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Replace long digit runs (account/policy/FD numbers) with their last 4 digits. */
export function maskIdentifiers(s: string): string {
  // "300017790142-1": the digits after the hyphen are a sub-deposit suffix, not part of the number
  return s.replace(/(\d{6,})(?:-\d+)?/g, (_m, main: string) => '…' + main.slice(-4));
}

/** The row's note, with the sheet's "Changes Req" for that row written in so it stays with the account. */
function rowNotes(N: string | null | undefined, M: string | null | undefined): { notes?: string } {
  const n = withChangeRequest(N ? maskIdentifiers(N) : null, M ? maskIdentifiers(M) : null);
  return n ? { notes: n } : {};
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
function parseTextDate(s: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(s);
  if (!m) return null;
  const mon = MONTHS[m[2]!.toLowerCase()];
  if (mon === undefined) return null;
  return iso(new Date(Date.UTC(Number(m[3]), mon, Number(m[1]))));
}

// ----------------------------------------------------------------------------------------------
// Parsing
// ----------------------------------------------------------------------------------------------
const DEFAULT_OWNERS = ['Rupash', 'Ragini', 'Advika', 'Viraj'];
const DEFAULT_MINORS = ['Advika', 'Viraj'];

interface Group {
  raw: string;
  institution: string | null;
  owner: string | null; // legal owner (or PAN holder for SIP groups)
  goalPerson: string | null;
  holder: string | null; // someone else's name when the account is not ours
  kind: 'bank' | 'sip' | 'person' | 'sg_bank' | 'others';
}

function parseGroup(raw: string, owners: string[]): Group {
  const first = raw.split('\n')[0]!.replace(/\s+/g, ' ').trim();
  const sip = /^SIP\s*-\s*([A-Za-z]+)(?:\s*\(([A-Za-z]+)\))?/i.exec(first);
  if (sip) {
    const who = sip[1]!;
    const holder = sip[2] ?? who;
    return { raw, institution: null, owner: holder, goalPerson: who, holder: null, kind: 'sip' };
  }
  if (/^others$/i.test(first))
    return { raw, institution: null, owner: null, goalPerson: null, holder: null, kind: 'others' };
  if (/^(UOB|DBS)$/i.test(first))
    return {
      raw,
      institution: first.toUpperCase(),
      owner: null,
      goalPerson: null,
      holder: null,
      kind: 'sg_bank',
    };
  const atul = /^Atul\s+(.+)$/i.exec(first);
  if (atul)
    return {
      raw,
      institution: atul[1]!.trim(),
      owner: null,
      goalPerson: null,
      holder: 'Atul',
      kind: 'person',
    };
  const bank = /^(.+?)\s*-\s*([A-Za-z]+)$/.exec(first);
  if (bank && owners.some((o) => o.toLowerCase() === bank[2]!.toLowerCase())) {
    const owner = owners.find((o) => o.toLowerCase() === bank[2]!.toLowerCase())!;
    return {
      raw,
      institution: bank[1]!.trim(),
      owner,
      goalPerson: null,
      holder: null,
      kind: 'bank',
    };
  }
  // third-party counterparties (e.g. "Anup Pratap Singh", "Finvasia (Atul)")
  return {
    raw,
    institution: null,
    owner: null,
    goalPerson: null,
    holder: first.replace(/\s*\(.*\)$/, ''),
    kind: 'person',
  };
}

function accountKindOf(label: string): 'NRE' | 'NRO' | undefined {
  if (/NRE/i.test(label)) return 'NRE';
  if (/NRO/i.test(label)) return 'NRO';
  return undefined;
}
const isJoint = (label: string) => /\bJO\b|JO-/i.test(label);
function last4Of(label: string): string | undefined {
  const m = /(\d{4})(?!.*\d{4})/.exec(label);
  return m ? m[1] : undefined;
}
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export async function planWorkbook(
  source: string | Buffer | Uint8Array,
  opts: ImportOptions,
): Promise<ImportPlan> {
  const wb = new ExcelJS.Workbook();
  if (typeof source === 'string') await wb.xlsx.readFile(source);
  else await wb.xlsx.load(source as unknown as ArrayBuffer);
  const ws = opts.sheetName ? wb.getWorksheet(opts.sheetName) : wb.worksheets[0];
  if (!ws) throw new Error(`worksheet not found${opts.sheetName ? `: ${opts.sheetName}` : ''}`);

  const ownerNames = opts.ownerNames ?? DEFAULT_OWNERS;
  const minors = new Set((opts.minors ?? DEFAULT_MINORS).map((m) => m.toLowerCase()));
  const defaultOwner = opts.defaultOwner ?? ownerNames[0]!;
  const resolutions = opts.resolutions ?? {};
  const asOf = opts.asOf;

  const exceptions: ImportException[] = [];
  const ex = (code: string, severity: Severity, cell: string, message: string) =>
    exceptions.push({ code, severity, cell, message });

  const owners = new Map<string, PlannedOwner>();
  const ownerKey = (name: string) => {
    const k = slug(name);
    if (!owners.has(k))
      owners.set(k, { key: k, displayName: name, isMinor: minors.has(name.toLowerCase()) });
    return k;
  };
  for (const n of ownerNames) ownerKey(n);

  const institutions = new Map<string, PlannedInstitution>();
  const instKey = (name: string, kind: PlannedInstitution['kind'] = 'bank') => {
    const k = slug(name);
    if (!institutions.has(k)) institutions.set(k, { key: k, name, kind });
    return k;
  };

  const assets: PlannedAsset[] = [];
  const observations: PlannedObservation[] = [];
  const fixedDeposits: PlannedFd[] = [];
  const funds: PlannedFund[] = [];
  const receivables: PlannedReceivable[] = [];
  const policies: PlannedPolicy[] = [];
  const properties: PlannedProperty[] = [];
  const tasks: PlannedTask[] = [];

  const usedNicknames = new Map<string, number>();
  const uniqueNickname = (
    instK: string | undefined,
    ownerK: string,
    type: string,
    nick: string,
    cell: string,
  ) => {
    const key = `${instK ?? ''}|${ownerK}|${type}|${nick}`;
    const n = (usedNicknames.get(key) ?? 0) + 1;
    usedNicknames.set(key, n);
    if (n === 1) return nick;
    ex(
      'duplicate_nickname',
      'warning',
      cell,
      `Two rows share the label "${nick}"; the second was renamed with its row number.`,
    );
    return `${nick} #${cell.replace(/\D/g, '')}`;
  };

  let group: Group | null = null;
  const fdRefs = new Map<string, string>();
  let importedF = 0;
  const goalTotals: Record<string, number> = {};
  let fdPrincipal = 0,
    fdMaturity = 0,
    cashNre = 0,
    cashNro = 0,
    cashSgInr = 0,
    loans = 0,
    fundsTotal = 0,
    ulipTotal = 0,
    thirdParty = 0;

  // -------------------------------------------------------------------------------------------
  // Register block: rows 3..113
  // -------------------------------------------------------------------------------------------
  for (let r = 3; r <= 113; r++) {
    const a = cellValue(ws, `A${r}`);
    if (str(a)) group = parseGroup(String(a), ownerNames);
    const B = str(cellValue(ws, `B${r}`));
    const Cc = cellValue(ws, `C${r}`);
    const D = cellValue(ws, `D${r}`);
    const E = cellValue(ws, `E${r}`);
    const F = num(cellValue(ws, `F${r}`));
    const G = num(cellValue(ws, `G${r}`));
    const H = num(cellValue(ws, `H${r}`));
    const M = str(cellValue(ws, `M${r}`));
    const N = str(cellValue(ws, `N${r}`));
    const Nraw = String(cellValue(ws, `N${r}`) ?? '');
    const cell = (c: string) => `${c}${r}`;

    // Tasks from "Changes Req" (column M) apply to the current group
    if (M && group) {
      const instK = group.institution ? instKey(group.institution) : undefined;
      tasks.push({
        title: M,
        status: /completed/i.test(M) ? 'done' : 'open',
        ...(instK ? { institutionKey: instK } : {}),
        ...(group.owner ? { ownerKey: ownerKey(group.owner) } : {}),
        sourceRef: cell('M'),
      });
    }

    if (!B && F === null) continue;
    if (!group) {
      ex(
        'row_without_group',
        'warning',
        cell('B'),
        `Row "${B}" appears before any institution heading and was skipped.`,
      );
      continue;
    }

    const eStr = E instanceof Date ? '' : str(E);

    // R7: placeholder rows with no amount
    if (F === null) {
      if (B) ex('empty_placeholder', 'info', cell('B'), `"${B}" has no amount and was skipped.`);
      continue;
    }

    // R1: FD
    if (E instanceof Date) {
      const ownerName = group.owner ?? defaultOwner;
      const D_ = D instanceof Date ? D : null;
      const rate = num(Cc);
      if (!D_ || rate === null || G === null || !group.institution) {
        ex(
          'fd_incomplete',
          'needs_input',
          cell('B'),
          `FD "${B}" is missing a start date, rate, maturity value or institution; not imported.`,
        );
        continue;
      }
      importedF += F;
      const kind = accountKindOf(B);
      if (!kind)
        ex('account_kind_unknown', 'warning', cell('B'), `FD "${B}" does not say NRE or NRO.`);
      const joint = isJoint(B);
      const instK = instKey(group.institution);
      const ownerK = ownerKey(ownerName);
      const matured = E.getTime() <= new Date(asOf + 'T00:00:00Z').getTime();
      const fdRef = /FD\s*Number\s*:\s*([\d,\-\s]+)/i.exec(Nraw);
      const firstRef = fdRef ? fdRef[1]!.split(',')[0]!.replace(/\s/g, '') : '';
      const refDigits = firstRef.split('-')[0]!.replace(/\D/g, '');
      const refLast4 = refDigits ? refDigits.slice(-4) : undefined;
      if (refDigits) {
        const dupKey = `${instK}|${ownerK}|${firstRef}`;
        if (fdRefs.has(dupKey))
          ex(
            'duplicate_fd_reference',
            'needs_input',
            cell('N'),
            `FD reference ending …${refLast4} also appears at ${fdRefs.get(dupKey)}; one of them is probably a copy error.`,
          );
        else fdRefs.set(dupKey, cell('N'));
      }
      const baseNick = `${B || 'FD'} (${iso(D_)}, ${F.toLocaleString('en-IN')})`;
      const nick = uniqueNickname(instK, ownerK, 'fixed_deposit', baseNick, cell('B'));
      const key = `fd:${r}`;
      assets.push({
        key,
        type: 'fixed_deposit',
        ownerKey: ownerK,
        institutionKey: instK,
        nickname: nick,
        label: B,
        row: r,
        isJoint: joint,
        ...(last4Of(B) ? { identifierLast4: last4Of(B)! } : {}),
        ...(kind ? { accountKind: kind } : joint ? { accountKind: 'joint' as const } : {}),
        currency: 'INR',
        status: matured ? 'matured_unconfirmed' : 'active',
        ...rowNotes(N, M),
        sourceRef: cell('B'),
      });
      fixedDeposits.push({
        assetKey: key,
        principal: F,
        rate,
        bookedOn: iso(D_),
        maturityOn: iso(E),
        bankMaturityAmount: G,
        compounding: 'quarterly',
        ...(refLast4 ? { refLast4 } : {}),
        ...(refDigits.length >= 4 && /^[A-Za-z0-9-]{4,40}$/.test(firstRef)
          ? { ref: firstRef }
          : {}),
        sourceRef: cell('B'),
      });
      fdPrincipal += F;
      fdMaturity += G;
      if (matured)
        ex(
          'fd_matured_unconfirmed',
          'needs_input',
          cell('E'),
          `FD "${B}" at ${group.institution} (${ownerName}) matured on ${iso(E)} but is still listed. Excluded from net worth until you confirm where the proceeds went.`,
        );
      continue;
    }

    // R2: Indian bank balances
    if (/^Cash-NR[EO]$/i.test(eStr)) {
      importedF += F;
      const kind = eStr.slice(-3).toUpperCase() as 'NRE' | 'NRO';
      const ownerName = group.owner;
      const thirdPartyAcct = group.kind === 'person' && group.holder;
      const label = B || 'Cash';
      if (thirdPartyAcct) {
        const ownerK = ownerKey(defaultOwner);
        const instK = group.institution ? instKey(group.institution) : undefined;
        const key = `tp:${r}`;
        assets.push({
          key,
          type: 'third_party_held',
          ownerKey: ownerK,
          beneficialOwnerKey: ownerK,
          holderName: group.holder!,
          ...(instK ? { institutionKey: instK } : {}),
          nickname: uniqueNickname(
            instK,
            ownerK,
            'third_party_held',
            `Account held by ${group.holder}`,
            cell('B'),
          ),
          accountKind: kind,
          currency: 'INR',
          status: 'active',
          ...rowNotes(N, M),
          sourceRef: cell('B'),
        });
        observations.push({
          assetKey: key,
          kind: 'balance',
          amount: F,
          currency: 'INR',
          asOf,
          confidence: 'manual_unverified',
          sourceRef: cell('F'),
        });
        thirdParty += F;
        ex(
          'third_party_account',
          'warning',
          cell('A'),
          `Money held in an account in ${group.holder}'s name is shown as third-party-held (beneficial owner ${defaultOwner}); please review with your CA.`,
        );
        if (kind === 'NRO') cashNro += F;
        else cashNre += F;
        continue;
      }
      if (!ownerName || !group.institution) {
        ex(
          'cash_owner_unknown',
          'needs_input',
          cell('B'),
          `Balance "${label}" has no owner/institution context; not imported.`,
        );
        continue;
      }
      const ownerK = ownerKey(ownerName);
      const instK = instKey(group.institution);
      const key = `cash:${r}`;
      const joint = isJoint(label);
      assets.push({
        key,
        type: 'bank_account',
        ownerKey: ownerK,
        institutionKey: instK,
        nickname: uniqueNickname(
          instK,
          ownerK,
          'bank_account',
          `${label} ${kind}`.replace(/\s+/g, ' '),
          cell('B'),
        ),
        label,
        row: r,
        isJoint: joint,
        ...(last4Of(label) ? { identifierLast4: last4Of(label)! } : {}),
        accountKind: kind,
        currency: 'INR',
        status: 'active',
        ...rowNotes(N, M),
        sourceRef: cell('B'),
      });
      observations.push({
        assetKey: key,
        kind: 'balance',
        amount: F,
        currency: 'INR',
        asOf,
        confidence: 'manual_unverified',
        sourceRef: cell('F'),
      });
      if (kind === 'NRO') cashNro += F;
      else cashNre += F;
      continue;
    }

    // R3: Singapore balances
    if (/^Cash SG$/i.test(eStr)) {
      importedF += F;
      const sgd = /Bal\s*:\s*\$\s*([\d,]+(?:\.\d+)?)/i.exec(Nraw);
      const base = /\$\s*1\s*=\s*Rs\.?\s*([\d.]+)/i.exec(Nraw);
      const ownerK = ownerKey(group.owner ?? defaultOwner);
      if (!group.owner)
        ex(
          'owner_assumed',
          'warning',
          cell('A'),
          `Owner of ${group.institution} is not stated; assumed ${defaultOwner}.`,
        );
      const instK = instKey(group.institution ?? B);
      const key = `sg:${r}`;
      assets.push({
        key,
        type: 'bank_account',
        ownerKey: ownerK,
        institutionKey: instK,
        nickname: `${group.institution} S$ account`,
        currency: 'SGD',
        accountKind: 'other',
        status: 'active',
        ...rowNotes(N, M),
        sourceRef: cell('B'),
      });
      if (sgd && base) {
        const amount = Number(sgd[1]!.replace(/,/g, ''));
        const rate = Number(base[1]);
        if (Math.abs(amount * rate - F) > 1)
          ex(
            'fx_mismatch',
            'warning',
            cell('F'),
            `S$${amount} at ₹${rate} = ₹${(amount * rate).toFixed(2)}, but the sheet says ₹${F}.`,
          );
        observations.push({
          assetKey: key,
          kind: 'balance',
          amount,
          currency: 'SGD',
          fxRate: rate,
          asOf,
          confidence: 'manual_unverified',
          sourceRef: cell('N'),
        });
      } else {
        ex(
          'sgd_amount_missing',
          'needs_input',
          cell('N'),
          `Could not read the S$ balance and rate from the note; please enter the S$ amount.`,
        );
      }
      cashSgInr += F;
      continue;
    }

    // R4: Mutual funds / ULIP
    if (/^SIP/i.test(eStr)) {
      importedF += F;
      const holder = group.owner ?? defaultOwner;
      const holderK = ownerKey(holder);
      const stopped = /\(STOPPED\)/i.test(B);
      const name = B.replace(/\(STOPPED\)/i, '').trim();
      const isUlip = /wealth smart plus/i.test(name);
      const key = `${isUlip ? 'ulip' : 'mf'}:${r}`;
      const sip = /(\d+)\s*K\s*\/\s*Month/i.exec(N);
      const nav = /NAV\s*-?\s*([\d.]+)/i.exec(N);
      const started = D instanceof Date ? iso(D) : null;
      assets.push({
        key,
        type: isUlip ? 'ulip' : 'mutual_fund',
        ownerKey: holderK,
        nickname: uniqueNickname(
          undefined,
          holderK,
          isUlip ? 'ulip' : 'mutual_fund',
          name,
          cell('B'),
        ),
        currency: 'INR',
        status: stopped ? 'stopped' : 'active',
        ...rowNotes(N, M),
        sourceRef: cell('B'),
      });
      observations.push({
        assetKey: key,
        kind: 'valuation',
        amount: F,
        currency: 'INR',
        asOf,
        confidence: 'manual_unverified',
        sourceRef: cell('F'),
      });
      goalTotals[eStr] = (goalTotals[eStr] ?? 0) + F;
      if (isUlip) {
        ulipTotal += F;
      } else {
        fundsTotal += F;
        funds.push({
          assetKey: key,
          fundName: name,
          planType: /direct/i.test(name) ? 'direct' : 'regular_or_unknown',
          holderKey: holderK,
          goalTag: eStr,
          currentValue: F,
          invested: H ?? 0,
          startedOn: started,
          sipMonthly: sip && !stopped ? Number(sip[1]) * 1000 : null,
          sipStopped: stopped,
          navHint: nav ? nav[1]! : null,
          sourceRef: cell('B'),
        });
        if (
          started &&
          new Date(started).getUTCMonth() === 0 &&
          new Date(started).getUTCDate() === 4 &&
          new Date(started).getUTCFullYear() === 2026
        ) {
          ex(
            'sip_start_date_ambiguous',
            'needs_input',
            cell('D'),
            `SIP start date ${started} may be a day/month swap (invested amount suggests fewer instalments).`,
          );
        }
      }
      if (cellValue(ws, `J${r}`))
        ex(
          'unexplained_marker',
          'info',
          cell('J'),
          `Marker "${str(cellValue(ws, `J${r}`))}" has no known meaning; ignored.`,
        );
      continue;
    }

    // R5: Loans given
    if (/^Cash Loan$/i.test(eStr)) {
      importedF += F;
      const ownerK = ownerKey(defaultOwner);
      const key = `loan:${r}`;
      const repayMatch =
        /(?:gave|lent)\s*([\d,]+)\s*k?[^.]*?return(?:ed)?\s*([\d,]+)\s*k?[^.]*?on\s*(\d{1,2}\s+\w+\s+\d{4})/i.exec(
          Nraw.replace(/\n/g, ' '),
        );
      let lent = F;
      const repayments: { amount: number; on: string }[] = [];
      let expectedOn: string | null = null;
      const lentOn: string | null = Cc instanceof Date ? iso(Cc) : null;
      if (repayMatch) {
        const toRupees = (s: string) => {
          const v = Number(s.replace(/,/g, ''));
          return v < 1000 ? v * 1000 : v;
        };
        const g = toRupees(repayMatch[1]!),
          p = toRupees(repayMatch[2]!);
        const on = parseTextDate(repayMatch[3]!);
        if (on && g - p === F) {
          lent = g;
          repayments.push({ amount: p, on });
        } else
          ex(
            'loan_note_unreconciled',
            'needs_input',
            cell('N'),
            `Note "${N}" does not reconcile with the balance ₹${F}.`,
          );
      } else if (/returned on/i.test(Nraw)) {
        const when = parseTextDate(Nraw.slice(Nraw.search(/returned on/i)));
        const res = resolutions[cell('F')] ?? (when ? 'expected_repayment' : undefined);
        if (res === 'expected_repayment' && when) {
          expectedOn = when;
          ex(
            'loan_expected_repayment',
            'info',
            cell('N'),
            `Note says "Returned on ${when}"; you confirmed it was NOT received, so it stays outstanding and is overdue.`,
          );
        } else {
          ex(
            'loan_repayment_ambiguous',
            'needs_input',
            cell('N'),
            `Note "${N}" is ambiguous: repayment received, or expected date? Kept as outstanding.`,
          );
        }
      }
      if (/^Papa$/i.test(B)) continue;
      assets.push({
        key,
        type: 'receivable',
        ownerKey: ownerK,
        nickname: uniqueNickname(
          undefined,
          ownerK,
          'receivable',
          `${B} (${lentOn ?? 'row ' + r})`,
          cell('B'),
        ),
        currency: 'INR',
        status: 'active',
        ...(N ? { notes: maskIdentifiers(N) } : {}),
        sourceRef: cell('B'),
      });
      observations.push({
        assetKey: key,
        kind: 'valuation',
        amount: F,
        currency: 'INR',
        asOf,
        confidence: 'manual_unverified',
        sourceRef: cell('F'),
      });
      receivables.push({
        assetKey: key,
        counterparty: B,
        lent,
        lentOn,
        repayments,
        expectedOn,
        outstanding: F,
        sourceRef: cell('F'),
      });
      loans += F;
      if (!group.owner)
        ex(
          'owner_assumed',
          'info',
          cell('A'),
          `Loan "${B}" has no stated owner; assumed ${defaultOwner}.`,
        );
      continue;
    }

    // R6: Third-party-held / trading positions
    if (/^(Shares|Options & Future)$/i.test(eStr)) {
      importedF += F;
      const ownerK = ownerKey(defaultOwner);
      const holder = group.holder ?? B;
      const key = `tp:${r}`;
      assets.push({
        key,
        type: 'third_party_held',
        ownerKey: ownerK,
        beneficialOwnerKey: ownerK,
        holderName: holder,
        nickname: uniqueNickname(
          undefined,
          ownerK,
          'third_party_held',
          `${B} (${holder})`,
          cell('B'),
        ),
        currency: 'INR',
        status: 'active',
        ...(N ? { notes: maskIdentifiers(N.replace(/\n/g, ' ')) } : {}),
        sourceRef: cell('B'),
      });
      observations.push({
        assetKey: key,
        kind: 'valuation',
        amount: F,
        currency: 'INR',
        asOf,
        confidence: 'manual_unverified',
        sourceRef: cell('F'),
      });
      thirdParty += F;
      ex(
        'third_party_position',
        'warning',
        cell('A'),
        `"${B}" is managed by ${holder}; imported as third-party-held and excluded from liquid/investable until you confirm.`,
      );
      continue;
    }

    // R7: memo rows
    if (/^Papa$/i.test(B)) {
      ex(
        'memo_ignored',
        'info',
        cell('B'),
        `Memo row "${B}" (family support record) is not an asset and was not imported.`,
      );
      continue;
    }

    ex(
      'unclassified_row',
      'needs_input',
      cell('B'),
      `Row "${B}" (amount ${F}) did not match any import rule.`,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Plans block: insurance, ULIP, NPS, property (rows 118..124)
  // -------------------------------------------------------------------------------------------
  const peopleCols: Record<string, string> = { B: 'Rupash', D: 'Ragini', F: 'Advika', N: 'Viraj' };
  const plan = (row: number, label: RegExp, kind: PlannedPolicy['kind']) => {
    if (!label.test(str(cellValue(ws, `A${row}`)))) return;
    // The sheet repeats one policy across several people's columns (merged cells / family floaters): one policy, many insured.
    const byText = new Map<string, { cols: string[]; text: string }>();
    for (const col of Object.keys(peopleCols)) {
      const text = str(cellValue(ws, `${col}${row}`));
      if (!text) continue;
      const g = byText.get(text) ?? { cols: [], text };
      g.cols.push(col);
      byText.set(text, g);
    }
    for (const { cols, text } of byText.values()) {
      const insurer = text.split(/\s+-\s+/)[0]!.trim();
      const paidBy = /By Company\s+([A-Za-z ]+)/i.exec(text)?.[1]?.trim();
      policies.push({
        kind,
        insurer,
        coverage: maskIdentifiers(text),
        insuredKeys: cols.map((c) => ownerKey(peopleCols[c]!)),
        ...(paidBy ? { paidBy } : {}),
        sourceRef: `${cols[0]}${row}`,
      });
    }
  };
  plan(119, /Term/i, 'term');
  plan(120, /Health.*Singapore/i, 'health_sg');
  plan(121, /Health.*India/i, 'health_in');
  if (/ULIP/i.test(str(cellValue(ws, 'A122')))) {
    policies.push({
      kind: 'ulip',
      insurer: 'Aditya Birla',
      coverage: 'Wealth Smart Plus (policy stopped)',
      insuredKeys: [ownerKey('Rupash')],
      note: 'Value counted once, from the fund block (not here).',
      sourceRef: 'B122',
    });
  }
  if (/NPS/i.test(str(cellValue(ws, 'A123'))) && !str(cellValue(ws, 'B123'))) {
    ex(
      'nps_empty',
      'info',
      'A123',
      'NPS row is empty; nothing imported (confirm that you have no NPS account).',
    );
  }
  const house = str(cellValue(ws, 'D124'));
  if (house) {
    const priceText = str(cellValue(ws, 'E124'));
    const lakh = /([\d.]+)\s*Lakh/i.exec(priceText);
    const when = parseTextDate(priceText);
    if (lakh && when) {
      const ownerK = ownerKey(defaultOwner);
      const key = 'property:124';
      assets.push({
        key,
        type: 'property',
        ownerKey: ownerK,
        nickname: house.replace(/\s+,/g, ','),
        currency: 'INR',
        status: 'active',
        notes: priceText,
        sourceRef: 'D124',
      });
      const value = Number(lakh[1]) * 100_000;
      observations.push({
        assetKey: key,
        kind: 'valuation',
        amount: value,
        currency: 'INR',
        asOf: when,
        confidence: 'manual_unverified',
        sourceRef: 'E124',
      });
      properties.push({ assetKey: key, name: house, value, valuedOn: when, sourceRef: 'E124' });
      ex(
        'property_value_is_purchase_price',
        'warning',
        'E124',
        `Property is valued at its purchase price (₹${value.toLocaleString('en-IN')} on ${when}); please provide a current estimate.`,
      );
    } else
      ex(
        'property_unparsed',
        'needs_input',
        'E124',
        `Could not read the property price from "${priceText}".`,
      );
  }

  // -------------------------------------------------------------------------------------------
  // Reconciliation against the workbook's own summaries
  // -------------------------------------------------------------------------------------------
  const sheetNum = (ref: string): number | null => num(cellValue(ws, ref));
  const sheetGoalTotals: Record<string, number> = {};
  for (let r = 39; r <= 52; r++) {
    const label = str(cellValue(ws, `V${r}`));
    const v = sheetNum(`W${r}`);
    if (/^SIP /i.test(label) && v !== null) sheetGoalTotals[label] = v;
  }
  const ct: ControlTotals = {
    sheetSumF: sheetNum('F114'),
    importedF: Math.round(importedF * 100) / 100,
    fdPrincipal,
    fdMaturityValue: fdMaturity,
    sheetFdPrincipal: sheetNum('AA29'),
    sheetFdMaturity: sheetNum('AB29'),
    cashNre,
    cashNro,
    cashSgInr,
    loans,
    funds: fundsTotal,
    ulip: ulipTotal,
    thirdParty,
    goalTotals: Object.fromEntries(
      Object.entries(goalTotals).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
    sheetGoalTotals,
  };
  const reconciliation: ImportPlan['reconciliation'] = [];
  const check = (name: string, expected: number | null, actual: number) =>
    reconciliation.push({
      check: name,
      expected,
      actual,
      ok: expected !== null && Math.abs(expected - actual) < 1,
    });
  check('Sum of all classified amounts equals the sheet total (F114)', ct.sheetSumF, ct.importedF);
  check('FD principal equals the sheet summary (AA29)', ct.sheetFdPrincipal, ct.fdPrincipal);
  check(
    'FD maturity value equals the sheet summary (AB29)',
    ct.sheetFdMaturity,
    ct.fdMaturityValue,
  );
  check('Singapore cash equals the sheet category (W40)', sheetNum('W40'), ct.cashSgInr);
  check('NRE cash equals the sheet category (W41)', sheetNum('W41'), ct.cashNre);
  check('NRO cash equals the sheet category (W42)', sheetNum('W42'), ct.cashNro);
  check('Loans equal the sheet category (W39)', sheetNum('W39'), ct.loans);
  for (const [label, v] of Object.entries(sheetGoalTotals))
    check(`Goal "${label}" equals the sheet total`, v, ct.goalTotals[label] ?? 0);

  // every asset remembers its sheet row (your order) and the label exactly as you wrote it
  for (const a of assets) {
    if (a.row === undefined) {
      const m = /:(\d+)$/.exec(a.key);
      if (m) a.row = Number(m[1]);
    }
    if (!a.label) a.label = a.nickname;
  }

  return {
    asOf,
    owners: [...owners.values()],
    institutions: [...institutions.values()],
    assets,
    observations,
    fixedDeposits,
    funds,
    receivables,
    policies,
    properties,
    tasks,
    exceptions,
    controlTotals: ct,
    reconciliation,
  };
}

/** Plain-text report for review before anything is saved. */
export function formatReport(p: ImportPlan): string {
  const L: string[] = [];
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  L.push(`WORKBOOK IMPORT — DRY RUN (balances as of ${p.asOf})`, '');
  L.push(
    `Owners ${p.owners.length} · institutions ${p.institutions.length} · assets ${p.assets.length} · observations ${p.observations.length} · FDs ${p.fixedDeposits.length} · funds ${p.funds.length} · receivables ${p.receivables.length} · policies ${p.policies.length} · tasks ${p.tasks.length}`,
    '',
  );
  L.push('RECONCILIATION');
  for (const c of p.reconciliation)
    L.push(
      `  ${c.ok ? 'PASS' : 'FAIL'}  ${c.check}: expected ${c.expected === null ? 'n/a' : inr(c.expected)}, imported ${inr(c.actual)}`,
    );
  L.push('', 'EXCEPTIONS');
  const order: Severity[] = ['needs_input', 'warning', 'info'];
  for (const s of order) {
    const list = p.exceptions.filter((e) => e.severity === s);
    if (!list.length) continue;
    L.push(`  [${s}] ${list.length}`);
    for (const e of list) L.push(`    ${e.cell.padEnd(6)} ${e.code}: ${e.message}`);
  }
  return L.join('\n');
}

/** The deposit numbers in a plan, as rows for `set_fd_numbers`: each is matched in the database by bank and last four digits. */
export function fdNumbersFromPlan(
  plan: ImportPlan,
): { bank: string; last4: string; fdRef: string }[] {
  const bankOf = new Map<string, string>();
  const nameOf = new Map(plan.institutions.map((i) => [i.key, i.name]));
  for (const a of plan.assets) bankOf.set(a.key, nameOf.get(a.institutionKey ?? '') ?? '');
  return plan.fixedDeposits.flatMap((f) => {
    const bank = bankOf.get(f.assetKey);
    return f.ref && f.refLast4 && bank ? [{ bank, last4: f.refLast4, fdRef: f.ref }] : [];
  });
}
