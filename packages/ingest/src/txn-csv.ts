/**
 * Reads a fund-transactions CSV exported by an investment app (the Kuvera layout:
 * `Date, Folio Number, Name of the Fund, Order, Units, NAV, Current Nav, Amount (INR)`) and turns it into the same
 * statement shape the CAS importer uses, so matching, lots, invested amount, SIP detection and valuation follow one set of rules.
 *
 * Nothing here talks to a database. A line that cannot be understood is reported in `warnings` and left out, never guessed.
 */
import { fifoLots, type CasKind, type CasScheme, type CasStatement, type CasTxn } from './cas';

export interface TxnCsvRow {
  date: string;
  folio: string;
  fund: string;
  order: 'buy' | 'sell';
  units: number;
  nav: number;
  currentNav: number | null;
  amount: number;
}

export interface TxnCsvResult {
  rows: TxnCsvRow[];
  warnings: string[];
}

/** One line of CSV text into cells, honouring "quoted, cells" and doubled quotes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
const COLUMNS: Record<string, string[]> = {
  date: ['date'],
  folio: ['folio number', 'folio no', 'folio'],
  fund: ['name of the fund', 'fund name', 'scheme name', 'scheme', 'fund'],
  order: ['order', 'order type', 'transaction type', 'type'],
  units: ['units'],
  nav: ['nav', 'price', 'nav at purchase'],
  currentNav: ['current nav', 'latest nav'],
  amount: ['amount inr', 'amount', 'amount in inr'],
};

function number(s: string): number | null {
  const t = s.replace(/[,₹\s]/g, '');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function isoDate(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) ?? null;
  let y: string, mo: string, d: string;
  if (m) [, y, mo, d] = m as unknown as [string, string, string, string];
  else {
    const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
    if (!dmy) return null;
    [, d, mo, y] = dmy as unknown as [string, string, string, string];
  }
  const iso = `${y}-${mo}-${d}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return t.getUTCDate() === Number(d) && t.getUTCMonth() + 1 === Number(mo) ? iso : null;
}

const BUY = new Set(['buy', 'purchase', 'sip', 'invest', 'switch in']);
const SELL = new Set(['sell', 'redeem', 'redemption', 'withdraw', 'switch out']);

export function parseTxnCsv(text: string): TxnCsvResult {
  const warnings: string[] = [];
  const rows: TxnCsvRow[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const head = lines.findIndex((l) => l.trim() !== '');
  if (head < 0) return { rows, warnings: ['The file is empty.'] };
  const names = cells(lines[head]!).map(norm);
  const at: Record<string, number> = {};
  for (const [key, options] of Object.entries(COLUMNS)) {
    const i = names.findIndex((n) => options.includes(n));
    if (i >= 0) at[key] = i;
  }
  const missing = ['date', 'fund', 'order', 'units', 'amount'].filter((k) => at[k] === undefined);
  if (missing.length)
    return {
      rows,
      warnings: [
        `This does not look like a fund-transactions export: the columns for ${missing.join(', ')} were not found.`,
      ],
    };
  for (let i = head + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '') continue;
    const c = cells(lines[i]!);
    const get = (k: string) => (at[k] === undefined ? '' : (c[at[k]!] ?? ''));
    const where = `line ${i + 1}`;
    const date = isoDate(get('date'));
    const order = get('order').toLowerCase().replace(/\s+/g, ' ');
    const units = number(get('units'));
    const amount = number(get('amount'));
    const nav = number(get('nav'));
    const fund = get('fund').replace(/\s+/g, ' ').trim();
    if (!date || !fund || units === null || amount === null) {
      warnings.push(`${where}: left out (date, fund, units or amount could not be read).`);
      continue;
    }
    if (!BUY.has(order) && !SELL.has(order)) {
      warnings.push(`${where}: left out (order type "${get('order')}" is not a buy or a sell).`);
      continue;
    }
    if (units <= 0 || amount <= 0) {
      warnings.push(`${where}: left out (units and amount must be above zero).`);
      continue;
    }
    rows.push({
      date,
      folio: get('folio').replace(/\s+/g, ''),
      fund,
      order: BUY.has(order) ? 'buy' : 'sell',
      units,
      nav: nav ?? amount / units,
      currentNav: number(get('currentNav')),
      amount,
    });
  }
  return { rows, warnings };
}

const fundKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const digits = (s: string) => s.replace(/\D/g, '');
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const DAY = 86_400_000;
const gap = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * A purchase is a SIP instalment when the same amount is bought on at least three dates and this one sits about a month
 * from the one before or after it. Anything else is a one-time purchase.
 */
function sipDates(buys: TxnCsvRow[]): Set<string> {
  const byAmount = new Map<number, string[]>();
  for (const b of buys) {
    const k = Math.round(b.amount);
    byAmount.set(k, [...new Set([...(byAmount.get(k) ?? []), b.date])].sort());
  }
  const out = new Set<string>();
  for (const [amount, dates] of byAmount) {
    if (dates.length < 3) continue;
    dates.forEach((d, i) => {
      const before = i > 0 ? gap(dates[i - 1]!, d) : null;
      const after = i < dates.length - 1 ? gap(d, dates[i + 1]!) : null;
      if ([before, after].some((g) => g !== null && g >= 24 && g <= 38)) out.add(`${amount}|${d}`);
    });
  }
  return out;
}

export interface FundCsvStatement {
  statement: CasStatement;
  /** what was done to the file's contents, one line each */
  notes: string[];
}

/**
 * Groups the lines by fund (folios of the same fund are one holding), works out units, cost and value, and returns a statement
 * the fund-statement importer can apply. The value is units times the "Current Nav" the export carries, dated `today`.
 */
export function fundCsvToStatement(rows: TxnCsvRow[], today: string): FundCsvStatement {
  const notes: string[] = [];
  const warnings: string[] = [];
  const groups = new Map<string, TxnCsvRow[]>();
  for (const r of rows) {
    if (!r.folio) {
      // lines without a folio are app-specific products (for example digital gold), not mutual fund schemes
      notes.push(`${r.fund}: left out (no folio number, so it is not a mutual fund scheme).`);
      continue;
    }
    groups.set(fundKey(r.fund), [...(groups.get(fundKey(r.fund)) ?? []), r]);
  }
  const schemes: CasScheme[] = [];
  for (const g of [...groups.values()].sort((a, b) => a[0]!.fund.localeCompare(b[0]!.fund))) {
    const sorted = [...g].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.order === b.order ? 0 : a.order === 'buy' ? -1 : 1),
    );
    const sip = sipDates(sorted.filter((r) => r.order === 'buy'));
    let balance = 0;
    const transactions: CasTxn[] = sorted.map((r) => {
      const sell = r.order === 'sell';
      balance = round(balance + (sell ? -r.units : r.units), 3);
      const kind: CasKind = sell
        ? 'redeem'
        : sip.has(`${Math.round(r.amount)}|${r.date}`)
          ? 'sip'
          : 'purchase';
      return {
        date: r.date,
        kind,
        description: `${sell ? 'Redemption' : kind === 'sip' ? 'SIP purchase' : 'Purchase'} (folio ${r.folio})`,
        amount: sell ? -r.amount : r.amount,
        units: sell ? -r.units : r.units,
        nav: r.nav,
        balance,
      };
    });
    const folios = [...new Set(sorted.map((r) => r.folio))];
    const latest = sorted[sorted.length - 1]!;
    const name = sorted[0]!.fund;
    if (balance < -0.0005) {
      warnings.push(
        `${name}: more units sold than bought in this file (${Math.abs(balance)} short); the history before the file's first line is missing, so this fund was left out.`,
      );
      continue;
    }
    const closing = Math.max(0, balance);
    const nav =
      [...sorted].reverse().find((r) => r.currentNav !== null && r.currentNav > 0)?.currentNav ??
      null;
    const lots = fifoLots({
      transactions,
      openingUnits: 0,
      closingUnits: closing,
      costValue: null,
    });
    const cost = round(
      lots.lots.reduce((a, l) => a + (l.cost ?? 0), 0),
      2,
    );
    if (folios.length > 1)
      notes.push(`${name}: ${folios.length} folios are combined into one holding.`);
    schemes.push({
      amc: null,
      folio: latest.folio,
      folioLast4: digits(latest.folio).slice(-4) || 'none',
      isin: null,
      name,
      openingUnits: 0,
      closingUnits: closing,
      navDate: nav === null ? null : today,
      nav,
      costValue: closing > 0.0005 ? cost : 0,
      marketValue: nav === null ? null : round(closing * nav, 2),
      transactions,
      holdingsOnly: false,
    });
  }
  const dates = rows.map((r) => r.date).sort();
  return {
    statement: {
      pan: null,
      periodFrom: dates[0] ?? null,
      periodTo: today,
      schemes,
      warnings,
    },
    notes,
  };
}
