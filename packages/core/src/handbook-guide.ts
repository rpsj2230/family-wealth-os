/**
 * The family handbook as a guide to act on: a "start here" card, a first-days timeline, one card per bank, fund house and insurer
 * (what is held there, the nominee, the helpline and the papers a claim needs), the rest of what the family owns, and a part for the
 * children. Every fixed text is a key of handbook-text.ts, so one stored guide reads in English or Hindi, in normal or simple words.
 *
 * It describes; it never moves money. General guidance only, not legal or tax advice. Pure: no I/O.
 */
import type { HandbookInput, HandbookOther } from './handbook';
import { hbT, type HbKey, type HbText } from './handbook-text';
import { amcLabel } from './fund-category';

export type CardKind = 'bank' | 'funds' | 'insurer';

export interface GuideContact {
  name: string;
  relation: string;
  phone: string;
  note: string;
}

/** One thing held at a place: an account, a deposit, a fund or a policy. */
export interface GuideHolding {
  /** whose it is (for a policy: who is insured) */
  owner: string;
  /** a fixed text ("Savings account (NRE) …1111") or a name as recorded (a fund's name) */
  label: HbText | string;
  /** roughly how much, in rupees; null for a policy or a deposit that is no longer counted */
  amount: number | null;
  detail?: HbText;
  /** the nominee as written down; null when nobody wrote it down */
  nominee: string | null;
  /** the household's own note on it */
  note?: string;
  joint?: boolean;
}

export interface GuideCard {
  /** stable: `b-<institution id>`, `f-<fund house>`, `i-<insurer>`; ticks are stored under it */
  id: string;
  kind: CardKind;
  name: string;
  /** roughly how much is held there; null for an insurer */
  total: number | null;
  holdings: GuideHolding[];
  helpline: string | null;
  /** the institution record that holds the helpline, so a member can fill it in */
  institutionId: string | null;
}

export type PhaseId = 'week' | 'month' | 'quarter';
export interface GuideStep {
  /** stable tick key: `t:week:certificates` */
  id: string;
  text: HbText;
}
export interface GuidePhase {
  id: PhaseId;
  steps: GuideStep[];
}

export type WhereId =
  'will' | 'documents' | 'locker' | 'passwords' | 'devices' | 'email' | 'backupKey' | 'nominees';
export interface GuideWhere {
  id: WhereId;
  /** as the family wrote it; empty when nobody has */
  value: string;
}

export interface GuideOther {
  owner: string;
  label: string;
  amount: number | null;
  note: string | null;
}

export interface GuidePerson {
  name: string;
  age: number | null;
  isMinor: boolean;
  guardian: string | null;
  panLast4: string | null;
  residency: string | null;
}

export interface Guide {
  v: 2;
  household: string;
  asOf: string;
  /** the family's own words, never translated */
  message: string;
  instructions: string;
  contacts: GuideContact[];
  advisers: GuideContact[];
  where: GuideWhere[];
  totals: { money: number; banks: number; funds: number; policies: number };
  cards: GuideCard[];
  timeline: GuidePhase[];
  people: GuidePerson[];
  property: GuideOther[];
  heldByOthers: GuideOther[];
  owed: { counterparty: string; outstanding: number; expectedOn: string | null }[];
  moving: {
    sipCount: number;
    sipMonthly: number;
    maturing: { on: string; owner: string; bank: string; code: string; amount: number }[];
    renewals: { insurer: string; on: string }[];
  };
}

/** The papers a claim needs, one list per kind of place. General guidance; each place gives its own exact list. */
export const CLAIM_CHECKLISTS: Record<CardKind, { id: string; k: HbKey }[]> = {
  bank: [
    { id: 'inform', k: 'claim.bank.inform' },
    { id: 'death-cert', k: 'claim.bank.deathCert' },
    { id: 'claim-form', k: 'claim.bank.form' },
    { id: 'nominee-id', k: 'claim.bank.nomineeId' },
    { id: 'passbook', k: 'claim.bank.passbook' },
    { id: 'payout', k: 'claim.bank.payout' },
    { id: 'no-nominee', k: 'claim.bank.noNominee' },
  ],
  funds: [
    { id: 'inform', k: 'claim.funds.inform' },
    { id: 'transmission-form', k: 'claim.funds.form' },
    { id: 'death-cert', k: 'claim.funds.deathCert' },
    { id: 'nominee-kyc', k: 'claim.funds.kyc' },
    { id: 'bank-proof', k: 'claim.funds.bankProof' },
    { id: 'statement', k: 'claim.funds.statement' },
  ],
  insurer: [
    { id: 'inform', k: 'claim.insurer.inform' },
    { id: 'claim-form', k: 'claim.insurer.form' },
    { id: 'policy-doc', k: 'claim.insurer.policy' },
    { id: 'death-cert', k: 'claim.insurer.deathCert' },
    { id: 'claimant-id', k: 'claim.insurer.claimant' },
    { id: 'medical', k: 'claim.insurer.medical' },
  ],
};

/** The note under each kind of card. */
export const CARD_NOTE: Record<CardKind, HbKey> = {
  bank: 'note.bank',
  funds: 'note.funds',
  insurer: 'note.insurer',
};

/** The tick key of one checklist line on one card. */
export const claimKey = (cardId: string, itemId: string) => `c:${cardId}:${itemId}`;

/** A tick key the page may store: a timeline step or a checklist line, short and plain. */
export const STEP_KEY =
  /^(t:(week|month|quarter):[a-z-]{1,30}|c:[a-z]-[A-Za-z0-9-]{1,60}:[a-z-]{1,30})$/;

export const slugOf = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'other';

const CATEGORY_WORD =
  /^(flexi|large|mid|small|multi|liquid|equity|elss|tax|index|nifty|sensex|focused|value|balanced|hybrid|debt|gilt|blue|bluechip|overnight|short|corporate|banking|dynamic|arbitrage|fund|growth|direct|regular|opportunities|contra|dividend|midcap|smallcap|largecap|multicap|consumption|technology|pharma|infrastructure|global|us|emerging|retirement|children|credit|savings|money|ultra|low|medium|long|gold|silver|international|top|asset|mutual|aggressive|conservative|equity-|large-cap|mid-cap|small-cap|flexi-cap|multi-cap|\d.*)$/i;

/**
 * The fund house of a fund: the official AMC name when the scheme is matched, otherwise the words of the fund's name before the
 * first word that describes the kind of fund ("Parag Parikh Flexi Cap Fund" -> "Parag Parikh"; "Mirae Asset Large Cap" -> "Mirae Asset").
 */
export function fundHouseOf(fundName: string, amc?: string | null): string {
  const official = amcLabel(amc);
  if (official) return official;
  const words = fundName
    .replace(/[-–(].*$/, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    // "Mirae Asset" keeps "Asset" when it is the second word
    if (CATEGORY_WORD.test(w) && !(out.length === 1 && /^asset$/i.test(w))) break;
    out.push(w);
  }
  return (out.length ? out : words.slice(0, 1)).join(' ') || 'Other';
}

const plainName = (x: string) =>
  x
    .toLowerCase()
    .replace(/\b(mutual fund|asset management|amc|insurance|company|co|ltd|limited|life)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');

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

const other = (x: HandbookOther): GuideOther => ({
  owner: x.owner,
  label: x.label,
  amount: x.value === null ? null : Math.round(x.value),
  note: x.note,
});

const POLICY_KINDS = new Set(['term', 'health_sg', 'health_in', 'ulip', 'nps', 'other']);

/** The cards: banks in the family's order, then fund houses and insurers, each largest first. */
export function guideCards(i: HandbookInput): GuideCard[] {
  const nominees = i.nominees ?? {};
  const inst = i.institutions ?? [];
  const helplineById = new Map(inst.map((x) => [x.id, x.helpline]));
  const byName = new Map(inst.map((x) => [plainName(x.name), x]));
  const named = (name: string) => byName.get(plainName(name)) ?? null;
  const cards: GuideCard[] = [];

  for (const b of i.banks) {
    const holdings: GuideHolding[] = b.sections.flatMap((s) =>
      s.rows
        .filter((r) => r.kind !== 'held')
        .map((r): GuideHolding => {
          const params = { kind: r.accountKind, last4: r.last4 };
          const counted =
            !(r.kind === 'fd' && r.fd?.needsConfirmation) &&
            r.status !== 'closed' &&
            r.status !== 'stopped';
          const detail: HbText | undefined = r.fd
            ? r.fd.needsConfirmation
              ? hbT('h.fdMatured')
              : hbT('h.fdTerms', {
                  rate: Number((r.fd.rate * 100).toFixed(2)),
                  on: r.fd.maturityOn,
                  amount: Math.round(r.fd.maturityAmount),
                  ref: r.fd.refLast4,
                })
            : r.asOf
              ? hbT('h.balanceAsOf', { on: r.asOf })
              : undefined;
          const note = (r.notes ?? '').replace(/FD\s*Number\s*:\s*[^\s,]*/i, '').trim();
          return {
            owner: i.ownerName[s.ownerId] ?? '',
            label: hbT(r.kind === 'fd' ? 'h.fd' : 'h.savings', params),
            amount: counted && r.current !== null ? Math.round(r.current) : null,
            ...(detail ? { detail } : {}),
            nominee: nominees[r.assetId]?.trim() || null,
            ...(note ? { note } : {}),
            ...(r.joint ? { joint: true } : {}),
          };
        }),
    );
    if (holdings.length === 0) continue;
    const other = b.key === '__none';
    cards.push({
      id: `b-${other ? 'other' : b.key}`,
      kind: 'bank',
      name: b.name,
      total: Math.round(holdings.reduce((t, h) => t + (h.amount ?? 0), 0)),
      holdings,
      helpline: (other ? null : (helplineById.get(b.key) ?? null)) || null,
      institutionId: other ? null : b.key,
    });
  }

  const houses = new Map<string, GuideHolding[]>();
  for (const f of i.funds) {
    const house = f.house?.trim() || fundHouseOf(f.fund);
    const detail: HbText | undefined =
      f.sipMonthly && !f.sipStopped
        ? hbT('h.sip', { amount: f.sipMonthly })
        : f.sipMonthly && f.sipStopped
          ? hbT('h.sipStopped')
          : undefined;
    houses.set(house, [
      ...(houses.get(house) ?? []),
      {
        owner: f.owner,
        label: f.fund,
        amount: f.value === null ? null : Math.round(f.value),
        ...(detail ? { detail } : {}),
        nominee: (f.nominee ?? (f.assetId ? nominees[f.assetId] : null))?.trim() || null,
      },
    ]);
  }
  const fundCards = [...houses.entries()].map(([house, holdings]): GuideCard => {
    const rec = named(house);
    return {
      id: `f-${slugOf(house)}`,
      kind: 'funds',
      name: /fund$/i.test(house) ? house : `${house} Mutual Fund`,
      total: Math.round(holdings.reduce((t, h) => t + (h.amount ?? 0), 0)),
      holdings: holdings.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
      helpline: rec?.helpline || null,
      institutionId: rec?.id ?? null,
    };
  });
  cards.push(...fundCards.sort((a, b) => (b.total ?? 0) - (a.total ?? 0)));

  const insurers = new Map<string, GuideHolding[]>();
  for (const p of i.policies) {
    const kind = POLICY_KINDS.has(p.kind) ? p.kind : 'other';
    insurers.set(p.insurer, [
      ...(insurers.get(p.insurer) ?? []),
      {
        owner: p.insured.join(', '),
        label: hbT(`policy.${kind}` as HbKey),
        amount: null,
        ...(p.coverage || p.renewalOn || p.expiresOn || p.paidBy || p.documents
          ? {
              detail: hbT('h.policyDetail', {
                cover: p.coverage || null,
                renews: p.renewalOn,
                ends: p.expiresOn,
                paidBy: p.paidBy,
                papers: p.documents,
              }),
            }
          : {}),
        nominee: p.nominee?.trim() || null,
      },
    ]);
  }
  for (const [insurer, holdings] of insurers) {
    const rec = named(insurer);
    // the life (term) cover first: it is the claim to start first
    holdings.sort(
      (a, b) =>
        Number(typeof b.label !== 'string' && b.label.k === 'policy.term') -
        Number(typeof a.label !== 'string' && a.label.k === 'policy.term'),
    );
    cards.push({
      id: `i-${slugOf(insurer)}`,
      kind: 'insurer',
      name: insurer,
      total: null,
      holdings,
      helpline: rec?.helpline || null,
      institutionId: rec?.id ?? null,
    });
  }
  return cards;
}

/** The first days, re-grouped from the handbook's steps: a week, 30 days, 90 days. */
export function guideTimeline(i: HandbookInput, cards: GuideCard[]): GuidePhase[] {
  const minors = i.people.filter((x) => x.isMinor);
  const banks = cards.filter((c) => c.kind === 'bank' && c.institutionId).map((c) => c.name);
  const insurers = [...new Set(i.policies.map((x) => x.insurer))];
  const step = (phase: PhaseId, id: string, text: HbText): GuideStep => ({
    id: `t:${phase}:${id}`,
    text,
  });
  return [
    {
      id: 'week',
      steps: [
        step('week', 'breathe', hbT('step.breathe')),
        step('week', 'call', hbT('step.call')),
        step('week', 'certificates', hbT('step.certificates')),
        step('week', 'no-hurry', hbT('step.noHurry')),
        step('week', 'will', hbT('step.will', { where: i.profile.willLocation || null })),
        minors.length > 0
          ? step(
              'week',
              'guardian',
              hbT('step.guardian', {
                children: minors.map((m) => m.name),
                guardians: [...new Set(minors.map((m) => m.guardian).filter((g) => g !== null))],
              }),
            )
          : step('week', 'dependants', hbT('step.dependants')),
        insurers.length > 0
          ? step('week', 'insurers', hbT('step.insurers', { insurers }))
          : step('week', 'insurers', hbT('step.insurersNone')),
      ],
    },
    {
      id: 'month',
      steps: [
        ...(banks.length > 0 ? [step('month', 'banks', hbT('step.banks', { banks }))] : []),
        ...(i.funds.length > 0 ? [step('month', 'funds', hbT('step.funds'))] : []),
        step('month', 'automatic', hbT('step.automatic')),
        step('month', 'devices', hbT('step.devices')),
        step('month', 'advisers', hbT('step.advisers')),
      ],
    },
    {
      id: 'quarter',
      steps: [
        step('quarter', 'claims', hbT('step.claims')),
        step('quarter', 'succession', hbT('step.succession')),
        step('quarter', 'tax', hbT('step.tax')),
        step('quarter', 'steady', hbT('step.steady')),
      ],
    },
  ];
}

export function buildGuide(i: HandbookInput): Guide {
  const p = i.profile;
  const cards = guideCards(i);
  const bankMoney = i.banks.reduce((s, b) => s + b.totals.cash + b.totals.fdCurrent, 0);
  const fundMoney = i.funds.reduce((s, f) => s + (f.value ?? 0), 0);
  const sips = i.funds.filter((f) => f.sipMonthly && !f.sipStopped);
  const maturing = i.banks
    .flatMap((b) =>
      b.sections.flatMap((s) =>
        s.rows
          .filter(
            (r) =>
              r.fd &&
              r.status === 'active' &&
              !r.fd.needsConfirmation &&
              r.fd.daysLeft >= 0 &&
              r.fd.daysLeft <= 365,
          )
          .map((r) => ({
            on: r.fd!.maturityOn,
            owner: i.ownerName[s.ownerId] ?? '',
            bank: b.name,
            code: r.code,
            amount: Math.round(r.fd!.maturityAmount),
          })),
      ),
    )
    .sort((a, b) => a.on.localeCompare(b.on));
  return {
    v: 2,
    household: i.householdName,
    asOf: i.asOf,
    message: p.message,
    instructions: p.instructions,
    contacts: p.contacts,
    advisers: p.advisors,
    where: [
      { id: 'will', value: p.willLocation },
      { id: 'documents', value: p.documentsLocation },
      { id: 'locker', value: p.lockerDetails },
      { id: 'passwords', value: p.passwordManager },
      { id: 'devices', value: p.devices },
      { id: 'email', value: p.emailAccounts },
      { id: 'backupKey', value: p.backupKeyLocation },
      { id: 'nominees', value: p.nominees },
    ],
    totals: {
      money: Math.round(bankMoney + fundMoney),
      banks: i.banks.filter((b) => b.key !== '__none').length,
      funds: i.funds.length,
      policies: i.policies.length,
    },
    cards,
    timeline: guideTimeline(i, cards),
    people: i.people.map((x) => ({
      name: x.name,
      age: x.dob ? age(x.dob, i.asOf) : null,
      isMinor: x.isMinor,
      guardian: x.guardian,
      panLast4: x.panLast4,
      residency: x.residency,
    })),
    property: i.property.map(other),
    heldByOthers: i.heldByOthers.map(other),
    owed: i.owedToUs.map((x) => ({ ...x, outstanding: Math.round(x.outstanding) })),
    moving: {
      sipCount: sips.length,
      sipMonthly: Math.round(sips.reduce((s, f) => s + (f.sipMonthly ?? 0), 0)),
      maturing,
      renewals: i.policies
        .filter((x) => x.renewalOn)
        .map((x) => ({ insurer: x.insurer, on: x.renewalOn! }))
        .sort((a, b) => a.on.localeCompare(b.on)),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// What is still missing (shown to members only)
// ------------------------------------------------------------------------------------------------

export interface HbGap {
  id:
    | 'contacts'
    | 'message'
    | 'will'
    | 'where'
    | 'nomineeAccounts'
    | 'nomineeFunds'
    | 'nomineePolicies'
    | 'helpline';
  text: HbText;
  /** where to fill it in */
  href: string;
  /** how many are still missing, of how many */
  missing: number;
  of: number;
}

export interface HbGaps {
  /** the gaps that are still open, the most important first */
  open: HbGap[];
  /** each kind of information counts the same, however many lines it has */
  percent: number;
}

const SETTINGS = '/settings?tab=access';

/** What the household can still write down, and how complete the handbook is. */
export function handbookGaps(g: Guide): HbGaps {
  const holdings = (kind: CardKind) =>
    g.cards.filter((c) => c.kind === kind).flatMap((c) => c.holdings);
  const noNominee = (kind: CardKind) => {
    const hs = holdings(kind);
    return { missing: hs.filter((h) => !h.nominee).length, of: hs.length };
  };
  const banks = g.cards.filter((c) => c.kind === 'bank' && c.institutionId);
  const otherWhere = g.where.filter((w) => w.id !== 'will');
  const all: HbGap[] = [
    {
      id: 'contacts',
      text: hbT('gap.contacts'),
      href: SETTINGS,
      missing: g.contacts.length > 0 ? 0 : 1,
      of: 1,
    },
    {
      id: 'will',
      text: hbT('gap.will'),
      href: SETTINGS,
      missing: g.where.find((w) => w.id === 'will')?.value ? 0 : 1,
      of: 1,
    },
    (() => {
      const x = noNominee('bank');
      return {
        id: 'nomineeAccounts' as const,
        text: hbT('gap.nomineeAccounts', { count: x.missing }),
        href: '/accounts',
        ...x,
      };
    })(),
    (() => {
      const x = noNominee('funds');
      return {
        id: 'nomineeFunds' as const,
        text: hbT('gap.nomineeFunds', { count: x.missing }),
        href: '/investments',
        ...x,
      };
    })(),
    (() => {
      const x = noNominee('insurer');
      return {
        id: 'nomineePolicies' as const,
        text: hbT('gap.nomineePolicies', { count: x.missing }),
        href: '/others?tab=policies',
        ...x,
      };
    })(),
    (() => {
      const missing = banks.filter((c) => !c.helpline).length;
      return {
        id: 'helpline' as const,
        text: hbT('gap.helpline', { count: missing }),
        href: '/accounts',
        missing,
        of: banks.length,
      };
    })(),
    (() => {
      const missing = otherWhere.filter((w) => !w.value).length;
      return {
        id: 'where' as const,
        text: hbT('gap.where', { count: missing }),
        href: SETTINGS,
        missing,
        of: otherWhere.length,
      };
    })(),
    {
      id: 'message',
      text: hbT('gap.message'),
      href: SETTINGS,
      missing: g.message ? 0 : 1,
      of: 1,
    },
  ];
  const counted = all.filter((x) => x.of > 0);
  const percent = counted.length
    ? Math.round(
        (100 * counted.reduce((s, x) => s + (x.of - x.missing) / x.of, 0)) / counted.length,
      )
    : 100;
  return { open: all.filter((x) => x.missing > 0), percent };
}

/** "n of m done" for a group of tick keys. */
export function doneCount(
  keys: string[],
  done: ReadonlySet<string>,
): { done: number; total: number } {
  return { done: keys.filter((k) => done.has(k)).length, total: keys.length };
}
