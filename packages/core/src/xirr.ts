/**
 * Transaction-based XIRR.
 *
 * Convention (same as Excel XIRR): rate r solves  Σ cf_i / (1+r)^((d_i - d_0)/365) = 0.
 * Sign convention: money INVESTED is negative, money RECEIVED (redemptions, terminal value) is positive.
 * Never returns a silent 0: every outcome has an explicit status.
 */
export interface CashFlow {
  date: Date;
  amount: number;
}

export type XirrStatus =
  | 'ok'
  | 'ok_multiple_roots' // more than one sign change in NPV(rate); `rate` is the root nearest 0, all in `roots`
  | 'insufficient_flows' // fewer than 2 flows
  | 'no_sign_change' // need at least one negative and one positive flow
  | 'zero_span' // all flows on the same date
  | 'did_not_converge'
  | 'invalid_input';

export interface XirrResult {
  status: XirrStatus;
  rate: number | null;
  roots: number[];
  message: string;
}

const MS_PER_DAY = 86_400_000;

function yearFractions(flows: CashFlow[]): { t: number[]; amounts: number[] } {
  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const d0 = Date.UTC(
    sorted[0]!.date.getUTCFullYear(),
    sorted[0]!.date.getUTCMonth(),
    sorted[0]!.date.getUTCDate(),
  );
  const t = sorted.map((f) => {
    const d = Date.UTC(f.date.getUTCFullYear(), f.date.getUTCMonth(), f.date.getUTCDate());
    return (d - d0) / MS_PER_DAY / 365;
  });
  return { t, amounts: sorted.map((f) => f.amount) };
}

function npv(rate: number, t: number[], a: number[]): number {
  let s = 0;
  for (let i = 0; i < t.length; i++) s += a[i]! / Math.pow(1 + rate, t[i]!);
  return s;
}

function dnpv(rate: number, t: number[], a: number[]): number {
  let s = 0;
  for (let i = 0; i < t.length; i++) s += (-t[i]! * a[i]!) / Math.pow(1 + rate, t[i]! + 1);
  return s;
}

function bisect(lo: number, hi: number, t: number[], a: number[]): number | null {
  let fLo = npv(lo, t, a);
  const fHi = npv(hi, t, a);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, t, a);
    if (Math.abs(fMid) < 1e-9 || (hi - lo) / 2 < 1e-13) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** Polish a bracketed root with Newton steps (kept inside the bracket). */
function refine(root: number, t: number[], a: number[]): number {
  let r = root;
  for (let i = 0; i < 20; i++) {
    const f = npv(r, t, a);
    const d = dnpv(r, t, a);
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -0.999999999) break;
    if (Math.abs(next - r) < 1e-14) return next;
    r = next;
  }
  return r;
}

export function xirr(flows: CashFlow[]): XirrResult {
  const fail = (status: XirrStatus, message: string): XirrResult => ({
    status,
    rate: null,
    roots: [],
    message,
  });

  if (flows.some((f) => !Number.isFinite(f.amount) || Number.isNaN(f.date.getTime()))) {
    return fail('invalid_input', 'A cash flow has an invalid date or amount.');
  }
  const nonZero = flows.filter((f) => f.amount !== 0);
  if (nonZero.length < 2) return fail('insufficient_flows', 'At least two non-zero cash flows are required.');
  if (!nonZero.some((f) => f.amount < 0) || !nonZero.some((f) => f.amount > 0)) {
    return fail('no_sign_change', 'XIRR needs at least one investment (negative) and one return (positive).');
  }
  const { t, amounts } = yearFractions(nonZero);
  if (t[t.length - 1] === 0) return fail('zero_span', 'All cash flows fall on the same date.');

  // Scan a grid of rates for sign changes of NPV (detects multiple roots).
  const grid: number[] = [];
  for (let r = -0.99; r < 0; r += 0.01) grid.push(r);
  for (let r = 0; r <= 1; r += 0.01) grid.push(r);
  for (let r = 1; r <= 10; r += 0.1) grid.push(r);
  for (let r = 10; r <= 1000; r *= 1.2) grid.push(r);

  const roots: number[] = [];
  let prevR = grid[0]!;
  let prevF = npv(prevR, t, amounts);
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i]!;
    const f = npv(r, t, amounts);
    if (Number.isFinite(prevF) && Number.isFinite(f)) {
      if (f === 0) roots.push(r);
      else if (prevF * f < 0) {
        const b = bisect(prevR, r, t, amounts);
        if (b !== null) roots.push(refine(b, t, amounts));
      }
    }
    prevR = r;
    prevF = f;
  }
  const unique = roots
    .sort((x, y) => x - y)
    .filter((x, i, arr) => i === 0 || Math.abs(x - arr[i - 1]!) > 1e-9);

  if (unique.length === 0) {
    return fail('did_not_converge', 'No rate between -99% and a very large value solves the cash flows.');
  }
  const nearest = [...unique].sort((x, y) => Math.abs(x) - Math.abs(y))[0]!;
  if (unique.length > 1) {
    return {
      status: 'ok_multiple_roots',
      rate: nearest,
      roots: unique,
      message: `Multiple valid rates exist (${unique.map((u) => (u * 100).toFixed(2) + '%').join(', ')}); showing the one nearest zero.`,
    };
  }
  return { status: 'ok', rate: unique[0]!, roots: unique, message: 'ok' };
}
