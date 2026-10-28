import { describe, expect, it } from 'vitest';
import {
  buildAiRequest,
  matchAccount,
  parseAiResponse,
  parseAmount,
  parseBankDate,
  parseBankEmail,
  parseJsonLoosely,
  redactForAi,
  senderDomain,
  senderMatchesBank,
  type BalanceReading,
  type KnownAccount,
} from '../src/bank-email';

const HDFC_TEXT = `Dear Customer,
Greetings from HDFC Bank!

Available balance in your account ending XX7240 is Rs. INR 10,711.96 as on
25-OCT-26.

The balance in the account does not include the uncleared cheque amount, if
any.`;

describe('parseBankEmail', () => {
  it('reads the HDFC balance alert, including the line break before the date', () => {
    const r = parseBankEmail({
      from: 'HDFC Bank <alerts@hdfcbank.bank.in>',
      subject: 'View: Account update for your HDFC Bank A/c',
      text: HDFC_TEXT,
    });
    expect(r).toEqual({
      kind: 'balance',
      reading: {
        bank: 'HDFC',
        last4: '7240',
        amount: 10711.96,
        currency: 'INR',
        asOf: '2026-10-25',
        source: 'rule',
        senderVerified: true,
      },
    });
  });

  it('does not trust a look-alike sender domain', () => {
    const r = parseBankEmail({
      from: 'alerts@hdfcbank.bank.in.evil.example',
      subject: 'x',
      text: HDFC_TEXT,
    });
    expect(r.kind === 'balance' && r.reading.senderVerified).toBe(false);
  });

  it('spots a statement email by its PDF attachment', () => {
    const r = parseBankEmail({
      from: 'estatement@hdfcbank.net',
      subject: 'Your HDFC Bank Account Statement',
      text: 'Please find your statement attached.',
      attachments: ['Stmt_Oct.pdf'],
    });
    expect(r).toEqual({ kind: 'statement', hint: 'Stmt_Oct.pdf' });
  });

  it('says unknown rather than guessing', () => {
    expect(
      parseBankEmail({ from: 'a@b.c', subject: 'Festive offers', text: 'Treat yourself.' }).kind,
    ).toBe('unknown');
  });

  it('rejects an impossible date inside an otherwise matching alert', () => {
    const r = parseBankEmail({
      from: 'alerts@hdfcbank.bank.in',
      subject: 'x',
      text: 'Available balance in your account ending XX7240 is Rs. INR 10,711.96 as on 31-FEB-26.',
    });
    expect(r.kind).toBe('unknown');
  });
});

describe('helpers', () => {
  it('parses dates and amounts strictly', () => {
    expect(parseBankDate('25-OCT-26')).toBe('2026-10-25');
    expect(parseBankDate('5 Nov 2026')).toBe('2026-11-05');
    expect(parseBankDate('05/11/2026')).toBe('2026-11-05');
    expect(parseBankDate('31-FEB-26')).toBeNull();
    expect(parseAmount('Rs. INR 1,23,456.50')).toBe(123456.5);
    expect(parseAmount('12abc')).toBeNull();
    expect(senderDomain('Name <A@X.Co>')).toBe('x.co');
  });

  it('redacts long numbers, PANs and email addresses before text goes to an AI service', () => {
    const r = redactForAi('A/c 50100123456789 PAN ABCDE1234F mail me@x.com bal 10,711.96');
    expect(r).not.toContain('50100123456789');
    expect(r).toContain('…6789');
    expect(r).not.toContain('ABCDE1234F');
    expect(r).not.toContain('me@x.com');
    expect(r).toContain('10,711.96');
  });
});

describe('AI extraction', () => {
  it('builds a Groq and a Gemini request with the redacted text and the key in the right place', () => {
    const g = buildAiRequest('groq', 'KEY', 'acct 50100123456789');
    expect(g.init.headers.authorization).toBe('Bearer KEY');
    expect(g.init.body).not.toContain('50100123456789');
    const m = buildAiRequest('gemini', 'KEY2', 'hello');
    expect(m.init.headers['x-goog-api-key']).toBe('KEY2');
    expect(m.url).not.toContain('KEY2');
  });

  const wrap = (rows: unknown) => ({
    choices: [{ message: { content: JSON.stringify({ readings: rows }) } }],
  });

  it('keeps valid readings and drops invalid, future-dated and non-numeric ones', () => {
    const out = parseAiResponse(
      'groq',
      wrap([
        { bank: 'HDFC', last4: '7240', amount: 1000.5, currency: 'INR', asOf: '2026-10-25' },
        { bank: 'HDFC', last4: '7240', amount: 'abc', currency: 'INR', asOf: '2026-10-25' },
        { bank: 'HDFC', last4: '7240', amount: 5, currency: 'INR', asOf: '2027-01-01' },
        { bank: '', last4: '7240', amount: 5, currency: 'INR', asOf: '2026-10-25' },
      ]),
      { today: '2026-10-26' },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount: 1000.5, source: 'ai', senderVerified: false });
  });

  it('reads the Gemini shape and survives broken JSON', () => {
    const ok = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: '```json\n{"readings":[{"bank":"DBS","last4":"1234","amount":"2,500.00","currency":"SGD","asOf":"2026-10-20"}]}\n```',
              },
            ],
          },
        },
      ],
    };
    expect(parseAiResponse('gemini', ok, { today: '2026-10-26' })[0]).toMatchObject({
      amount: 2500,
      currency: 'SGD',
    });
    expect(
      parseAiResponse(
        'groq',
        { choices: [{ message: { content: 'not json' } }] },
        { today: '2026-10-26' },
      ),
    ).toEqual([]);
  });
});

describe('matchAccount', () => {
  const accts: KnownAccount[] = [
    {
      assetId: 'a1',
      institution: 'HDFC Bank',
      last4: '7240',
      currency: 'INR',
      type: 'bank_account',
    },
    {
      assetId: 'a2',
      institution: 'HDFC Bank',
      last4: '9999',
      currency: 'INR',
      type: 'bank_account',
    },
    { assetId: 'a3', institution: 'DBS', last4: '7240', currency: 'SGD', type: 'bank_account' },
  ];
  const reading = (o: Partial<BalanceReading> = {}): BalanceReading => ({
    bank: 'HDFC',
    last4: '7240',
    amount: 1,
    currency: 'INR',
    asOf: '2026-10-25',
    source: 'rule',
    senderVerified: true,
    ...o,
  });

  it('matches on bank and last four digits, and auto-applies only a verified rule reading', () => {
    expect(matchAccount(reading(), accts)).toEqual({
      status: 'matched',
      assetId: 'a1',
      autoApply: true,
    });
    expect(matchAccount(reading({ source: 'ai', senderVerified: false }), accts)).toMatchObject({
      autoApply: false,
    });
    expect(matchAccount(reading({ senderVerified: false }), accts)).toMatchObject({
      autoApply: false,
    });
  });

  it('never matches without last four digits or on a different bank or currency', () => {
    expect(matchAccount(reading({ last4: null }), accts)).toEqual({ status: 'none' });
    expect(matchAccount(reading({ bank: 'ICICI' }), accts)).toEqual({ status: 'none' });
    expect(matchAccount(reading({ currency: 'SGD' }), accts)).toEqual({ status: 'none' });
  });

  it('reports ambiguity instead of choosing', () => {
    const dup = [...accts, { ...accts[0]!, assetId: 'a4' }];
    expect(matchAccount(reading(), dup)).toEqual({ status: 'ambiguous', candidates: ['a1', 'a4'] });
  });
});

describe('OpenRouter request and answers', () => {
  it('builds a chat request for the chosen free model without a JSON-mode flag, asking for JSON in words', () => {
    const r = buildAiRequest(
      'openrouter',
      'sk-or-test',
      'balance text',
      'meta-llama/llama-3.3-70b-instruct:free',
    );
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(r.init.body));
    expect(body.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].content).toContain('JSON object only');
    expect((r.init.headers as Record<string, string>).authorization).toBe('Bearer sk-or-test');
  });
  it('reads a reading out of an OpenAI-style answer, even with prose or a code fence around the JSON', () => {
    const answer = (content: string) => ({ choices: [{ message: { content } }] });
    const json =
      '{"readings":[{"bank":"Sample Bank","last4":"4321","amount":123456.78,"currency":"INR","asOf":"2026-10-25"}]}';
    for (const c of [
      json,
      '```json\n' + json + '\n```',
      'Here is the result:\n' + json + '\nHope that helps.',
    ]) {
      const r = parseAiResponse('openrouter', answer(c), { today: '2026-10-26' });
      expect(r[0]).toMatchObject({ amount: 123456.78, last4: '4321' });
    }
    expect(
      parseAiResponse('openrouter', answer('no json at all'), { today: '2026-10-26' }),
    ).toEqual([]);
  });
  it('parseJsonLoosely finds the object or gives null', () => {
    expect(parseJsonLoosely('x {"a":1} y')).toEqual({ a: 1 });
    expect(parseJsonLoosely('nothing')).toBeNull();
  });
});

describe('YES Bank credit alerts and the new .bank.in domains', () => {
  const YES_TEXT = `Dear Customer,

An amount of INR 1,00,000.00 has been credited to your A/C. No. XX1111 on 28-OCT-2026 12:57:59 on account of RTGS:RATNR0000000000000001/From:SOMEONE.

Available Balance on 28-OCT-26 is INR 1,23,456.78 and Total available balance (including linked deposits and Limit) is INR 1,23,456.78.`;

  it('knows the banks by their new domains as well as the old ones', () => {
    expect(senderMatchesBank('yes.bank.in', 'YES Bank')).toBe(true);
    expect(senderMatchesBank('yesbank.in', 'YES Bank')).toBe(true);
    expect(senderMatchesBank('rbl.bank.in', 'RBL Bank')).toBe(true);
    expect(senderMatchesBank('sbi.bank.in', 'SBI')).toBe(true);
    expect(senderMatchesBank('yes.bank.in.evil.com', 'YES Bank')).toBe(false);
  });

  it('reads the available balance, not the amount credited, from the bank itself without the AI', () => {
    const out = parseBankEmail({
      from: '<alerts@yes.bank.in>',
      subject: 'RTGS Credit Alert',
      text: YES_TEXT,
      receivedOn: '2026-10-28',
    });
    expect(out).toEqual({
      kind: 'balance',
      reading: {
        bank: 'YES Bank',
        last4: '1111',
        amount: 123456.78,
        currency: 'INR',
        asOf: '2026-10-28',
        source: 'rule',
        senderVerified: true,
      },
    });
  });

  it('leaves the same words from an unknown sender to the AI reader, never trusted', () => {
    const out = parseBankEmail({
      from: '<alerts@yes-bank-alerts.com>',
      subject: 'RTGS Credit Alert',
      text: YES_TEXT,
      receivedOn: '2026-10-28',
    });
    expect(out.kind).toBe('unknown');
  });

  it('matches a YES Bank account by its last four digits', () => {
    const accounts: KnownAccount[] = [
      {
        assetId: 'y1',
        institution: 'Yes Bank',
        last4: '1111',
        currency: 'INR',
        type: 'bank_account',
      },
      {
        assetId: 'y2',
        institution: 'Yes Bank',
        last4: '9999',
        currency: 'INR',
        type: 'bank_account',
      },
    ];
    const out = parseBankEmail({
      from: '<alerts@yes.bank.in>',
      subject: 'RTGS Credit Alert',
      text: YES_TEXT,
      receivedOn: '2026-10-28',
    });
    if (out.kind !== 'balance') throw new Error('not read');
    expect(matchAccount(out.reading, accounts)).toEqual({
      status: 'matched',
      assetId: 'y1',
      autoApply: true,
    });
  });
});

describe('alert formats of each bank, read from its own address', () => {
  const read = (from: string, text: string, subject = 'Alert') =>
    parseBankEmail({ from, subject, text, receivedOn: '2026-10-28' });
  const reading = (from: string, text: string) => {
    const out = read(from, text);
    if (out.kind !== 'balance') throw new Error(`not read: ${from}`);
    return out.reading;
  };

  it('YES Bank debit: the balance with a time after its date', () => {
    expect(
      reading(
        '<alerts@yes.bank.in>',
        `Dear Customer,
An amount of INR 5,00,000.00 has been debited to your A/C. No. XX1111 on 14-SEP-26- on account of NET-TPT-SOMEONE-transfer to Someone-XX2222

Available Balance on 14-SEP-2026 12:43:48 is INR 2.53 and Total available balance (including linked deposits and Limit) is INR 2.53.`,
      ),
    ).toMatchObject({ bank: 'YES Bank', last4: '1111', amount: 2.53, asOf: '2026-09-14' });
  });

  it('RBL: the available balance after the debit, dated by the transaction', () => {
    expect(
      reading(
        'RBL Bank <RBLAlerts@rbl.bank.in>',
        `Greetings from RBL Bank!
This is to inform you that your a/c no. ending XX3333 has been debited for INR 556750.0 on 28-10-2026 at 12:57:37 through RTGS trf vide UTR No. RATNH00000000000.
Your available balance is INR 0.05.`,
      ),
    ).toMatchObject({ bank: 'RBL Bank', last4: '3333', amount: 0.05, asOf: '2026-10-28' });
  });

  it('Equitas: the balance alert', () => {
    expect(
      reading(
        '<esfb-alerts@equitas.bank.in>',
        `Dear Customer,
The balance in A/c No XXXXXXXX4444 at M P NAGAR as of 06-OCT-2026 is INR 2,82,298.69. You may also login to Equitas Internet / Mobile banking to check for current balance.`,
      ),
    ).toMatchObject({ bank: 'Equitas', last4: '4444', amount: 282298.69, asOf: '2026-10-06' });
  });

  it('Equitas: a debit, with a long reference in the middle', () => {
    expect(
      reading(
        '<esfb-alerts@equitas.bank.in>',
        `Greetings from Equitas Small Finance Bank!
Please note that an amount of INR 5,00,000.00 has been debited from account # XXXXXXXX5555 Ref  towards Initial Payin FD300000000000    /1 SOMEONE Equitas TD/00000000/SOMEONE on 14-SEP-2026. The available balance is INR 5,00,000.35. In case this transaction was not done by you Click https://equitas.bank.in/unauthorized-transaction to report this transaction immediately.`,
      ),
    ).toMatchObject({ last4: '5555', amount: 500000.35, asOf: '2026-09-14' });
    expect(
      reading(
        '<esfb-alerts@equitas.bank.in>',
        `Please note that an amount of INR 2,157.48 has been debited from account # XXXXXXXX5555 Ref  towards TAX Deducted on 30-SEP-2026. The available balance is INR 3,97,541.17.`,
      ),
    ).toMatchObject({ last4: '5555', amount: 397541.17, asOf: '2026-09-30' });
  });

  it('ESAF: the ledger balance from the table, not the amount credited', () => {
    expect(
      reading(
        'ESAF Bank <alerts@trans.esafbank.com>',
        `Credit Alert
Dear SOMEONE,
An amount of INR 83061.71 credited to your ESAF Small Finance Bank account XXXXXXXX6666 towards the below transaction :
Description	Value
Amount (INR)	83061.71
Date & Time	SEP 08, 2026 01:36 PM
Reference ID	221002
Ledger Balance (INR)	171769.42`,
      ),
    ).toMatchObject({ bank: 'ESAF', last4: '6666', amount: 171769.42, asOf: '2026-09-08' });
  });

  it('Jana: the account balance after an interest credit', () => {
    expect(
      reading(
        '<noreply@jana.bank.in>',
        `Dear Customer,
Thank you for banking with us
Your Jana Bank A/c no. XX7777 is credited with INR 112.00 on 30-SEP-2026.
Info: CASA Credit Interest Capi

Your account balance is INR 112.00.`,
      ),
    ).toMatchObject({ bank: 'Jana', last4: '7777', amount: 112, asOf: '2026-09-30' });
  });

  it('IDFC FIRST: the new balance, with international commas', () => {
    expect(
      reading(
        'IDFC FIRST Bank <transaction.alerts@idfcfirstbank.com>',
        `Greetings from IDFC FIRST Bank.
Your A/C XXXXXXX8888 has been credited with INR 113,687.00 on 08-09-2026 17:03:06 vide NEFT payment reference 000000000000 received from SOMEONE.

New balance is INR 8,654,533.93.`,
      ),
    ).toMatchObject({ bank: 'IDFC', last4: '8888', amount: 8654533.93, asOf: '2026-09-08' });
  });

  it('a format a bank changes, or a sender that is not the bank, is left to the AI reader', () => {
    expect(read('<esfb-alerts@equitas.bank.in>', 'Your FD has been renewed. Thank you.').kind).toBe(
      'unknown',
    );
    expect(
      read(
        '<noreply@jana-bank.example>',
        'Your Jana Bank A/c no. XX7777 is credited with INR 112.00 on 30-SEP-2026. Your account balance is INR 112.00.',
      ).kind,
    ).toBe('unknown');
  });

  it('a short bank key is not found inside another bank name', () => {
    expect(senderMatchesBank('au.bank.in', 'AU Small Finance Bank')).toBe(true);
    expect(senderMatchesBank('au.bank.in', 'Saurashtra Gramin')).toBe(false);
    expect(senderMatchesBank('equitas.bank.in', 'Equitas Small Finance Bank')).toBe(true);
  });

  it('reads US-style dates', () => {
    expect(parseBankDate('SEP 08, 2026')).toBe('2026-09-08');
    expect(parseBankDate('Sept 8 2026')).toBe('2026-09-08');
  });
});
