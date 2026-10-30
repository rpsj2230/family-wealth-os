import { describe, expect, it } from 'vitest';
import {
  HB_NEEDS_PLAIN,
  HB_TEXT,
  hbFmt,
  hbSay,
  hbT,
  type HbEntry,
  type HbKey,
  type HbParams,
} from '../src/handbook-text';
import { buildGuide, CARD_NOTE, CLAIM_CHECKLISTS, type Guide } from '../src/handbook-guide';
import { EMPTY_PROFILE } from '../src/handbook';

/** Values that make every text say something (and every branch of a text that depends on a value). */
const SAMPLE: HbParams = {
  household: 'Sample family',
  at: '2026-10-26T01:30:00Z',
  name: 'Ravi',
  total: 34_000_000,
  banks: 3,
  funds: 5,
  policies: 2,
  done: 2,
  who: 'you',
  where: 'the green folder',
  children: ['Kiran'],
  guardians: ['Asha'],
  insurers: ['Sample Life'],
  amount: 540_000,
  kind: 'NRE',
  last4: '1111',
  rate: 7.5,
  on: '2027-01-01',
  ref: '4321',
  cover: '₹1 crore',
  insured: ['Asha'],
  renews: '2027-02-01',
  ends: '2040-01-01',
  paidBy: 'Asha',
  papers: 'green folder',
  count: 3,
  age: 12,
  value: 'NRI',
  pct: 70,
};
const DEVANAGARI = /[ऀ-ॿ]/;
const keys = Object.keys(HB_TEXT) as HbKey[];
const say = (k: HbKey, lang: 'en' | 'hi', plain: boolean, p: HbParams = SAMPLE) =>
  hbSay(hbT(k, p), lang, plain);

describe('every fixed text of the handbook has Hindi and, where it is a step, a simple version', () => {
  it('has a Hindi text for every English text, written in Devanagari', () => {
    const missing: string[] = [];
    for (const k of keys) {
      const en = say(k, 'en', false);
      const hi = say(k, 'hi', false);
      if (!en.trim()) missing.push(`${k}: empty English`);
      if (!hi.trim() || !DEVANAGARI.test(hi)) missing.push(`${k}: no Hindi`);
      if (en === hi) missing.push(`${k}: Hindi is the English text`);
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('has a shorter simple version of every step, checklist line and note, in both languages', () => {
    const missing: string[] = [];
    for (const k of keys.filter((x) => HB_NEEDS_PLAIN.test(x))) {
      const e: HbEntry = HB_TEXT[k];
      if (!e.enPlain) missing.push(`${k}: no simple English`);
      if (!e.hiPlain) missing.push(`${k}: no simple Hindi`);
      if (!e.enPlain || !e.hiPlain) continue;
      for (const p of [SAMPLE, { ...SAMPLE, where: null, count: 0 }]) {
        if (say(k, 'en', true, p).length > say(k, 'en', false, p).length)
          missing.push(`${k}: simple English is longer`);
        if (!DEVANAGARI.test(say(k, 'hi', true, p))) missing.push(`${k}: simple Hindi`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('every text a built guide uses exists, in every language and style', () => {
    const g: Guide = buildGuide({
      asOf: '2026-10-26',
      householdName: 'Sample family',
      people: [
        {
          name: 'Kiran',
          dob: '2014-01-01',
          isMinor: true,
          guardian: 'Asha',
          panLast4: null,
          residency: null,
        },
      ],
      profile: EMPTY_PROFILE,
      banks: [],
      ownerName: {},
      funds: [
        {
          owner: 'Asha',
          fund: 'Alpha Flexi Cap',
          value: 1,
          invested: 1,
          sipMonthly: 5,
          sipStopped: false,
        },
      ],
      heldByOthers: [],
      policies: [
        {
          kind: 'mystery',
          insurer: 'Sample Life',
          coverage: '',
          insured: [],
          paidBy: null,
          renewalOn: null,
          expiresOn: null,
          nominee: null,
          documents: null,
        },
      ],
      property: [],
      owedToUs: [],
    });
    const used: { k: HbKey; p?: HbParams }[] = [];
    JSON.stringify(g, (key, v: unknown) => {
      if (v && typeof v === 'object' && 'k' in v && typeof (v as { k: unknown }).k === 'string')
        used.push(v as { k: HbKey });
      return v;
    });
    used.push(
      ...Object.values(CLAIM_CHECKLISTS).flat(),
      ...Object.values(CARD_NOTE).map((k) => ({ k })),
    );
    expect(used.length).toBeGreaterThan(15);
    for (const t of used) {
      expect(HB_TEXT[t.k], t.k).toBeDefined();
      for (const lang of ['en', 'hi'] as const)
        for (const plain of [false, true]) expect(hbSay(t, lang, plain).trim(), t.k).not.toBe('');
    }
  });

  it('never writes a rupee figure into a fixed text; amounts come only from the records', () => {
    const src = JSON.stringify(
      keys.map((k) => {
        const e: HbEntry = HB_TEXT[k];
        return [e.en, e.hi, e.enPlain, e.hiPlain].map((x) =>
          typeof x === 'string' ? x : x?.toString(),
        );
      }),
    );
    expect(src).not.toMatch(/₹\s?\d/);
    expect(src).not.toMatch(/\b(lakh|crore)\b/i);
  });
});

describe('formats', () => {
  it('writes dates, lists and rupees for each language', () => {
    expect(hbFmt('en').date('2027-01-01')).toBe('1 January 2027');
    expect(hbFmt('hi').date('2027-01-01')).toContain('2027');
    expect(DEVANAGARI.test(hbFmt('hi').date('2027-01-01'))).toBe(true);
    expect(hbFmt('en').list(['a', 'b', 'c'])).toBe('a, b and c');
    expect(hbFmt('hi').list(['a', 'b'])).toBe('a और b');
    expect(hbFmt('en').inr(1234567)).toBe('₹12,34,567');
    expect(hbFmt('en').short(34_000_000)).toBe('₹3.40 Cr');
  });
  it('keeps names, numbers and bank names as written', () => {
    expect(say('start.call', 'hi', false)).toBe('सबसे पहले Ravi को फ़ोन करें');
    expect(hbSay(hbT('h.savings', { kind: 'NRE', last4: '1111' }), 'hi')).toBe(
      'बचत खाता (NRE) …1111',
    );
  });
  it('the start line counts what the family has, in plain words', () => {
    const p = { total: 34_000_000, banks: 8, funds: 20, policies: 3 };
    expect(hbSay(hbT('start.have', p))).toBe(
      'About ₹3.40 Cr in 8 banks, 20 funds and 3 insurance policies — details below.',
    );
    expect(hbSay(hbT('start.have', p), 'hi')).toBe(
      'लगभग ₹3.40 Cr, 8 बैंकों, 20 फ़ंडों और 3 बीमा पॉलिसियों में — पूरी जानकारी नीचे है।',
    );
    expect(hbSay(hbT('start.have', { total: 0, banks: 0, funds: 0, policies: 0 }))).toBe(
      'No accounts, funds or policies are recorded yet.',
    );
  });
});
