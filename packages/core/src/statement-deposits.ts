/**
 * Deposits the statements show but the portal has no record of. A deposit leaves two lines on its account's statement: the
 * booking ("FD …1907 BOOKED VIA NET BANKING", "NEWFD/…7437/", "TransferDebit for FD Ac …8153", "FD BOOKING …4471") and, later,
 * the pay-back ("FD/RD …1907 MATURITY :ACCOUNT CREDITED", "…4471 : CLOSURE PROCEEDS", "DEP FD PRE CLOSURE/…3743 7/"). Both print
 * the deposit's number (cut to its last four digits when the line was saved), so the two lines of one deposit find each other by
 * it. Each pair is a deposit that ran from the booking to the pay-back: its principal is the booking, what it paid back is the sum
 * of the pay-back lines (principal and interest are sometimes two lines), and its yearly rate is what makes the one grow into the
 * other. Pure: the lines and how the rules classed them are passed in.
 */
import { addDaysIso } from './harvest-lots';

export interface DepositLine {
  id: string;
  assetId: string;
  date: string;
  /** + money in, − money out */
  amount: number;
  narration: string;
}

export interface StatementDeposit {
  /** the savings account the deposit was booked from and paid back to */
  accountId: string;
  /** the deposit number's last four digits, as the narrations print it */
  last4: string;
  bookedOn: string;
  endedOn: string;
  principal: number;
  /** principal and interest paid back */
  paidBack: number;
  /** a yearly rate (quarterly compounding) that grows the principal into what was paid back; 0 when less came back (closed early) */
  rate: number;
  bookingLineId: string;
  paybackLineIds: string[];
}

/**
 * The deposit numbers a narration prints, by their last four digits. The account's own number is left out. A number the bank
 * broke over two lines ("CLOSURE/1026000003743" then "7/2303…") was saved as "…3743 7": its true last four are "7437".
 */
export function depositNumbers(narration: string, accountLast4: string | null): string[] {
  const out = new Set<string>();
  for (const m of narration.matchAll(/…(\d{4})(?:\s(\d)(?=[/\s]|$))?/g)) {
    out.add(m[1]!);
    if (m[2]) out.add(`${m[1]!.slice(1)}${m[2]}`);
  }
  if (accountLast4) out.delete(accountLast4);
  return [...out];
}

const yearsBetween = (a: string, b: string) =>
  (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);

/**
 * Pairs the bookings and pay-backs on one account that no deposit on file explains, by the deposit number both print. A pay-back
 * pairs with the latest booking of that number before it; pay-back lines of one number within three days of each other are one
 * pay-back. Bookings and pay-backs that find no partner are left out (a deposit booked before the first statement, or still running).
 */
export function depositsFromStatements(
  bookings: DepositLine[],
  paybacks: DepositLine[],
  accountLast4: Map<string, string | null>,
): StatementDeposit[] {
  const out: StatementDeposit[] = [];
  const used = new Set<string>();
  const sortedBacks = [...paybacks].sort((a, b) => a.date.localeCompare(b.date));
  for (const back of sortedBacks) {
    if (used.has(back.id) || back.amount <= 0) continue;
    const nums = depositNumbers(back.narration, accountLast4.get(back.assetId) ?? null);
    if (!nums.length) continue;
    const booking = bookings
      .filter(
        (b) =>
          !used.has(b.id) &&
          b.amount < 0 &&
          b.assetId === back.assetId &&
          b.date < back.date &&
          depositNumbers(b.narration, accountLast4.get(b.assetId) ?? null).some((n) =>
            nums.includes(n),
          ),
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!booking) continue;
    const last4 = depositNumbers(booking.narration, accountLast4.get(booking.assetId) ?? null).find(
      (n) => nums.includes(n),
    )!;
    // the other pay-back lines of the same deposit (principal and interest paid separately)
    const together = sortedBacks.filter(
      (o) =>
        !used.has(o.id) &&
        o.amount > 0 &&
        o.assetId === back.assetId &&
        o.date >= back.date &&
        o.date <= addDaysIso(back.date, 3) &&
        depositNumbers(o.narration, accountLast4.get(o.assetId) ?? null).includes(last4),
    );
    for (const o of together) used.add(o.id);
    used.add(booking.id);
    const principal = Math.round(-booking.amount * 100) / 100;
    const paidBack = Math.round(together.reduce((s, o) => s + o.amount, 0) * 100) / 100;
    const endedOn = together[together.length - 1]!.date;
    const years = Math.max(yearsBetween(booking.date, endedOn), 1 / 365);
    const rate = paidBack > principal ? 4 * ((paidBack / principal) ** (1 / (4 * years)) - 1) : 0;
    out.push({
      accountId: back.assetId,
      last4,
      bookedOn: booking.date,
      endedOn,
      principal,
      paidBack,
      rate: Math.min(Math.round(rate * 1e6) / 1e6, 0.5),
      bookingLineId: booking.id,
      paybackLineIds: together.map((o) => o.id),
    });
  }
  return out.sort((a, b) => a.bookedOn.localeCompare(b.bookedOn) || a.last4.localeCompare(b.last4));
}
