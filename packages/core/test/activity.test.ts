import { describe, expect, it } from 'vitest';
import { describeAudit, diffFields } from '../src/activity';

describe('diffFields', () => {
  it('lists only what changed, in friendly words, and hides the noise', () => {
    const c = diffFields(
      {
        id: 'x',
        household_id: 'h',
        created_at: 't',
        sort_order: 1,
        nickname: 'Cash',
        account_kind: null,
        is_joint: false,
        interest_rate: 0.03,
      },
      {
        id: 'x',
        household_id: 'h',
        created_at: 't',
        sort_order: 2,
        nickname: 'Cash',
        account_kind: 'NRE',
        is_joint: true,
        interest_rate: 0.0325,
      },
    );
    expect(c).toEqual([
      { label: 'Account type', before: null, after: 'NRE' },
      { label: 'Joint account', before: 'No', after: 'Yes' },
      { label: 'Interest rate', before: '3%', after: '3.25%' },
    ]);
  });
  it('writes money, dates and names', () => {
    const c = diffFields(
      { principal: 100000, maturity_on: '2026-11-01', owner_id: 'p1' },
      { principal: 150000, maturity_on: '2027-01-05', owner_id: 'p2' },
      { names: { p1: 'Rupash', p2: 'Ragini' } },
    );
    expect(c).toContainEqual({ label: 'Principal', before: '₹1,00,000', after: '₹1,50,000' });
    expect(c).toContainEqual({ label: 'Maturity date', before: '1 Nov 2026', after: '5 Jan 2027' });
    expect(c).toContainEqual({ label: 'Person', before: 'Rupash', after: 'Ragini' });
  });
  it('says nothing when nothing visible changed', () => {
    expect(diffFields({ sort_order: 1, nickname: 'A' }, { sort_order: 2, nickname: 'A' })).toEqual(
      [],
    );
  });
});

describe('describeAudit', () => {
  it('reads a recorded balance as a sentence', () => {
    const d = describeAudit({
      table_name: 'observations',
      action: 'INSERT',
      before: null,
      after: {
        amount: 125000.5,
        currency: 'INR',
        as_of: '2026-10-25',
        source: 'email',
        asset_id: 'a',
      },
    });
    expect(d.title).toBe('Balance ₹1,25,001 recorded for 25 Oct 2026 (from a bank e-mail)');
    expect(d.changes).toEqual([]);
  });
  it('shows foreign balances in their own currency and notices a replaced balance', () => {
    expect(
      describeAudit({
        table_name: 'observations',
        action: 'INSERT',
        before: null,
        after: { amount: 8300, currency: 'SGD', as_of: '2026-10-01', source: 'manual' },
      }).title,
    ).toContain('SGD 8,300');
    const r = describeAudit({
      table_name: 'observations',
      action: 'UPDATE',
      before: { amount: 5, as_of: '2026-10-01', superseded_by: null },
      after: { amount: 5, as_of: '2026-10-01', superseded_by: 'new' },
    });
    expect(r.title).toContain('replaced by a newer entry');
  });
  it('describes an account edit with its changes', () => {
    const d = describeAudit({
      table_name: 'assets',
      action: 'UPDATE',
      before: { account_kind: null, notes: 'a' },
      after: { account_kind: 'NRE', notes: 'a' },
    });
    expect(d.title).toBe('Details changed');
    expect(d.changes).toEqual([{ label: 'Account type', before: null, after: 'NRE' }]);
  });
  it('describes deposits, funds and loans', () => {
    expect(
      describeAudit({
        table_name: 'fixed_deposits',
        action: 'UPDATE',
        before: { rate: 0.07 },
        after: { rate: 0.0725 },
      }).changes[0],
    ).toEqual({ label: 'Rate', before: '7%', after: '7.25%' });
    expect(
      describeAudit({
        table_name: 'mf_positions',
        action: 'UPDATE',
        before: { sip_monthly: 5000 },
        after: { sip_monthly: 10000 },
      }).title,
    ).toBe('Fund position updated');
    expect(
      describeAudit({
        table_name: 'receivable_payments',
        action: 'INSERT',
        before: null,
        after: { amount: 50000, paid_on: '2026-09-01' },
      }).title,
    ).toBe('Repayment of ₹50,000 recorded for 1 Sep 2026');
  });
  it('describes tasks by what happened to them', () => {
    expect(
      describeAudit({
        table_name: 'tasks',
        action: 'UPDATE',
        before: { status: 'open', title: 'x' },
        after: { status: 'done', title: 'x', done_at: '2026-10-26' },
      }).title,
    ).toBe('Task marked done');
    expect(
      describeAudit({
        table_name: 'tasks',
        action: 'INSERT',
        before: null,
        after: { title: 'Renew FD' },
      }).title,
    ).toBe('Task added: Renew FD');
  });
  it('recognises a bank note change and falls back for unknown tables', () => {
    expect(
      describeAudit({
        table_name: 'institutions',
        action: 'UPDATE',
        before: { notes: null },
        after: { notes: 'AMB 10k' },
      }).title,
    ).toBe('Bank note changed');
    expect(
      describeAudit({ table_name: 'mystery', action: 'DELETE', before: { x: 1 }, after: null })
        .title,
    ).toBe('Removed from mystery');
  });
});
