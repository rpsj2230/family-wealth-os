import { describe, expect, it } from 'vitest';
import { runInbox, type InboxIo, type InboxMessage, type InboxRow } from '../src/inbox-run';
import { createAiChain, type AiKeyEntry } from '../src/ai-chain';
import type { BalanceReading, KnownAccount } from '../src/bank-email';
import { failure, fakeAiFetch, type FakeReply } from './fake-ai';

/** An AI chain whose services answer from `reply`. */
const chainReplying = (
  reply: (provider: string) => FakeReply | unknown,
  keys: AiKeyEntry[] = [{ provider: 'groq', key: 'gsk_test_12345' }],
) => {
  const fake = fakeAiFetch((c) => {
    if (c.body === null) return undefined;
    const r = reply(c.provider) as FakeReply & { choices?: unknown };
    return 'choices' in r ? { json: r } : r;
  });
  return { chain: createAiChain(keys, { fetch: fake.fetch }), fake };
};

const HDFC = `Available balance in your account ending XX7240 is Rs. INR 10,711.96 as on 25-OCT-26.`;
const accounts: KnownAccount[] = [
  {
    assetId: 'hdfc1',
    institution: 'HDFC Bank',
    last4: '7240',
    currency: 'INR',
    type: 'bank_account',
  },
];
const msg = (o: Partial<InboxMessage> = {}): InboxMessage => ({
  messageId: 'm1',
  from: 'HDFC Bank <alerts@hdfcbank.bank.in>',
  subject: 'View: Account update for your HDFC Bank A/c',
  text: HDFC,
  receivedOn: '2026-10-26',
  attachments: [],
  ...o,
});

function fakeIo(
  over: Partial<InboxIo> = {},
  latest: { amount: number; asOf: string; source?: string } | null = {
    amount: 9000,
    asOf: '2026-09-30',
  },
) {
  const rows: InboxRow[] = [];
  const applied: { assetId: string; reading: BalanceReading; source: string }[] = [];
  const seen = new Set<string>();
  const io: InboxIo = {
    accounts: async () => accounts,
    latestObservation: async () => latest,
    alreadySeen: async (id) => seen.has(id),
    record: async (r) => {
      rows.push(r);
      seen.add(r.messageId);
    },
    apply: async (a) => {
      applied.push(a);
    },
    pdfText: async () => 'statement text',
    ...over,
  };
  return { io, rows, applied };
}

const cfgNoAi = { today: '2026-10-26', ai: null };

describe('runInbox: the movement an alert reports becomes a statement line', () => {
  it('saves the amount, its direction, the words and the balance after it, for the matched account', async () => {
    const lines: unknown[] = [];
    const { io } = fakeIo({ addAlertLine: async (l) => void lines.push(l) });
    await runInbox(
      [
        msg({
          text: `Rs.2500.00 has been debited from account **7240 to VPA samplefriend@okaxis SAMPLE FRIEND on 25-10-26. ${HDFC}`,
        }),
      ],
      io,
      cfgNoAi,
    );
    expect(lines).toEqual([
      {
        assetId: 'hdfc1',
        date: '2026-10-25',
        amount: -2500,
        balance: 10711.96,
        words: 'samplefriend@okaxis SAMPLE FRIEND',
        messageId: 'm1',
      },
    ]);
  });
  it('a balance-only alert makes no line', async () => {
    const lines: unknown[] = [];
    const { io } = fakeIo({ addAlertLine: async (l) => void lines.push(l) });
    await runInbox([msg()], io, cfgNoAi);
    expect(lines).toEqual([]);
  });
});

describe('runInbox: a movement alert that gives no balance', () => {
  const upi =
    'Rs.2500.00 has been debited from account **7240 to VPA samplefriend@okaxis SAMPLE FRIEND on 25-10-26. Your UPI transaction reference number is 123456789012.';
  it('still becomes a line of the account, with no balance', async () => {
    const lines: unknown[] = [];
    const { io, rows, applied } = fakeIo({ addAlertLine: async (l) => void lines.push(l) });
    const r = await runInbox([msg({ text: upi })], io, cfgNoAi);
    expect(lines).toEqual([
      {
        assetId: 'hdfc1',
        date: '2026-10-25',
        amount: -2500,
        balance: null,
        words: 'samplefriend@okaxis SAMPLE FRIEND',
        messageId: 'm1',
      },
    ]);
    expect(applied).toHaveLength(0);
    expect(r.applied).toBe(1);
    expect(rows[0]!.reason).not.toMatch(/\d/);
  });
  it('not from a look-alike sender, nor for an account not on record', async () => {
    const lines: unknown[] = [];
    const { io } = fakeIo({ addAlertLine: async (l) => void lines.push(l) });
    await runInbox(
      [
        msg({ text: upi, from: 'alerts@hdfcbank.bank.in.evil.example' }),
        msg({ messageId: 'm2', text: upi.replace('**7240', '**9999') }),
      ],
      io,
      cfgNoAi,
    );
    expect(lines).toEqual([]);
  });
});

describe('runInbox: rule-based alerts', () => {
  it('records the HDFC balance when the sender and one account match, and logs it as applied', async () => {
    const { io, rows, applied } = fakeIo();
    const r = await runInbox([msg()], io, cfgNoAi);
    expect(r).toMatchObject({ applied: 1, needsReview: 0 });
    expect(applied[0]).toMatchObject({ assetId: 'hdfc1', source: 'email' });
    expect(applied[0]!.reading.amount).toBe(10711.96);
    expect(rows[0]).toMatchObject({ outcome: 'applied', assetId: 'hdfc1' });
  });

  it('sends a look-alike sender to review instead of applying', async () => {
    const { io, applied } = fakeIo();
    const r = await runInbox([msg({ from: 'alerts@hdfcbank.bank.in.evil.example' })], io, cfgNoAi);
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });

  it('ignores a reading that is not newer than the value on record', async () => {
    const { io, applied } = fakeIo({}, { amount: 5, asOf: '2026-10-25' });
    const r = await runInbox([msg()], io, cfgNoAi);
    expect(applied).toHaveLength(0);
    expect(r.ignored).toBe(1);
  });

  it('skips a message it has already logged (safe to run repeatedly)', async () => {
    const { io, applied } = fakeIo();
    await runInbox([msg()], io, cfgNoAi);
    const again = await runInbox([msg()], io, cfgNoAi);
    expect(again.skipped).toBe(1);
    expect(applied).toHaveLength(1);
  });

  it('keeps every labelled email for you, even one with no balance, and reviews a balance for an unknown account', async () => {
    const a = fakeIo();
    const r = await runInbox([msg({ text: 'Festive offers', subject: 'Offers' })], a.io, cfgNoAi);
    expect(r).toMatchObject({ ignored: 0, needsReview: 1 });
    expect(a.rows[0]!.reason).toContain('type the balance in');
    const b = fakeIo({ accounts: async () => [] });
    expect((await runInbox([msg()], b.io, cfgNoAi)).needsReview).toBe(1);
  });

  it('keeps going after one message fails and logs the error', async () => {
    let n = 0;
    const { io, rows } = fakeIo({
      latestObservation: async () => {
        if (n++ === 0) throw new Error('database timeout');
        return null;
      },
    });
    const r = await runInbox([msg({ messageId: 'bad' }), msg({ messageId: 'good' })], io, cfgNoAi);
    expect(r).toMatchObject({ errors: 1, applied: 1 });
    expect(rows.find((x) => x.messageId === 'bad')).toMatchObject({
      outcome: 'error',
      reason: 'database timeout',
    });
  });
});

describe('runInbox: statements read by AI', () => {
  const stmt = (o: Partial<InboxMessage> = {}) =>
    msg({
      messageId: 's1',
      subject: 'Your HDFC Bank Account Statement',
      text: 'Please find your statement attached.',
      attachments: [{ filename: 'stmt.pdf', content: new Uint8Array([1]) }],
      ...o,
    });
  const aiReply = (amount: number | string, last4 = '7240', asOf = '2026-10-25') => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            readings: [{ bank: 'HDFC Bank', last4, amount, currency: 'INR', asOf }],
          }),
        },
      },
    ],
  });
  const ai = () => chainReplying(() => aiReply(12000)).chain;

  it('applies a plausible AI reading from the bank’s own address, recorded as a statement', async () => {
    const { io, applied } = fakeIo();
    const r = await runInbox([stmt()], io, { today: '2026-10-26', ai: ai() });
    expect(r.applied).toBe(1);
    expect(applied[0]).toMatchObject({ source: 'statement' });
    expect(applied[0]!.reading.source).toBe('ai');
  });

  it('sends an implausible amount to review', async () => {
    const { io, applied } = fakeIo();
    const big = chainReplying(() => aiReply(900_000)).chain;
    const r = await runInbox([stmt()], io, { today: '2026-10-26', ai: big });
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });

  it('sends a statement from an unverified sender to review even if the amount is fine', async () => {
    const { io, applied } = fakeIo();
    const r = await runInbox([stmt({ from: 'someone@gmail.com' })], io, {
      today: '2026-10-26',
      ai: ai(),
    });
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });

  it('explains when there is no AI key, or the PDF is password-protected', async () => {
    const a = fakeIo();
    await runInbox([stmt()], a.io, cfgNoAi);
    expect(a.rows[0]!.reason).toContain('AI key');
    const b = fakeIo({
      pdfText: async () => {
        throw new Error('password required');
      },
    });
    await runInbox([stmt()], b.io, { today: '2026-10-26', ai: ai() });
    expect(b.rows[0]!.reason).toContain('password-protected');
  });

  it('never trusts an AI answer that fails validation', async () => {
    const { io, applied } = fakeIo();
    const junk = chainReplying(() => aiReply('abc')).chain;
    const r = await runInbox([stmt()], io, { today: '2026-10-26', ai: junk });
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });
});

describe('runInbox: fund statements', () => {
  const casMsg = msg({
    messageId: 'cas1',
    from: 'CAMS <donotreply@camsonline.com>',
    subject: 'Your Consolidated Account Statement',
    attachments: [{ filename: 'cas.pdf', content: new Uint8Array([1]) }],
  });
  it('hands a statement to the importer and logs it as applied', async () => {
    const { io, rows } = fakeIo({
      casImport: async () => ({ outcome: 'imported', reason: '3 funds updated' }),
    });
    const r = await runInbox([casMsg], io, cfgNoAi);
    expect(r).toMatchObject({ applied: 1, needsReview: 0 });
    expect(rows[0]).toMatchObject({ outcome: 'applied', reason: '3 funds updated' });
  });
  it('sends a statement that could not be imported to review, with the reason', async () => {
    const { io, rows } = fakeIo({
      casImport: async () => ({ outcome: 'failed', reason: 'password did not open it' }),
    });
    await runInbox([casMsg], io, cfgNoAi);
    expect(rows[0]).toMatchObject({ outcome: 'needs_review', reason: 'password did not open it' });
  });
  it('does not treat a bank alert as a statement', async () => {
    let called = false;
    const { io } = fakeIo({
      casImport: async () => ((called = true), { outcome: 'imported', reason: '' }),
    });
    await runInbox([msg()], io, cfgNoAi);
    expect(called).toBe(false);
  });
  it('does nothing special when this run has no importer', async () => {
    const { io, rows } = fakeIo();
    await runInbox([casMsg], io, cfgNoAi);
    expect(rows[0]!.outcome).not.toBe('applied');
  });
});

describe('runInbox: tax statements', () => {
  const taxMsg = msg({
    messageId: 'tax1',
    from: 'Me <me@example.test>',
    subject: 'Form 26AS 2025-26',
    attachments: [{ filename: 'Form26AS.pdf', content: new Uint8Array([1]) }],
  });
  it('hands a 26AS or AIS to the importer', async () => {
    const { io, rows } = fakeIo({
      taxImport: async () => ({ outcome: 'imported', reason: 'Form 26AS for 2025-26 read' }),
    });
    const r = await runInbox([taxMsg], io, cfgNoAi);
    expect(r.applied).toBe(1);
    expect(rows[0]!.reason).toMatch(/26AS/);
  });
  it('sends one that could not be read to review', async () => {
    const { io, rows } = fakeIo({
      taxImport: async () => ({ outcome: 'failed', reason: 'wrong password' }),
    });
    await runInbox([taxMsg], io, cfgNoAi);
    expect(rows[0]).toMatchObject({ outcome: 'needs_review', reason: 'wrong password' });
  });
  it('leaves ordinary mail alone', async () => {
    let called = false;
    const { io } = fakeIo({
      taxImport: async () => ((called = true), { outcome: 'imported', reason: '' }),
    });
    await runInbox([msg()], io, cfgNoAi);
    expect(called).toBe(false);
  });
});

describe('runInbox: a balance email in a format the rules do not know', () => {
  const forwarded = msg({
    messageId: 'fwd1',
    from: 'Me <me@mail.example.test>',
    subject: 'Fwd: Balance Change Alert',
    text: 'Dear Customer, the balance in your HDFC Bank account ending 7240 is INR 12,345.67 as of 26 Oct 2026.',
  });
  const aiAnswer = {
    choices: [
      {
        message: {
          content:
            '{"readings":[{"bank":"HDFC","last4":"7240","amount":12345.67,"currency":"INR","asOf":"2026-10-26"}]}',
        },
      },
    ],
  };
  const withAi = (reply: () => unknown = () => aiAnswer) => ({
    today: '2026-10-26',
    ai: chainReplying(reply).chain,
  });

  it('asks the AI, and a reading from a forwarded mail goes to review (the sender is not the bank)', async () => {
    const { io, rows, applied } = fakeIo();
    const r = await runInbox([forwarded], io, withAi());
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
    expect(rows[0]).toMatchObject({
      outcome: 'needs_review',
      reason: 'sender is not confirmed as the bank',
    });
    expect(rows[0]!.reading).toMatchObject({ amount: 12345.67, last4: '7240' });
  });

  it('says so, instead of "not a balance email", when there is no AI key', async () => {
    const { io, rows } = fakeIo();
    const r = await runInbox([forwarded], io, cfgNoAi);
    expect(r.needsReview).toBe(1);
    expect(rows[0]!.reason).toContain('no rule knows this format');
  });

  it('asks the AI about any format the rules do not know, and keeps it for you to fill in when nothing is found', async () => {
    let asked = 0;
    const { io, rows } = fakeIo();
    const cfg = withAi(() => {
      asked++;
      return { choices: [{ message: { content: '{"readings":[]}' } }] };
    });
    await runInbox([forwarded], io, cfg);
    expect(rows[0]).toMatchObject({
      outcome: 'needs_review',
      reason: 'neither the rules nor the AI found a balance; type it in if this email has one',
    });
    await runInbox(
      [msg({ messageId: 'o1', subject: 'Offers', text: 'Festive offers up to 50% off' })],
      io,
      cfg,
    );
    expect(asked).toBe(2);
    expect(rows.at(-1)).toMatchObject({ outcome: 'needs_review' });
  });

  it('goes to the next key when the first is refused, and says who answered', async () => {
    const { io, rows } = fakeIo();
    const { chain } = chainReplying(
      (provider) => (provider === 'anthropic' ? failure(401, 'invalid x-api-key') : aiAnswer),
      [
        { provider: 'anthropic', key: 'sk-ant-first' },
        { provider: 'groq', key: 'gsk_second' },
      ],
    );
    const r = await runInbox([forwarded], io, { today: '2026-10-26', ai: chain });
    expect(r.needsReview).toBe(1);
    expect(rows[0]!.reading).toMatchObject({ amount: 12345.67 });
    expect(r.lines.join('\n')).toMatch(/ai: Groq answered after Anthropic answered 401/);
  });

  it('logs every key’s reason as the message error when none can answer, without the keys', async () => {
    const { io, rows } = fakeIo();
    const { chain } = chainReplying(
      (provider) => (provider === 'anthropic' ? failure(401, 'bad') : failure(429, 'busy')),
      [
        { provider: 'anthropic', key: 'sk-ant-first' },
        { provider: 'groq', key: 'gsk_second' },
      ],
    );
    const r = await runInbox([forwarded], io, { today: '2026-10-26', ai: chain });
    expect(r.errors).toBe(1);
    expect(rows[0]).toMatchObject({ outcome: 'error' });
    expect(rows[0]!.reason).toContain('Anthropic answered 401');
    expect(rows[0]!.reason).toContain('Groq answered 429');
    expect(rows[0]!.reason).not.toMatch(/sk-ant-first|gsk_second/);
  });

  it('does not ask a refused key again for the next message in the same run', async () => {
    const { io } = fakeIo();
    const { chain, fake } = chainReplying(
      (provider) => (provider === 'anthropic' ? failure(401, 'bad') : aiAnswer),
      [
        { provider: 'anthropic', key: 'sk-ant-first' },
        { provider: 'groq', key: 'gsk_second' },
      ],
    );
    await runInbox(
      [forwarded, { ...forwarded, messageId: 'fwd2' }, { ...forwarded, messageId: 'fwd3' }],
      io,
      { today: '2026-10-26', ai: chain },
    );
    expect(fake.chatCalls().filter((c) => c.provider === 'anthropic')).toHaveLength(1);
    expect(fake.chatCalls().filter((c) => c.provider === 'groq')).toHaveLength(3);
  });

  it('treats a chain with no key switched on as no AI', async () => {
    const { io, rows } = fakeIo();
    await runInbox([forwarded], io, { today: '2026-10-26', ai: createAiChain([]) });
    expect(rows[0]!.reason).toContain('add an AI key');
  });
});

describe('runInbox: bank alerts forwarded from your own mailbox', () => {
  const body = `---------- Forwarded message ---------\nFrom: HDFC Bank <alerts@hdfcbank.bank.in>\nDate: Mon, 26 Oct 2026\nSubject: Alert\nTo: <me@mail.example.test>\n\n${HDFC}`;
  const fwd = (over: Partial<InboxMessage> = {}) =>
    msg({
      messageId: 'f1',
      from: 'Me <me@mail.example.test>',
      subject: 'Fwd: Balance Change Alert',
      text: body,
      ...over,
    });
  const cfg = { today: '2026-10-26', ai: null, trustedForwarders: ['me@mail.example.test'] };

  it('records the balance by itself when your own address forwarded a message from the bank', async () => {
    const { io, applied, rows } = fakeIo();
    const r = await runInbox([fwd()], io, cfg);
    expect(r.applied).toBe(1);
    expect(applied[0]).toMatchObject({ assetId: 'hdfc1' });
    expect(rows[0]!.fromDomain).toBe('hdfcbank.bank.in');
  });
  it('sends it to review when the forwarder is not one of your addresses', async () => {
    const { io, applied } = fakeIo();
    const r = await runInbox([fwd({ from: 'Someone <x@mail.example.test>' })], io, cfg);
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });
  it('does not trust a forward whose original sender is not the bank', async () => {
    const { io, applied } = fakeIo();
    const evil = body.replace('alerts@hdfcbank.bank.in', 'alerts@hdfc-bank.example');
    const r = await runInbox([fwd({ text: evil })], io, cfg);
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });
  it('sends it to review when no original sender can be found in the forward', async () => {
    const { io, applied } = fakeIo();
    const r = await runInbox([fwd({ text: HDFC })], io, cfg);
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });
});

describe('runInbox: an email you ask to be read again', () => {
  const odd = (o: Partial<InboxMessage> = {}) =>
    msg({
      messageId: 'r1',
      from: 'alerts@hdfcbank.bank.in',
      subject: 'Your account',
      text: 'Hello. The funds in your savings ending 7240 stand at INR 12,345.67 today.',
      reread: true,
      ...o,
    });
  const answer = (amount: number, asOf = '2026-10-26') => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            readings: [{ bank: 'HDFC', last4: '7240', amount, currency: 'INR', asOf }],
          }),
        },
      },
    ],
  });
  const cfgFor = (reply: unknown) => ({
    today: '2026-10-26',
    ai: chainReplying(() => reply).chain,
  });

  it('reads it even when it was seen before, applies the number at once and keeps a copy of the text', async () => {
    const { io, rows, applied } = fakeIo();
    await io.record({ messageId: 'r1' } as unknown as InboxRow);
    const r = await runInbox([odd()], io, cfgFor(answer(12345.67)));
    expect(r.applied).toBe(1);
    expect(applied[0]!.reading.amount).toBe(12345.67);
    expect(rows.at(-1)!.bodyText).toContain('12,345.67');
  });
  it('does not need the email to say "balance", and does not hold back an amount far from the current value', async () => {
    const { io, applied } = fakeIo();
    const r = await runInbox([odd()], io, cfgFor(answer(500000)));
    expect(r.applied).toBe(1);
    expect(applied[0]!.reading.amount).toBe(500000);
  });
  it('replaces a typed or imported value with a later date, because you asked for this reading', async () => {
    const { io, applied } = fakeIo({}, { amount: 9000, asOf: '2026-10-26', source: 'workbook' });
    const r = await runInbox([odd()], io, cfgFor(answer(1234, '2026-10-25')));
    expect(r.applied).toBe(1);
    expect(applied[0]).toMatchObject({ replaceNewer: true });
    expect(applied[0]!.reading.amount).toBe(1234);
  });
  it('never replaces a newer value that the bank itself gave', async () => {
    const { io, applied, rows } = fakeIo({}, { amount: 9000, asOf: '2026-10-26', source: 'email' });
    await runInbox([odd()], io, cfgFor(answer(1234, '2026-10-25')));
    expect(applied).toHaveLength(0);
    expect(rows.at(-1)).toMatchObject({ outcome: 'ignored' });
  });
  it('lets a value of the same date replace the earlier one without replacing anything newer', async () => {
    const { io, applied } = fakeIo({}, { amount: 9, asOf: '2026-10-26', source: 'email' });
    const r = await runInbox([odd()], io, cfgFor(answer(7, '2026-10-26')));
    expect(r.applied).toBe(1);
    expect(applied[0]!.reading.amount).toBe(7);
    expect(applied[0]).not.toHaveProperty('replaceNewer');
  });
  it('says what to do when there is no AI key', async () => {
    const { io, rows } = fakeIo();
    await runInbox([odd()], io, { today: '2026-10-26', ai: null });
    expect(rows.at(-1)!.reason).toContain('add an AI key');
  });
  it('a message that is not marked for re-reading is still skipped once seen', async () => {
    const { io } = fakeIo();
    await io.record({ messageId: 'r1' } as unknown as InboxRow);
    const r = await runInbox([odd({ reread: false })], io, cfgFor(answer(1)));
    expect(r.skipped).toBe(1);
  });
});

describe('runInbox: two alerts of the same day', () => {
  const YES_ACC: KnownAccount[] = [
    {
      assetId: 'yes1',
      institution: 'Yes Bank',
      last4: '1111',
      currency: 'INR',
      type: 'bank_account',
    },
  ];
  const yes = (id: string, balance: string, at: string): InboxMessage => ({
    messageId: id,
    from: '<alerts@yes.bank.in>',
    subject: 'RTGS Alert',
    text: `An amount of INR 1,00,000.00 has been debited to your A/C. No. XX1111 on 28-OCT-2026. Available Balance on 28-OCT-26 is INR ${balance} and Total available balance is INR ${balance}.`,
    receivedOn: '2026-10-28',
    receivedAt: at,
    attachments: [],
  });
  /** a fake database that keeps what was applied, so the next message sees it as the value on record */
  const keeping = (start: {
    amount: number;
    asOf: string;
    source?: string;
    receivedAt?: string | null;
  }) => {
    let latest: typeof start | null = start;
    const applied: Parameters<InboxIo['apply']>[0][] = [];
    const rows: InboxRow[] = [];
    const io: InboxIo = {
      accounts: async () => YES_ACC,
      latestObservation: async () => latest,
      alreadySeen: async () => false,
      record: async (r) => {
        rows.push(r);
      },
      apply: async (a) => {
        applied.push(a);
        latest = {
          amount: a.reading.amount,
          asOf: a.reading.asOf,
          source: 'email',
          receivedAt: a.receivedAt ?? null,
        };
      },
      pdfText: async () => '',
    };
    return { io, applied, rows };
  };
  const cfg = { today: '2026-10-28', ai: null };

  it('keeps the later balance of the day, whatever order the emails come in', async () => {
    const { io, applied } = keeping({ amount: 5000, asOf: '2026-10-20', source: 'email' });
    await runInbox(
      [
        yes('late', '0.53', '2026-10-28T09:58:00.000Z'),
        yes('early', '5,57,006.53', '2026-10-28T07:28:00.000Z'),
      ],
      io,
      cfg,
    );
    expect(applied.map((a) => a.reading.amount)).toEqual([557006.53, 0.53]);
    expect(applied[1]).toMatchObject({
      replaceSameDay: true,
      receivedAt: '2026-10-28T09:58:00.000Z',
    });
  });

  it('a later alert replaces an earlier one of the same day recorded in an earlier run', async () => {
    const { io, applied } = keeping({
      amount: 557006.53,
      asOf: '2026-10-28',
      source: 'email',
      receivedAt: '2026-10-28T07:28:00.000Z',
    });
    await runInbox([yes('late', '0.53', '2026-10-28T09:58:00.000Z')], io, cfg);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.reading.amount).toBe(0.53);
  });

  it('an older alert of the same day that arrives late does not replace the later one', async () => {
    const { io, applied, rows } = keeping({
      amount: 0.53,
      asOf: '2026-10-28',
      source: 'email',
      receivedAt: '2026-10-28T09:58:00.000Z',
    });
    await runInbox([yes('early', '5,57,006.53', '2026-10-28T07:28:00.000Z')], io, cfg);
    expect(applied).toHaveLength(0);
    expect(rows[0]).toMatchObject({ outcome: 'ignored' });
  });

  it('a value of the same day you typed or imported is never replaced by an alert', async () => {
    const { io, applied } = keeping({ amount: 1000, asOf: '2026-10-28', source: 'manual' });
    await runInbox([yes('late', '0.53', '2026-10-28T09:58:00.000Z')], io, cfg);
    expect(applied).toHaveLength(0);
  });

  it('orders forwards by the original time in their header, in the Gmail time zone from Settings', async () => {
    const { io, applied } = keeping({ amount: 5000, asOf: '2026-10-20', source: 'email' });
    const fwd = (id: string, balance: string, time: string, forwardedAt: string): InboxMessage => ({
      ...yes(id, balance, forwardedAt),
      from: 'Me <me@example.com>',
      subject: 'Fwd: RTGS Alert',
      text: `---------- Forwarded message ---------\nFrom: <alerts@yes.bank.in>\nDate: Wed, 28 Oct, 2026, ${time}\nSubject: RTGS Alert\n\n${yes(id, balance, '').text}`,
    });
    // forwarded in the wrong order: the debit first, the credit an hour later
    await runInbox(
      [
        fwd('debit', '0.53', '17:43', '2026-10-28T10:00:00.000Z'),
        fwd('credit', '5,57,006.53', '15:28', '2026-10-28T11:00:00.000Z'),
      ],
      io,
      { ...cfg, trustedForwarders: ['me@example.com'], forwardUtcOffsetHours: 8 },
    );
    expect(applied.map((a) => a.reading.amount)).toEqual([557006.53, 0.53]);
    expect(applied[1]!.receivedAt).toBe('2026-10-28T09:43:00.000Z');
  });
});
