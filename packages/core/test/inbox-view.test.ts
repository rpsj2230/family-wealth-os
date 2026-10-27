import { describe, expect, it } from 'vitest';
import {
  canReadAgain,
  inboxProposal,
  certainAccount,
  markAmount,
  explainEntry,
  queueOf,
  rankAccounts,
  skipGroup,
  type AccountChoice,
  type InboxEntry,
  type InboxReading,
} from '../src';

const reading: InboxReading = {
  bank: 'HDFC',
  last4: '1234',
  amount: 12000,
  currency: 'INR',
  asOf: '2026-10-25',
  source: 'rule',
};
const msg = (o: Partial<InboxEntry>): InboxEntry => ({
  id: 'm1',
  receivedOn: '2026-10-25',
  fromDomain: 'hdfcbank.net',
  subject: 'Alert',
  outcome: 'needs_review',
  reason: null,
  reading,
  assetId: null,
  resolvedAt: null,
  recordedByYou: false,
  ...o,
});

describe('queueOf', () => {
  it('sorts messages into queues', () => {
    expect(queueOf(msg({}))).toBe('review');
    expect(queueOf(msg({ outcome: 'applied' }))).toBe('recorded');
    expect(queueOf(msg({ outcome: 'ignored' }))).toBe('skipped');
    expect(queueOf(msg({ outcome: 'error' }))).toBe('problem');
    expect(queueOf(msg({ resolvedAt: '2026-10-26T01:00:00Z' }))).toBe('dismissed');
    expect(queueOf(msg({ resolvedAt: '2026-10-26T01:00:00Z', recordedByYou: true }))).toBe(
      'recorded',
    );
  });
});

describe('skipGroup', () => {
  it('names why a message recorded nothing', () => {
    expect(skipGroup(msg({ outcome: 'ignored', reading: null }))).toBe('notbalance');
    expect(skipGroup(msg({ outcome: 'ignored' }))).toBe('older');
    expect(skipGroup(msg({ outcome: 'error' }))).toBe('problem');
    expect(skipGroup(msg({ resolvedAt: '2026-10-26T01:00:00Z' }))).toBe('dismissed');
    expect(skipGroup(msg({}))).toBeNull();
    expect(skipGroup(msg({ outcome: 'applied' }))).toBeNull();
  });
});

describe('explainEntry', () => {
  it('says what was found, why it waits and what to do', () => {
    const e = explainEntry(msg({ reason: 'sender is not confirmed as the bank' }));
    expect(e.headline).toBe(
      'Balance ₹12,000 as of 25 Oct 2026, account ending 1234, read from an email',
    );
    expect(e.why).toContain('bank’s own address');
    expect(e.why).toContain('hdfcbank.net');
    expect(e.next).toContain('Apply');
  });
  it('explains each reason the reader writes', () => {
    const why = (reason: string, r: InboxReading | null = reading) =>
      explainEntry(msg({ reason, reading: r })).why;
    expect(why('no single account matches this bank and last four digits')).toContain(
      'None of your accounts',
    );
    expect(why('more than one account matches')).toContain('More than one');
    expect(why('amount is far from the current value; please confirm')).toContain('very different');
    expect(why('statement found; add an AI key in Settings to read it', null)).toContain('no key');
    // the wording since several keys can be saved, and the older wording still stored in the log
    expect(
      why('statement found; add an AI key in Settings, or switch one on, to read it', null),
    ).toContain('no key is switched on');
    expect(
      why(
        'balance email in a format the rules do not know; add an AI key (or switch one on) to read it',
        null,
      ),
    ).toContain('no key switched on');
    expect(
      why('PDF could not be opened (bad password); it may be password-protected', null),
    ).toContain('password-protected');
  });
  it('explains why an email was skipped', () => {
    const old = explainEntry(
      msg({ outcome: 'ignored', reason: 'not newer than the value on record (2026-10-26)' }),
    );
    expect(old.why).toContain('26 Oct 2026');
    const none = explainEntry(msg({ outcome: 'ignored', reason: null, reading: null }));
    expect(none.headline).toBe('Not a balance email');
  });
  it('keeps an unknown reason visible instead of hiding it', () => {
    expect(explainEntry(msg({ reason: 'something new' })).why).toBe('something new');
    expect(explainEntry(msg({ outcome: 'error', reason: 'boom', reading: null })).why).toBe('boom');
  });
});

describe('accounts for a reading', () => {
  const accounts: AccountChoice[] = [
    { id: 'x', label: 'Other', currency: 'INR', last4: '9999', bank: 'Axis' },
    { id: 'y', label: 'Cash-NRE-1234', currency: 'INR', last4: '1234', bank: 'HDFC Bank' },
    { id: 'z', label: 'SGD account', currency: 'SGD', last4: '1234', bank: 'DBS' },
  ];
  it('ranks the same digits first and never offers another currency', () => {
    expect(rankAccounts(reading, null, accounts).map((a) => a.id)).toEqual(['y', 'x']);
    expect(rankAccounts(reading, 'x', accounts).map((a) => a.id)).toEqual(['x', 'y']);
  });
  it('preselects only the account the reader matched', () => {
    expect(certainAccount(reading, null, accounts)).toBeNull();
    expect(certainAccount(reading, 'y', accounts)?.id).toBe('y');
    expect(certainAccount(reading, 'z', accounts)).toBeNull();
  });
});

describe('read again and the marked number', () => {
  it('offers Read again for everything that did not end as a recorded balance', () => {
    expect(canReadAgain(msg({ outcome: 'ignored', reading: null }))).toBe(true);
    expect(canReadAgain(msg({ outcome: 'error', reading: null }))).toBe(true);
    expect(canReadAgain(msg({ outcome: 'needs_review' }))).toBe(true);
    expect(canReadAgain(msg({ outcome: 'applied' }))).toBe(false);
    expect(canReadAgain(msg({ outcome: 'applied', reading: null }))).toBe(true);
  });
  it('marks the figure that was read, whatever the grouping of its digits', () => {
    const t = 'Balance is INR 1,23,456.78 as on 25-OCT-26 (ref 7240).';
    const parts = markAmount(t, 123456.78);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['1,23,456.78']);
    expect(parts.map((p) => p.text).join('')).toBe(t);
    expect(markAmount('Rs 123456.78.', 123456.78).filter((p) => p.hit)[0]!.text).toBe('123456.78');
  });
  it('marks nothing when the figure is not in the text, and handles no amount', () => {
    expect(markAmount('nothing here 12', 99).some((p) => p.hit)).toBe(false);
    expect(markAmount('abc', null)).toEqual([{ text: 'abc', hit: false }]);
    expect(markAmount('', 5)).toEqual([{ text: '', hit: false }]);
  });
});

describe('inboxProposal: what I suggest for a balance waiting for review', () => {
  const acc = (id: string, last4: string | null, bank = 'HDFC Bank', currency = 'INR'): AccountChoice => ({
    id,
    label: `${bank} ···${last4 ?? ''} (${id})`,
    currency,
    last4,
    bank,
  });
  const ask = (o: Partial<InboxEntry>, accounts: AccountChoice[]) =>
    inboxProposal(msg(o), accounts)!;

  it('suggests the account the reader matched, with the amount, the date and the reason', () => {
    const p = ask({ assetId: 'y', reason: 'sender is not confirmed as the bank' }, [
      acc('x', '9999'),
      acc('y', '1234'),
    ]);
    expect(p.accountId).toBe('y');
    expect(p.proposal.suggest).toBe('Record ₹12,000 on HDFC Bank ···1234 (y), as of 25 Oct 2026.');
    expect(p.proposal.why).toContain('The reader matched it to this account');
    expect(p.proposal.why).toContain('approve only if you trust the message');
    expect(p.proposal.why).toContain('hdfcbank.net');
    expect(p.proposal.approve).toBe('Approve: record ₹12,000 on HDFC Bank ···1234 (y)');
    expect(p.proposal.found).toContain('Balance ₹12,000');
  });

  it('suggests the only account with the same last four digits when the reader matched none', () => {
    const p = ask({ reason: 'no single account matches this bank and last four digits' }, [
      acc('x', '9999'),
      acc('y', '1234', 'Other Bank'),
      acc('z', '1234', 'Bank', 'SGD'),
    ]);
    expect(p.accountId).toBe('y');
    expect(p.proposal.why).toContain('only INR account ending 1234');
  });

  it('says it cannot tell when two accounts fit, or none does', () => {
    const two = ask({ reason: 'more than one account matches' }, [acc('x', '1234'), acc('y', '1234')]);
    expect(two.accountId).toBeNull();
    expect(two.proposal.approve).toBeNull();
    expect(two.proposal.suggest).toBe('I cannot tell which it is, so I am not guessing: please choose.');
    expect(two.proposal.options.map((o) => o.id)).toEqual(['record:x', 'record:y', 'ignore']);
    const none = ask({ reason: 'no single account matches' }, [acc('x', '9999')]);
    expect(none.accountId).toBeNull();
    const noAccount = ask({}, [acc('x', '1234', 'HDFC Bank', 'SGD')]);
    expect(noAccount.proposal.why).toContain('You have no account in INR');
  });

  it('warns when the amount is far from the current value', () => {
    const p = ask({ assetId: 'y', reason: 'amount is far from the current value; please confirm' }, [
      acc('y', '1234'),
    ]);
    expect(p.proposal.why).toContain('very different from the value you have now');
  });

  it('is only for a message with a balance that is waiting', () => {
    expect(inboxProposal(msg({ reading: null }), [])).toBeNull();
    expect(inboxProposal(msg({ outcome: 'applied' }), [])).toBeNull();
    expect(inboxProposal(msg({ resolvedAt: '2026-10-26T01:00:00Z' }), [])).toBeNull();
  });

  it('a statement the reader could not finish says what to do, not just "needs a look"', () => {
    const e = explainEntry(msg({ reading: null, reason: 'something odd' }));
    expect(e.headline).toBe('A statement could not be finished');
    expect(e.next).toContain('I suggest');
  });
});
