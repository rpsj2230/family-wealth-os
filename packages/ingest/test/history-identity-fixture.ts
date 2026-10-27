/**
 * A synthetic workbook for identifying savings and cash lines from the other tabs. Invented people, banks and numbers only.
 * "Jan 2024" and "May 2024" name every account (Cash-NRE-1111, Cash-NRO-2222 ...); "Mar 2024" writes a plain "Cash" for the same
 * accounts, which is what older tabs do. Each bank-and-person is one case:
 *
 *   Sample Bank   two accounts, two plain lines in March, both neighbours list the same two      -> certain, by position
 *   Second Bank   one account in January, two in May, one plain line in March                    -> likely, the one open on both sides
 *   Third Bank    two accounts either side, one plain line in March                              -> likely, by the closer balance
 *   Fourth Bank   two lines that both say NRE where the neighbours have an NRE and an NRO        -> blocked, contradicts what it states
 *   Fifth Bank    two plain lines, the first with a balance far from what the account held       -> blocked (jump), the other certain
 *   Sixth Bank    two accounts, one plain line a month, in tabs that name no account             -> nothing to go on, ambiguous in every tab
 *   Seventh Bank  a joint and a single NRE account, one plain NRE line in March: matched to the single one only because the line does
 *                 not say "joint" (as before); the neighbours point to the joint one, so the month says "check it"
 */
import ExcelJS from 'exceljs';
import type { ExistingAsset } from '../src/history-match';
import { writeTab, type Spec, type TabSpec } from './history-fixture';

export const OWNERS = ['Asha', 'Vikram'];

const acct = (
  id: string,
  bank: string,
  label: string,
  kind: 'NRE' | 'NRO',
  last4: string,
  joint = false,
): ExistingAsset => ({
  id,
  type: 'bank_account',
  status: 'active',
  nickname: `${label} ${kind}`,
  label,
  last4,
  accountKind: kind,
  joint,
  holderName: null,
  currency: 'INR',
  ownerName: 'Asha',
  bank,
  fd: null,
});

/** The accounts on file (what the ordinary import of the newest tab left). */
export const ACCOUNTS: ExistingAsset[] = [
  acct('s1', 'Sample Bank', 'Cash-NRE-1111', 'NRE', '1111'),
  acct('s2', 'Sample Bank', 'Cash-NRO-2222', 'NRO', '2222'),
  acct('b1', 'Second Bank', 'Cash-NRE-3333', 'NRE', '3333'),
  acct('b2', 'Second Bank', 'Cash-NRO-4444', 'NRO', '4444'),
  acct('t1', 'Third Bank', 'Cash-NRE-5555', 'NRE', '5555'),
  acct('t2', 'Third Bank', 'Cash-NRO-6666', 'NRO', '6666'),
  acct('f1', 'Fourth Bank', 'Cash-NRE-7777', 'NRE', '7777'),
  acct('f2', 'Fourth Bank', 'Cash-NRO-8888', 'NRO', '8888'),
  acct('v1', 'Fifth Bank', 'Cash-NRE-9001', 'NRE', '9001'),
  acct('v2', 'Fifth Bank', 'Cash-NRO-9002', 'NRO', '9002'),
  acct('x1', 'Sixth Bank', 'Cash-NRE-1212', 'NRE', '1212'),
  acct('x2', 'Sixth Bank', 'Cash-NRO-3434', 'NRO', '3434'),
  acct('j1', 'Seventh Bank', 'Cash-NRE JO-0002', 'NRE', '0002', true),
  acct('j2', 'Seventh Bank', 'Cash-NRE-0001', 'NRE', '0001'),
];

const named = (bank: string, label: string, kind: 'NRE' | 'NRO', amount: number): Spec => ({
  bank: `${bank} - Asha`,
  type: label,
  tag: `Cash-${kind}`,
  amount,
});
/** a plain "Cash", the kind (if any) in the tag */
const plain = (bank: string, amount: number, kind?: 'NRE' | 'NRO'): Spec => ({
  bank: `${bank} - Asha`,
  type: 'Cash',
  tag: kind ? `Cash-${kind}` : 'Cash',
  amount,
});

export interface IdentityFixture {
  bytes: Uint8Array;
  tabs: TabSpec[];
}

export async function buildIdentityWorkbook(): Promise<IdentityFixture> {
  const named4 = (
    n: {
      s: [number, number];
      b: number[];
      t: [number, number];
      f: [number, number];
      v: [number, number];
    },
    second = false,
  ): Spec[] => [
    named('Sample Bank', 'Cash-NRE-1111', 'NRE', n.s[0]),
    named('Sample Bank', 'Cash-NRO-2222', 'NRO', n.s[1]),
    named('Second Bank', 'Cash-NRE-3333', 'NRE', n.b[0]!),
    ...(second ? [named('Second Bank', 'Cash-NRO-4444', 'NRO', n.b[1]!)] : []),
    named('Third Bank', 'Cash-NRE-5555', 'NRE', n.t[0]),
    named('Third Bank', 'Cash-NRO-6666', 'NRO', n.t[1]),
    named('Fourth Bank', 'Cash-NRE-7777', 'NRE', n.f[0]),
    named('Fourth Bank', 'Cash-NRO-8888', 'NRO', n.f[1]),
    named('Fifth Bank', 'Cash-NRE-9001', 'NRE', n.v[0]),
    named('Fifth Bank', 'Cash-NRO-9002', 'NRO', n.v[1]),
  ];
  const tabs: TabSpec[] = [
    {
      title: 'May 2024',
      era: 'new',
      rows: [
        ...named4(
          {
            s: [11_000, 2_200],
            b: [7_200, 900],
            t: [110_000, 5_200],
            f: [1_100, 2_100],
            v: [120, 220],
          },
          true,
        ),
        named('Seventh Bank', 'Cash-NRE JO-0002', 'NRE', 400),
        named('Seventh Bank', 'Cash-NRE-0001', 'NRE', 60),
      ],
    },
    {
      title: 'Apr 2024',
      era: 'new',
      rows: [plain('Sixth Bank', 520)],
    },
    {
      title: 'Mar 2024',
      era: 'new',
      rows: [
        plain('Sample Bank', 10_500),
        plain('Sample Bank', 2_100),
        plain('Second Bank', 7_100),
        plain('Third Bank', 5_100),
        plain('Fourth Bank', 1_000, 'NRE'),
        plain('Fourth Bank', 2_000, 'NRE'),
        plain('Fifth Bank', 9_000_000),
        plain('Fifth Bank', 150),
        plain('Sixth Bank', 510),
        plain('Seventh Bank', 55, 'NRE'),
      ],
    },
    { title: 'Feb 2024', era: 'new', rows: [plain('Sixth Bank', 500)] },
    {
      title: 'Jan 2024',
      era: 'new',
      rows: [
        ...named4({
          s: [10_000, 2_000],
          b: [7_000, 0],
          t: [100_000, 5_000],
          f: [1_000, 2_000],
          v: [100, 200],
        }),
        named('Seventh Bank', 'Cash-NRE JO-0002', 'NRE', 380),
      ],
    },
  ];
  const wb = new ExcelJS.Workbook();
  for (const t of tabs) writeTab(wb, t);
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), tabs };
}
