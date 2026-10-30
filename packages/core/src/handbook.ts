/**
 * The family handbook: what the family owns, where it is, who to call and what to do next, in plain language.
 * Generated from the records (and the emergency information you enter in Settings) and stored as a document, so the
 * read-only emergency viewer can open it without access to any financial table.
 *
 * The content is a guide (handbook-guide.ts) whose fixed texts are keys of handbook-text.ts, so the same stored copy reads in
 * English or Hindi, in normal or simple words. It describes; it never moves money. General guidance only, not legal or tax advice,
 * and says so.
 */
import type { BankBlock } from './accounts-view';
import { buildGuide, type Guide } from './handbook-guide';
import { hbSay, hbT } from './handbook-text';

export * from './handbook-guide';
export * from './handbook-text';

export interface Contact {
  name: string;
  relation: string;
  phone: string;
  note: string;
}

export interface EmergencyProfile {
  message: string;
  contacts: Contact[];
  advisors: Contact[];
  willLocation: string;
  documentsLocation: string;
  passwordManager: string;
  devices: string;
  emailAccounts: string;
  lockerDetails: string;
  backupKeyLocation: string;
  nominees: string;
  instructions: string;
}

export const EMPTY_PROFILE: EmergencyProfile = {
  message: '',
  contacts: [],
  advisors: [],
  willLocation: '',
  documentsLocation: '',
  passwordManager: '',
  devices: '',
  emailAccounts: '',
  lockerDetails: '',
  backupKeyLocation: '',
  nominees: '',
  instructions: '',
};

const str = (v: unknown, n = 2000) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
function contactsOf(v: unknown): Contact[] {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[])
    .slice(0, 30)
    .map((c) => ({
      name: str(c.name, 80),
      relation: str(c.relation, 80),
      phone: str(c.phone, 40),
      note: str(c.note, 200),
    }))
    .filter((c) => c.name);
}

/** Reads the saved profile defensively; anything missing is empty text, never an error. */
export function profileFromJson(raw: unknown): EmergencyProfile {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    message: str(o.message, 4000),
    contacts: contactsOf(o.contacts),
    advisors: contactsOf(o.advisors),
    willLocation: str(o.willLocation),
    documentsLocation: str(o.documentsLocation),
    passwordManager: str(o.passwordManager),
    devices: str(o.devices),
    emailAccounts: str(o.emailAccounts),
    lockerDetails: str(o.lockerDetails),
    backupKeyLocation: str(o.backupKeyLocation),
    nominees: str(o.nominees),
    instructions: str(o.instructions, 4000),
  };
}

/** "Name | relationship | phone | note" per line. Lines without a name are ignored. */
export function parseContactLines(text: string): Contact[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.split('|').map((x) => x.trim()))
    .filter((p) => p[0])
    .slice(0, 30)
    .map((p) => ({
      name: p[0]!.slice(0, 80),
      relation: (p[1] ?? '').slice(0, 80),
      phone: (p[2] ?? '').slice(0, 40),
      note: (p[3] ?? '').slice(0, 200),
    }));
}
export const contactLines = (c: Contact[]) =>
  c.map((x) => [x.name, x.relation, x.phone, x.note].join(' | ')).join('\n');

export interface HandbookPerson {
  name: string;
  dob: string | null;
  isMinor: boolean;
  guardian: string | null;
  panLast4: string | null;
  residency: string | null;
}
export interface HandbookFund {
  owner: string;
  fund: string;
  /** the fund's record, to find its nominee */
  assetId?: string;
  /** the fund house (the official AMC name when the scheme is matched) */
  house?: string | null;
  nominee?: string | null;
  value: number | null;
  invested: number | null;
  sipMonthly: number | null;
  sipStopped: boolean;
}
export interface HandbookPolicy {
  id?: string;
  kind: string;
  insurer: string;
  coverage: string;
  insured: string[];
  paidBy: string | null;
  renewalOn: string | null;
  expiresOn: string | null;
  nominee: string | null;
  documents: string | null;
}
export interface HandbookOther {
  owner: string;
  label: string;
  value: number | null;
  note: string | null;
}

export interface HandbookInput {
  asOf: string;
  householdName: string;
  people: HandbookPerson[];
  profile: EmergencyProfile;
  banks: BankBlock[];
  ownerName: Record<string, string>;
  funds: HandbookFund[];
  heldByOthers: HandbookOther[];
  policies: HandbookPolicy[];
  property: HandbookOther[];
  owedToUs: { counterparty: string; outstanding: number; expectedOn: string | null }[];
  properties?: never;
  /** who is registered as nominee, by account, deposit or fund (assets.nominee_note) */
  nominees?: Record<string, string>;
  /** banks and other institutions with their helpline (institutions.helpline) */
  institutions?: { id: string; name: string; helpline: string | null }[];
}

export interface Table {
  headers: string[];
  rows: string[][];
  note?: string | undefined;
}
export interface Section {
  id: string;
  title: string;
  intro?: string;
  paragraphs?: string[];
  steps?: string[];
  tables?: { title?: string; table: Table }[];
}
export interface Handbook {
  title: string;
  asOf: string;
  disclaimer: string;
  /** the guide; a copy stored before the guide existed has only `sections` */
  guide?: Guide;
  /** the earlier layout: plain sections of steps and tables (copies stored before the guide) */
  sections?: Section[];
}

/** The handbook as stored: the guide, plus an English title and disclaimer for anything that reads only those. */
export function buildHandbook(i: HandbookInput): Handbook {
  return {
    title: hbSay(hbT('title', { household: i.householdName })),
    asOf: i.asOf,
    disclaimer: hbSay('disclaimer'),
    guide: buildGuide(i),
  };
}
