/**
 * The family handbook: what the family owns, where it is, who to call and what to do next, in plain language.
 * Generated from the records (and the emergency information you enter in Settings) and stored as a document, so the
 * read-only emergency viewer can open it without access to any financial table.
 *
 * It describes; it never moves money. General guidance only, not legal or tax advice, and says so.
 */
import { formatInr } from './money';
import type { BankBlock } from './accounts-view';

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
  value: number | null;
  invested: number | null;
  sipMonthly: number | null;
  sipStopped: boolean;
}
export interface HandbookPolicy {
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
  sections: Section[];
}

const inr = (n: number | null) => (n === null ? 'not recorded' : formatInr(Math.round(n)));
const long = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const age = (dob: string, asOf: string) => {
  const d = new Date(`${dob}T00:00:00Z`);
  const t = new Date(`${asOf}T00:00:00Z`);
  let a = t.getUTCFullYear() - d.getUTCFullYear();
  if (
    t.getUTCMonth() < d.getUTCMonth() ||
    (t.getUTCMonth() === d.getUTCMonth() && t.getUTCDate() < d.getUTCDate())
  )
    a--;
  return a;
};
const list = (xs: string[]) => (xs.length === 0 ? 'none recorded' : xs.join(', '));

export function buildHandbook(i: HandbookInput): Handbook {
  const p = i.profile;
  const sections: Section[] = [];

  // ---- totals
  const bankTotal = i.banks.reduce((s, b) => s + b.totals.cash, 0);
  const fdTotal = i.banks.reduce((s, b) => s + b.totals.fdCurrent, 0);
  const fundTotal = i.funds.reduce((s, f) => s + (f.value ?? 0), 0);
  const propTotal = i.property.reduce((s, x) => s + (x.value ?? 0), 0);
  const owed = i.owedToUs.reduce((s, x) => s + x.outstanding, 0);
  const heldTotal = i.heldByOthers.reduce((s, x) => s + (x.value ?? 0), 0);
  const bankNames = i.banks.map((b) => b.name);
  const adults = i.people.filter((x) => !x.isMinor);
  const minors = i.people.filter((x) => x.isMinor);

  // 1. read first
  sections.push({
    id: 'start',
    title: 'Read this first',
    ...(p.message ? { paragraphs: [p.message] } : {}),
    steps: [
      'Take a breath. Nothing here is urgent in the first few days except looking after people. Money matters can wait a little.',
      `Find ${adults.length > 1 ? 'the adults who can help' : 'a trusted adult'}: the people to call first are listed in "Who to call".`,
      'Do not close accounts, sell investments or sign anything in a hurry. Nothing here needs a quick decision in the first weeks.',
      'Get several certified copies of the death certificate. Almost every bank, fund house and insurer will ask for one.',
      'Keep this handbook and the documents together. The sections below tell you what exists, where it is, and what to do next, in order.',
      'Ask the advisors listed below before any big step. This handbook is general guidance, not legal or tax advice.',
    ],
  });

  // 2. who is who
  sections.push({
    id: 'people',
    title: 'Who is who',
    tables: [
      {
        table: {
          headers: ['Name', 'Age', 'Looked after by', 'PAN (last 4)', 'Tax residency'],
          rows: i.people.map((x) => [
            x.name + (x.isMinor ? ' (child)' : ''),
            x.dob ? String(age(x.dob, i.asOf)) : '–',
            x.guardian ?? (x.isMinor ? 'not recorded' : '–'),
            x.panLast4 ? `…${x.panLast4}` : x.isMinor ? 'none' : 'not recorded',
            x.residency ?? '–',
          ]),
          note:
            minors.length > 0
              ? 'Children cannot manage money themselves. Their accounts are run by the adult named in "Looked after by".'
              : undefined,
        },
      },
    ],
  });

  // 3. who to call, where things are
  const where: string[][] = [
    ['Will and estate papers', p.willLocation || 'not recorded'],
    [
      'Other important documents (passports, property papers, policies)',
      p.documentsLocation || 'not recorded',
    ],
    ['Bank locker', p.lockerDetails || 'none recorded'],
    ['Passwords and logins', p.passwordManager || 'not recorded'],
    ['Phones, computers and other devices', p.devices || 'not recorded'],
    ['Email accounts used for banks and investments', p.emailAccounts || 'not recorded'],
    ['Key to open the encrypted backups of this app', p.backupKeyLocation || 'not recorded'],
    [
      'Nominees named on accounts, funds and policies',
      p.nominees || 'not recorded here: ask each institution, or look in each policy and form',
    ],
  ];
  sections.push({
    id: 'call',
    title: 'Who to call and where things are',
    tables: [
      ...(p.contacts.length > 0
        ? [
            {
              title: 'Call these people first',
              table: {
                headers: ['Name', 'Who they are', 'Phone', 'Note'],
                rows: p.contacts.map((c) => [c.name, c.relation, c.phone, c.note]),
              },
            },
          ]
        : []),
      ...(p.advisors.length > 0
        ? [
            {
              title: 'Advisers (lawyer, accountant, agents)',
              table: {
                headers: ['Name', 'Role', 'Phone', 'Note'],
                rows: p.advisors.map((c) => [c.name, c.relation, c.phone, c.note]),
              },
            },
          ]
        : []),
      { title: 'Where things are', table: { headers: ['What', 'Where'], rows: where } },
    ],
    ...(p.contacts.length === 0 && p.advisors.length === 0
      ? {
          paragraphs: [
            'No contacts have been entered yet. Add them in Settings > Emergency information so this page can tell the family who to call.',
          ],
        }
      : {}),
    ...(p.instructions ? { paragraphs: [p.instructions] } : {}),
  });

  // 4. what we have
  sections.push({
    id: 'summary',
    title: 'Everything we have, in one table',
    intro: `Figures are estimates as of ${long(i.asOf)}. They are worked out from the last values recorded, interest and prices, not bank statements.`,
    tables: [
      {
        table: {
          headers: ['What', 'About', 'Where to read more'],
          rows: [
            ['Bank accounts (savings)', inr(bankTotal), 'Bank accounts and deposits'],
            ['Fixed deposits', inr(fdTotal), 'Bank accounts and deposits'],
            ['Mutual funds', inr(fundTotal), 'Investments'],
            ['Money held in other people’s accounts', inr(heldTotal), 'Investments'],
            ['Property', inr(propTotal), 'Property and money owed to us'],
            ['Money owed to us', inr(owed), 'Property and money owed to us'],
            [
              'Insurance policies',
              `${i.policies.length} polic${i.policies.length === 1 ? 'y' : 'ies'}`,
              'Insurance',
            ],
          ],
        },
      },
    ],
  });

  // 5. banks
  sections.push({
    id: 'banks',
    title: 'Bank accounts and deposits',
    intro: `${bankNames.length} bank${bankNames.length === 1 ? '' : 's'}: ${list(bankNames)}. Only the last four digits of each account are shown; the full numbers are in the bank papers listed above.`,
    steps: [
      'Contact each bank in writing (a branch visit is best) and say that the account holder has died. Ask for the bank’s own claim checklist.',
      'A joint account continues with the surviving holder; ask the bank to update it. For an account with a single name, the nominee (if named) can collect the money, but the will or succession law decides who is finally entitled.',
      'Fixed deposits keep running until the bank is told. Ask whether to let them mature or close them, and where the money should go.',
      'NRE and NRO accounts have special rules for money leaving India; ask the bank and an adviser before moving anything abroad.',
      'Do not close an account that still receives automatic payments (investments, insurance) until those have been moved.',
    ],
    tables: i.banks.map((b) => ({
      title: b.name,
      table: {
        headers: ['Whose', 'Account', 'Today (est.)', 'Details', 'Notes'],
        rows: b.sections.flatMap((s) =>
          s.rows.map((r) => [
            i.ownerName[s.ownerId] ?? '',
            r.code + (r.last4 ? '' : ''),
            r.status !== 'active' && r.kind === 'fd' ? r.status.replace('_', ' ') : inr(r.current),
            r.fd
              ? `${Number((r.fd.rate * 100).toFixed(2))}%, invested ${inr(r.fd.principal)}, matures ${long(r.fd.maturityOn)}${r.fd.maturityAmount ? ` for about ${inr(r.fd.maturityAmount)}` : ''}${r.fd.refLast4 ? `, FD number ends ${r.fd.refLast4}` : ''}`
              : r.asOf
                ? `balance as of ${long(r.asOf)}`
                : '',
            (r.notes ?? '').replace(/FD\s*Number\s*:\s*[^\s,]*/i, '').trim(),
          ]),
        ),
      },
    })),
  });

  // 6. investments
  const byOwner = new Map<string, HandbookFund[]>();
  for (const f of i.funds) byOwner.set(f.owner, [...(byOwner.get(f.owner) ?? []), f]);
  sections.push({
    id: 'investments',
    title: 'Investments',
    intro: `${i.funds.length} mutual fund holdings, about ${inr(fundTotal)}.`,
    steps: [
      'Mutual funds are held with the fund houses and kept on record by two registrars (CAMS and KFintech). Contact either registrar or any fund house with the death certificate; they will tell you which forms each fund needs.',
      'If a holding has a nominee, the units can be moved to the nominee. Otherwise the legal heirs claim them with the will or a succession certificate.',
      'Do not sell in a hurry. If there are monthly investments (SIPs) running, decide with an adviser whether to stop them; the list is under "Money that moves by itself".',
      'Shares and any money held in someone else’s account are listed below; they need the same death certificate and a claim to that broker or person.',
    ],
    tables: [
      ...[...byOwner.entries()].map(([owner, fs]) => ({
        title: owner,
        table: {
          headers: ['Fund', 'Value (est.)', 'Put in', 'Monthly investment'],
          rows: fs
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
            .map((f) => [
              f.fund,
              inr(f.value),
              inr(f.invested),
              f.sipMonthly ? (f.sipStopped ? 'stopped' : inr(f.sipMonthly)) : '–',
            ]),
        },
      })),
      ...(i.heldByOthers.length > 0
        ? [
            {
              title: 'Held by other people or brokers',
              table: {
                headers: ['Whose', 'What', 'Value (est.)', 'Notes'],
                rows: i.heldByOthers.map((h) => [h.owner, h.label, inr(h.value), h.note ?? '']),
              },
            },
          ]
        : []),
    ],
  });

  // 7. insurance
  sections.push({
    id: 'insurance',
    title: 'Insurance',
    steps: [
      'Insurance claims have time limits and need the original policy papers. Contact each insurer early, starting with the life (term) policy.',
      'Ask each insurer for its claim form and checklist. Typical papers: the policy, the death certificate, identity of the claimant, bank details for the payment.',
      'For health cover, tell the insurer promptly; cover for the others in the policy may need changes.',
      'Some cover (for example through an employer) ends when employment ends; check each one.',
    ],
    tables: [
      {
        table: {
          headers: ['Insurer', 'Cover', 'Insured', 'Dates', 'Nominee and papers'],
          rows: i.policies.map((x) => [
            x.insurer + ` (${x.kind.replace('_', ' ')})`,
            x.coverage || '–',
            x.insured.join(', ') || '–',
            [
              x.renewalOn ? `renews ${long(x.renewalOn)}` : '',
              x.expiresOn ? `ends ${long(x.expiresOn)}` : '',
              x.paidBy ? `paid by ${x.paidBy}` : '',
            ]
              .filter(Boolean)
              .join('; ') || '–',
            [
              x.nominee ? `nominee: ${x.nominee}` : 'nominee not recorded',
              x.documents ? `papers: ${x.documents}` : '',
            ]
              .filter(Boolean)
              .join('; '),
          ]),
          note: i.policies.length === 0 ? 'No policies are recorded.' : undefined,
        },
      },
    ],
  });

  // 8. property and owed
  sections.push({
    id: 'property',
    title: 'Property and money owed to us',
    tables: [
      {
        title: 'Property and other assets',
        table: {
          headers: ['Whose', 'What', 'Value (est.)', 'Notes'],
          rows: i.property.map((x) => [x.owner, x.label, inr(x.value), x.note ?? '']),
          note:
            i.property.length === 0
              ? 'None recorded.'
              : 'Property is transferred through the will or succession law, with the registered papers; ask a lawyer.',
        },
      },
      {
        title: 'Money other people owe us',
        table: {
          headers: ['Who owes', 'Still owed', 'Expected back'],
          rows: i.owedToUs.map((x) => [
            x.counterparty,
            inr(x.outstanding),
            x.expectedOn ? long(x.expectedOn) : 'no date',
          ]),
          note:
            i.owedToUs.length === 0
              ? 'Nothing is recorded as owed.'
              : 'These are informal; keep any messages or notes about them.',
        },
      },
    ],
  });

  // 9. moves by itself
  const sips = i.funds.filter((f) => f.sipMonthly && !f.sipStopped);
  const sipTotal = sips.reduce((s, f) => s + (f.sipMonthly ?? 0), 0);
  const maturing = i.banks
    .flatMap((b) =>
      b.sections.flatMap((s) =>
        s.rows
          .filter(
            (r) => r.fd && r.status === 'active' && r.fd.daysLeft >= 0 && r.fd.daysLeft <= 365,
          )
          .map((r) => ({
            bank: b.name,
            owner: i.ownerName[s.ownerId] ?? '',
            code: r.code,
            on: r.fd!.maturityOn,
            amount: r.fd!.maturityAmount,
            days: r.fd!.daysLeft,
          })),
      ),
    )
    .sort((a, b) => a.on.localeCompare(b.on));
  sections.push({
    id: 'automatic',
    title: 'Money that moves by itself',
    paragraphs: [
      `Monthly investments (SIPs) running now: ${sips.length} totalling ${inr(sipTotal)} a month. They are taken from a bank account automatically; if that account is frozen they will fail. Decide with an adviser whether to stop or keep them.`,
    ],
    tables: [
      {
        title: 'Deposits maturing in the next 12 months',
        table: {
          headers: ['When', 'Whose', 'Bank and account', 'About'],
          rows: maturing.map((m) => [long(m.on), m.owner, `${m.bank}, ${m.code}`, inr(m.amount)]),
          note:
            maturing.length === 0
              ? 'None in the next 12 months.'
              : 'A matured deposit may renew by itself unless the bank is told otherwise.',
        },
      },
      ...(i.policies.some((x) => x.renewalOn)
        ? [
            {
              title: 'Insurance renewals',
              table: {
                headers: ['Insurer', 'Renews'],
                rows: i.policies
                  .filter((x) => x.renewalOn)
                  .map((x) => [x.insurer, long(x.renewalOn!)]),
              },
            },
          ]
        : []),
    ],
  });

  // 10. what to do next
  sections.push({
    id: 'next',
    title: 'What to do next, in order',
    intro:
      'Work through these in order. Tick them off as you go. If a step does not apply, skip it.',
    steps: [
      'FIRST DAYS: look after the family. Call the people listed under "Who to call". Do not move money.',
      'FIRST DAYS: ask for 10 or more certified copies of the death certificate. Keep a photo of each.',
      `FIRST WEEK: tell the insurers (${list(i.policies.map((x) => x.insurer))}). Ask for each claim checklist. Start the term (life) claim first.`,
      p.willLocation
        ? `FIRST WEEK: find the will (${p.willLocation}) and read who is named as executor and guardian.`
        : 'FIRST WEEK: find the will, if there is one, and read who is named as executor and guardian. Ask a lawyer if there is none.',
      minors.length > 0
        ? `FIRST WEEK: confirm who looks after ${list(minors.map((m) => m.name))} and their money (${list(minors.map((m) => m.guardian ?? 'not recorded'))}). Their accounts continue under that adult.`
        : 'FIRST WEEK: confirm who will handle any money for dependants.',
      `FIRST MONTH: write to each bank (${list(bankNames)}) with the death certificate. Ask for its claim checklist and what to do with fixed deposits that mature.`,
      'FIRST MONTH: contact CAMS or KFintech (or any fund house) about the mutual funds. Do not sell yet.',
      'FIRST MONTH: check automatic payments (monthly investments, insurance premiums, loan repayments) and make sure the account they use still works, or move them.',
      'FIRST MONTH: secure phones, computers and email (see "Where things are"). Do not delete anything; many banks send claim information by email.',
      'MONTHS 2 TO 3: claim nominee accounts and investments as each institution advises. Keep copies of everything you send.',
      'MONTHS 2 TO 6: if there is no nominee, or the will needs to be confirmed, a lawyer can advise on a succession certificate or probate. Assets in India and abroad may each need their own process.',
      'WITHIN THE YEAR: ask an accountant to file the last tax return and to advise on the tax position of inherited money, both in India and where the family lives.',
      'THROUGHOUT: do not make large decisions in the first three months. Keep the emergency cash, keep paying the essentials, and ask the advisers listed above.',
    ],
  });

  // 11. for the children
  sections.push({
    id: 'children',
    title: 'A short version for the children',
    paragraphs: [
      p.message ||
        'This is a guide your parents made so you are never left wondering what to do. You are not alone, and you do not have to understand everything today.',
      `We have money in ${bankNames.length} banks, in fixed deposits and in investments (mutual funds). The total is about ${inr(bankTotal + fdTotal + fundTotal + propTotal)}. It is looked after for you.`,
      `The adults who will help: ${list(i.people.filter((x) => !x.isMinor).map((x) => x.name))}${p.contacts.length ? `; and ${list(p.contacts.map((c) => `${c.name} (${c.relation || 'family'})`))}` : ''}.`,
      'The first thing to do is call the people in "Who to call". They know where the papers are and what to do next. Follow "What to do next, in order" one step at a time.',
    ],
  });

  return {
    title: `${i.householdName}: family handbook`,
    asOf: i.asOf,
    disclaimer:
      'General guidance, not legal or tax advice. Figures are estimates built from recorded values, interest and prices, not bank statements. This handbook does not move money or give anyone the right to it.',
    sections,
  };
}
