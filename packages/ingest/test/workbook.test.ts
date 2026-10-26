import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { maskIdentifiers, planWorkbook, type ImportPlan } from '../src/workbook';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** A small synthetic workbook with the same quirks as the real one (no personal data). */
async function fixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Oct 2026');
  const row = (r: number, v: Record<string, ExcelJS.CellValue>) =>
    Object.entries(v).forEach(([c, x]) => (ws.getCell(`${c}${r}`).value = x));
  // Yes Bank - Rupash
  row(3, {
    A: 'Yes Bank - Rupash',
    B: 'FD',
    C: 0.065,
    D: d('2021-11-01'),
    E: d('2026-11-01'),
    F: 1_000_000,
    G: 1_380_416,
    N: 'FD Number : 999911112222-1',
    M: 'Address Change',
  });
  row(4, { B: 'Cash', E: 'Cash-NRE', F: 5000 });
  // RBL - Ragini: matured FD, and a duplicate FD reference
  row(5, {
    A: 'RBL - Ragini',
    B: 'FD - NRE-1466',
    C: 0.0775,
    D: d('2025-05-12'),
    E: d('2026-09-23'),
    F: 500_000,
    G: 555_463,
    N: 'FD Number : 71572',
  });
  row(6, {
    B: 'FD-NRE JO-1614',
    C: 0.08,
    D: d('2025-08-24'),
    E: d('2030-08-24'),
    F: 250_000,
    G: 371_441,
    N: 'FD Number : 71572',
  });
  row(7, { B: 'Cash-NRO-1454', E: 'Cash-NRO', F: 300 });
  row(8, { B: 'FD', M: 'KYC Completed' }); // empty placeholder
  // Singapore
  row(9, { A: 'UOB', B: 'Cash', E: 'Cash SG', F: 6500, N: 'Base: $1= Rs 65\nBal : $100.00' });
  // Funds
  row(10, {
    A: 'SIP - Advika (Rupash)\nRs 60k/month',
    B: 'Nippon India Small Cap Growth Direct Plan',
    D: d('2024-07-26'),
    E: 'SIP Advika Education',
    F: 278_248,
    G: 278_248,
    H: 275_986,
    N: '5.09%, NAV-191.33, 12K/Month',
  });
  row(11, {
    B: '(STOPPED) Quant Small Cap Growth Direct Plan',
    D: d('2024-07-26'),
    E: 'SIP Advika Education',
    F: 193_795,
    G: 193_795,
    H: 179_991,
    N: 'NAV-283.68, 10K/Month',
    J: 'today',
  });
  row(12, {
    B: 'Aditya Birla Wealth Smart Plus',
    D: d('2024-06-24'),
    E: 'SIP Retirement',
    F: 60_515,
    G: 60_515,
    H: 60_515,
  });
  // Loans
  row(13, {
    A: 'Others',
    B: 'Ravinder Friend',
    D: 'Cash Loan',
    E: 'Cash Loan',
    F: 7000,
    N: 'Gave 50k to Ravinder, he return 43K on 1 Sep 2024',
  });
  row(14, {
    B: 'Somesh Pratap',
    C: d('2025-06-20'),
    D: 'Cash Loan',
    E: 'Cash Loan',
    F: 200_000,
    N: 'Gave to Somesh for Khet on 20 June 2025. Returned on 4 July 2026',
  });
  // Third-party
  row(15, {
    A: 'Atul IDFC',
    B: 'Cash',
    E: 'Cash-NRO',
    F: 27_748,
    N: 'Atul account but money is mine',
  });
  ws.getCell('F114').value =
    1_000_000 +
    5000 +
    500_000 +
    250_000 +
    300 +
    6500 +
    278_248 +
    193_795 +
    60_515 +
    7000 +
    200_000 +
    27_748;
  // Plans
  row(118, { A: 'Plans', B: 'Rupash', D: 'Ragini', F: 'Advika', N: 'Viraj' });
  row(119, { A: 'Term Insurance (Death)', B: 'HDFC Life - 1.5 Crore Coverage' });
  row(121, {
    A: 'Health Insurance India',
    B: 'Niva Bupa - Unlimited; Policy Number : 12345678901234',
    D: 'Niva Bupa - Unlimited; Policy Number : 12345678901234',
  });
  row(124, {
    A: 'House/Flats',
    D: 'The Bellaire , Bhopal',
    E: '25 Lakh \n(Purchased on 15 Dec 2023)',
  });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

let planPromise: Promise<ImportPlan> | undefined;
const plan = () => (planPromise ??= fixture().then((b) => planWorkbook(b, { asOf: '2026-10-25' })));
const codes = (p: ImportPlan) => p.exceptions.map((e) => e.code);

describe('planWorkbook (synthetic fixture)', () => {
  it('imports FDs with terms, and excludes matured ones until confirmed', async () => {
    const p = await plan();
    expect(p.fixedDeposits).toHaveLength(3);
    const yes = p.assets.find((a) => a.key === 'fd:3')!;
    expect(yes.status).toBe('active');
    expect(yes.ownerKey).toBe('rupash');
    expect(p.fixedDeposits.find((f) => f.assetKey === 'fd:3')).toMatchObject({
      principal: 1_000_000,
      rate: 0.065,
      bookedOn: '2021-11-01',
      maturityOn: '2026-11-01',
      bankMaturityAmount: 1_380_416,
      compounding: 'quarterly',
      refLast4: '2222',
    });
    expect(p.assets.find((a) => a.key === 'fd:5')!.status).toBe('matured_unconfirmed');
    expect(codes(p)).toContain('fd_matured_unconfirmed');
  });

  it('flags a duplicated FD reference and unknown NRE/NRO kind', async () => {
    const p = await plan();
    expect(codes(p)).toContain('duplicate_fd_reference');
    expect(codes(p)).toContain('account_kind_unknown'); // Yes Bank FD is just "FD"
  });

  it('classifies bank balances by account kind and keeps joint accounts joint', async () => {
    const p = await plan();
    const nro = p.assets.find((a) => a.key === 'cash:7')!;
    expect(nro).toMatchObject({
      type: 'bank_account',
      accountKind: 'NRO',
      identifierLast4: '1454',
      ownerKey: 'ragini',
    });
    // a joint FD keeps its NRE/NRO kind and carries a separate joint flag, with the sheet row and label
    const jointFd = p.assets.find((a) => a.key === 'fd:6')!;
    expect(jointFd.accountKind).toBe('NRE');
    expect(jointFd).toMatchObject({ isJoint: true, row: 6 });
    expect(jointFd.label).toMatch(/JO/);
    expect(p.observations.find((o) => o.assetKey === 'cash:4')).toMatchObject({
      amount: 5000,
      confidence: 'manual_unverified',
      asOf: '2026-10-25',
      sourceRef: 'F4',
    });
  });

  it('stores S$ natively with the rate, and assumes an owner explicitly', async () => {
    const p = await plan();
    expect(p.observations.find((o) => o.assetKey === 'sg:9')).toMatchObject({
      amount: 100,
      currency: 'SGD',
      fxRate: 65,
    });
    expect(codes(p)).toContain('owner_assumed');
  });

  it('plans funds with goal, SIP amount, stopped flag; ULIP is not a fund', async () => {
    const p = await plan();
    expect(p.funds).toHaveLength(2);
    expect(p.funds[0]).toMatchObject({
      planType: 'direct',
      holderKey: 'rupash',
      goalTag: 'SIP Advika Education',
      sipMonthly: 12_000,
      sipStopped: false,
      invested: 275_986,
    });
    expect(p.funds[1]).toMatchObject({ sipStopped: true, sipMonthly: null });
    expect(p.assets.find((a) => a.key === 'ulip:12')!.type).toBe('ulip');
    expect(p.controlTotals.ulip).toBe(60_515);
    expect(p.controlTotals.funds).toBe(278_248 + 193_795);
  });

  it('derives loan repayments from notes only when they reconcile, and treats "Returned on" as expected date', async () => {
    const p = await plan();
    const rav = p.receivables.find((r) => r.counterparty === 'Ravinder Friend')!;
    expect(rav).toMatchObject({
      lent: 50_000,
      outstanding: 7000,
      repayments: [{ amount: 43_000, on: '2024-09-01' }],
    });
    const som = p.receivables.find((r) => r.counterparty === 'Somesh Pratap')!;
    expect(som).toMatchObject({
      lent: 200_000,
      outstanding: 200_000,
      expectedOn: '2026-07-04',
      lentOn: '2025-06-20',
      repayments: [],
    });
  });

  it('keeps ambiguous repayment notes as needs_input when you have not resolved them', async () => {
    const wbBytes = await fixture();
    const p = await planWorkbook(wbBytes, { asOf: '2026-10-25', resolutions: { F14: 'unknown' } });
    expect(p.exceptions.find((e) => e.code === 'loan_repayment_ambiguous')?.severity).toBe(
      'needs_input',
    );
    expect(p.receivables.find((r) => r.counterparty === 'Somesh Pratap')!.outstanding).toBe(
      200_000,
    );
  });

  it('shows money in someone else’s account as third-party-held with the beneficial owner', async () => {
    const p = await plan();
    expect(p.assets.find((a) => a.key === 'tp:15')).toMatchObject({
      type: 'third_party_held',
      holderName: 'Atul',
      beneficialOwnerKey: 'rupash',
    });
  });

  it('turns "Changes Req" into tasks, marking completed ones done', async () => {
    const p = await plan();
    expect(p.tasks.map((t) => [t.title, t.status])).toEqual([
      ['Address Change', 'open'],
      ['KYC Completed', 'done'],
    ]);
  });

  it('collapses a policy repeated across family columns into one policy with several insured, and masks the policy number', async () => {
    const p = await plan();
    const niva = p.policies.find((x) => x.kind === 'health_in')!;
    expect(niva.insuredKeys).toEqual(['rupash', 'ragini']);
    expect(niva.coverage).not.toContain('12345678901234');
    expect(niva.coverage).toContain('…1234');
  });

  it('reads the property price and flags that it is a purchase price', async () => {
    const p = await plan();
    expect(p.properties[0]).toMatchObject({ value: 2_500_000, valuedOn: '2023-12-15' });
    expect(codes(p)).toContain('property_value_is_purchase_price');
  });

  it('reconciles the imported total with the sheet total and never drops an amount silently', async () => {
    const p = await plan();
    const total = p.reconciliation.find((r) => r.check.includes('F114'))!;
    expect(total.ok).toBe(true);
    expect(p.controlTotals.importedF).toBe(total.expected);
  });
});

describe('maskIdentifiers', () => {
  it('keeps only the last 4 digits of long numbers', () => {
    expect(maskIdentifiers('Policy Number : 12345678901234 ok')).toBe('Policy Number : …1234 ok');
    expect(maskIdentifiers('FD Number : 999911112222-1')).toBe('FD Number : …2222');
    expect(maskIdentifiers('Lounge 12 times')).toBe('Lounge 12 times');
  });
});

// Runs only where the real workbook is available (never in CI): FWOS_WORKBOOK=/path/to.xlsx pnpm test
const realFile = process.env.FWOS_WORKBOOK;
describe.skipIf(!realFile || !existsSync(realFile))('real workbook control totals', () => {
  it('reproduces every control total from the sheet', async () => {
    const p = await planWorkbook(realFile!, { asOf: '2026-10-25' });
    for (const c of p.reconciliation) expect(c.ok, c.check).toBe(true);
    expect(p.fixedDeposits).toHaveLength(33);
    expect(p.controlTotals.fdPrincipal).toBe(19_179_860);
  });
});

describe('deposit numbers are kept whole (account numbers are not)', () => {
  it('lists each deposit number with its bank and last four digits, for matching in the database', async () => {
    const { fdNumbersFromPlan } = await import('../src/workbook');
    const plan = {
      institutions: [{ key: 'i1', name: 'Sample Bank', kind: 'bank' }],
      assets: [
        { key: 'fd:1', institutionKey: 'i1' },
        { key: 'fd:2', institutionKey: 'i1' },
      ],
      fixedDeposits: [
        { assetKey: 'fd:1', ref: '300017790142-1', refLast4: '0142' },
        { assetKey: 'fd:2', refLast4: '9999' },
      ],
    } as unknown as Parameters<typeof fdNumbersFromPlan>[0];
    expect(fdNumbersFromPlan(plan)).toEqual([
      { bank: 'Sample Bank', last4: '0142', fdRef: '300017790142-1' },
    ]);
  });
});
