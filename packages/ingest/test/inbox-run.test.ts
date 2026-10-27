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
  latest: { amount: number; asOf: string } | null = { amount: 9000, asOf: '2026-09-30' },
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

  it('ignores marketing mail and reviews a balance for an unknown account', async () => {
    const a = fakeIo();
    expect(
      (await runInbox([msg({ text: 'Festive offers', subject: 'Offers' })], a.io, cfgNoAi)).ignored,
    ).toBe(1);
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
    from: 'Me <me@gmail.com>',
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
    expect(rows[0]!.reason).toContain('balance email in a format the rules do not know');
  });

  it('ignores it when the AI finds no balance, and never asks about an offer', async () => {
    let asked = 0;
    const { io, rows } = fakeIo();
    const cfg = withAi(() => {
      asked++;
      return { choices: [{ message: { content: '{"readings":[]}' } }] };
    });
    await runInbox([forwarded], io, cfg);
    expect(rows[0]).toMatchObject({
      outcome: 'ignored',
      reason: 'the AI found no balance in this email',
    });
    await runInbox(
      [msg({ messageId: 'o1', subject: 'Offers', text: 'Festive offers up to 50% off' })],
      io,
      cfg,
    );
    expect(asked).toBe(1);
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
