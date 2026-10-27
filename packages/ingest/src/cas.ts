/**
 * Reads a Consolidated Account Statement (CAS) from its text. The CAMS and KFintech statements (also the ones from
 * MF Central) list, per folio, a scheme with its ISIN, a dated transaction table and a closing balance with NAV and
 * value; the CDSL/NSDL statements list holdings. The text is read without relying on line breaks, because PDF text
 * extraction does not keep them reliably. Anything not understood is reported in `warnings`, never guessed.
 */
export type CasKind =
  | 'purchase'
  | 'sip'
  | 'switch_in'
  | 'dividend_reinvest'
  | 'bonus'
  | 'redeem'
  | 'switch_out'
  | 'other';

export interface CasTxn {
  date: string;
  kind: CasKind;
  description: string;
  amount: number;
  units: number;
  nav: number | null;
  balance: number | null;
}

export interface CasScheme {
  amc: string | null;
  folio: string;
  folioLast4: string;
  isin: string | null;
  name: string;
  openingUnits: number | null;
  closingUnits: number | null;
  navDate: string | null;
  nav: number | null;
  costValue: number | null;
  marketValue: number | null;
  transactions: CasTxn[];
  /** only the closing position is known (a holdings statement) */
  holdingsOnly: boolean;
  /** the scheme's transaction table says its SIP was cancelled or terminated (and on which date, when it says) */
  sipCancelled?: { on: string | null } | null;
  /** the holder named on the folio and the PAN printed on it: a statement can hold the folios of several people */
  holder?: string | null;
  folioPan?: string | null;
  /** why this scheme was not read cleanly (a name that is statement text, no name, no closing balance); absent when it was */
  unclear?: string | null;
}

export interface CasStatement {
  pan: string | null;
  /**
   * What the statement says its consolidation is keyed on. 'email': every folio registered with that email address (it can hold
   * several people's folios and can miss folios registered under another email). 'pan': the holder's PAN. 'unknown': not stated.
   */
  basis?: 'email' | 'pan' | 'unknown';
  periodFrom: string | null;
  periodTo: string | null;
  schemes: CasScheme[];
  warnings: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function casDate(s: string): string | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  if (mo === 0) return null;
  const iso = `${m[3]}-${String(mo).padStart(2, '0')}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.getUTCDate() === Number(m[1]) ? iso : null;
}

/** "1,234.50", "(1,000.00)" (negative) and "-5.00" */
export function casNumber(s: string): number {
  const neg = /^\(.*\)$/.test(s.trim()) || s.trim().startsWith('-');
  const n = Number(s.replace(/[(),\s-]/g, ''));
  return neg ? -n : n;
}

const DATE = String.raw`\d{2}-[A-Za-z]{3}-\d{4}`;
const AMT = String.raw`\(?-?[\d,]+\.\d{2}\)?`;
const UNITS = String.raw`\(?-?[\d,]+\.\d{3,4}\)?`;
const PRICE = String.raw`[\d,]+\.\d{2,4}`;
// date, a description with no date inside it, amount, units, price, unit balance
const TXN = new RegExp(
  String.raw`(${DATE})\s+((?:(?!${DATE}).)+?)\s+(${AMT})\s+(${UNITS})\s+(${PRICE})\s+(${UNITS})(?=\s|$)`,
  'g',
);

export function classify(description: string, units: number): CasKind {
  const d = description.toLowerCase();
  if (units < 0) return /switch/.test(d) ? 'switch_out' : 'redeem';
  if (/switch/.test(d)) return 'switch_in';
  if (/dividend|reinvest/.test(d)) return 'dividend_reinvest';
  if (/bonus/.test(d)) return 'bonus';
  if (/systematic|\bsip\b/.test(d)) return 'sip';
  if (/purchase|subscription|new fund offer|nfo|additional/.test(d)) return 'purchase';
  return 'other';
}

/** The scheme name sits between the folio header and the ISIN; strip codes, advisor notes and KYC/PAN flags. */
export function cleanSchemeName(raw: string): string {
  let s = raw
    .replace(/PAN\s*:\s*\S+/gi, ' ')
    .replace(/KYC\s*:\s*\S+/gi, ' ')
    .replace(/\(\s*Advisor[^)]*\)/gi, ' ')
    .replace(/\((?:Non-?\s*Demat|Demat|formerly[^)]*)\)/gi, ' ')
    .replace(/\bScheme\s*(?:Name)?\s*:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^(?:OK\s+)+/i, '').replace(/^[A-Z0-9]{2,10}\s*-\s+(?=[A-Za-z])/, '');
  // a scheme code glued to the name ("128EFDGG-Axis Large Cap Fund", "GD340-Bandhan Small Cap Fund"): the code has a digit in it
  s = s.replace(/^(?=[A-Z0-9]*\d)[A-Z0-9]{2,10}-(?=[A-Za-z])/, '');
  return s.replace(/[\s-]+$/, '').trim();
}

const money = (re: RegExp, t: string): number | null => {
  const m = re.exec(t);
  return m ? casNumber(m[m.length - 1]!) : null;
};

function parseSchemeBody(
  t: string,
  folio: string,
  name: string,
  isin: string | null,
  amc: string | null,
): CasScheme {
  const opening = money(/Opening Unit Balance\s*:?\s*([\d,]+\.\d+)/i, t);
  const closing = money(/Closing Unit Balance\s*:?\s*([\d,]+\.\d+)/i, t);
  const navM = new RegExp(
    String.raw`NAV on (${DATE})\s*:?\s*(?:INR|Rs\.?)?\s*([\d,]+\.\d+)`,
    'i',
  ).exec(t);
  const cost = money(/Total Cost Value\s*:?\s*(?:INR|Rs\.?)?\s*([\d,]+\.\d+)/i, t);
  const mv = money(
    new RegExp(String.raw`Market Value on ${DATE}\s*:?\s*(?:INR|Rs\.?)?\s*([\d,]+\.\d+)`, 'i'),
    t,
  );
  const txns: CasTxn[] = [];
  for (const m of t.matchAll(TXN)) {
    const date = casDate(m[1]!);
    if (!date) continue;
    const units = casNumber(m[4]!);
    const description = m[2]!.replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim();
    txns.push({
      date,
      kind: classify(description, units),
      description: description.slice(0, 200),
      amount: casNumber(m[3]!),
      units,
      nav: casNumber(m[5]!),
      balance: casNumber(m[6]!),
    });
  }
  // "dd-Mon-yyyy ***Cancelled***" / "***Cancellation***" in the table is a SIP cancelled on that date; a SIP started again afterwards
  // ("Instalment No - 1" later) is a replacement, not a stop
  const table = closeAtEarly(t);
  const markers = [
    ...table.matchAll(
      new RegExp(String.raw`(${DATE})\s+\*{3}\s*Cancell?(?:ed|ation)\s*\*{3}`, 'gi'),
    ),
  ];
  const lastMarker = markers.length ? casDate(markers[markers.length - 1]![1]!) : null;
  const restarted =
    lastMarker !== null && txns.some((x) => x.kind === 'sip' && x.date > lastMarker);
  const digits = folio.replace(/[^0-9A-Za-z]/g, '');
  // only the transaction table is read: the notes after the closing balance are general terms, not this scheme's history
  const closeAt = t.search(/Closing Unit Balance/i);
  const cancel = new RegExp(
    String.raw`(?:SIP|Systematic\s+Investment)[^.]{0,60}?\b(?:cancel(?:l)?ed|terminated|discontinued|ceased)\b`,
    'i',
  ).exec(closeAt > 0 ? t.slice(0, closeAt) : '');
  const cancelDate = cancel
    ? new RegExp(DATE).exec(
        t.slice(Math.max(0, cancel.index - 40), cancel.index + cancel[0].length + 40),
      )
    : null;
  return {
    amc,
    folio,
    folioLast4: digits.slice(-4),
    isin,
    name,
    openingUnits: opening,
    closingUnits: closing,
    navDate: navM ? casDate(navM[1]!) : null,
    nav: navM ? casNumber(navM[2]!) : null,
    costValue: cost,
    marketValue: mv,
    transactions: txns,
    holdingsOnly: false,
    ...(lastMarker && !restarted
      ? { sipCancelled: { on: lastMarker } }
      : cancel
        ? { sipCancelled: { on: cancelDate ? casDate(cancelDate[0]) : null } }
        : {}),
  };
}

/** The transaction table of a scheme: what comes before its closing balance. */
function closeAtEarly(t: string): string {
  const i = t.search(/Closing Unit Balance/i);
  return i > 0 ? t.slice(0, i) : t;
}

export function parseCas(raw: string): CasStatement {
  const t = raw.replace(/\s+/g, ' ');
  const warnings: string[] = [];
  const pan = /PAN\s*:\s*([A-Z]{5}[0-9]{4}[A-Z])/.exec(t)?.[1] ?? null;
  const period = new RegExp(String.raw`(${DATE})\s+To\s+(${DATE})`, 'i').exec(t);
  const schemes: CasScheme[] = [];

  const folioRe = /Folio No\s*:?\s*([0-9A-Za-z]+(?:\s*\/\s*[0-9A-Za-z]+)?)/gi;
  const folios = [...t.matchAll(folioRe)];
  folios.forEach((f, i) => {
    const start = f.index! + f[0].length;
    const end = i + 1 < folios.length ? folios[i + 1]!.index! : t.length;
    const section = t.slice(start, end);
    // one folio can list several schemes; each starts at its own ISIN
    const isins = [...section.matchAll(/ISIN\s*:\s*(INF[0-9A-Z]{9})/gi)];
    if (isins.length === 0) {
      warnings.push(`Folio ${f[1]}: no scheme ISIN found, skipped.`);
      return;
    }
    // Some statements come out of the PDF with each scheme's title and ISIN after its own table (the title was drawn last). Then the
    // table is what lies before the ISIN, and the name is the text after the table's last total.
    const titleLast = /Opening Unit Balance/i.test(section.slice(0, isins[0]!.index!));
    // who holds the folio and under which PAN: printed on the folio's header lines, and the only reliable way to tell whose folio it is
    // when one statement holds several people's folios
    const headLine = t.slice(f.index!, f.index! + 500);
    const hm =
      /Folio No\s*:?\s*\S+(?:\s*\/\s*\S+)?\s+PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])\s+(?:KYC\s*:\s*\S+\s+)?PAN\s*:\s*\S+\s+((?:[A-Za-z.'&]+\s+){0,8}?)(?=[A-Z0-9]{2,10}-[A-Za-z])/.exec(
        headLine,
      );
    const folioPan = hm?.[1] ?? /PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])/.exec(headLine)?.[1] ?? null;
    const holder = hm?.[2]?.trim() || null;
    isins.forEach((im, j) => {
      if (titleLast) {
        const from = j === 0 ? 0 : isins[j - 1]!.index! + isins[j - 1]![0].length;
        const seg = section.slice(from, im.index!);
        const totals = [
          ...seg.matchAll(
            /(?:Total Cost Value|Market Value on [^:]*)\s*:?\s*(?:INR|Rs\.?)?\s*[\d,]+\.\d+/gi,
          ),
        ];
        const last = totals[totals.length - 1];
        const tail = last ? seg.slice(last.index! + last[0].length) : '';
        const name = cleanSchemeName(tail.replace(/^.*?\bMutual Fund\b\s*/i, ''));
        const amc = /([A-Z][A-Za-z&.' ]+ Mutual Fund)/.exec(tail)?.[1] ?? null;
        const sc = parseSchemeBody(seg, f[1]!.trim(), name || 'Unnamed scheme', im[1]!, amc);
        if (sc.closingUnits === null) warnings.push(`${sc.name}: no closing balance found.`);
        schemes.push({ ...sc, holder: null, folioPan });
        return;
      }
      const nameFrom = j === 0 ? 0 : isins[j]!.index! - 0;
      const prevEnd =
        j === 0 ? 0 : section.slice(0, im.index!).lastIndexOf('Closing Unit Balance') + 1 || 0;
      const head = section.slice(j === 0 ? 0 : Math.max(prevEnd, 0), im.index!);
      // the name is what follows the last closing-balance text of the previous scheme, if any
      const afterPrev =
        j === 0
          ? head
          : head.replace(/^.*?Market Value on [^:]*:\s*(?:INR|Rs\.?)?\s*[\d,]+\.\d+/i, '');
      void nameFrom;
      let name = cleanSchemeName(afterPrev);
      if (j === 0 && holder && name.toLowerCase().startsWith(holder.toLowerCase())) {
        // the holder's name and the registrar's scheme code come before the scheme's own name
        name = name
          .slice(holder.length)
          .trim()
          .replace(/^[A-Z0-9]{2,10}-(?=[A-Za-z])/, '')
          .trim();
      }
      const bodyStart = im.index! + im[0].length;
      const bodyEnd = j + 1 < isins.length ? isins[j + 1]!.index! : section.length;
      const amc =
        /([A-Z][A-Za-z&.' ]+ Mutual Fund)/.exec(
          t.slice(Math.max(0, f.index! - 200), f.index!),
        )?.[1] ?? null;
      const s = parseSchemeBody(
        section.slice(bodyStart, bodyEnd),
        f[1]!.trim(),
        name || 'Unnamed scheme',
        im[1]!,
        amc,
      );
      if (s.closingUnits === null) warnings.push(`${s.name}: no closing balance found.`);
      schemes.push({ ...s, holder, folioPan });
    });
  });

  // a name this long is statement text, not a scheme name: say so instead of showing a page of text as a fund
  for (const sc of schemes) {
    if (sc.name.length > 150) {
      warnings.push(
        `Folio ${sc.folio}: the scheme name could not be read cleanly (ISIN ${sc.isin ?? 'unknown'}); check this fund by its ISIN.`,
      );
      sc.name = `${sc.name.slice(0, 110).trim()}…`;
    }
  }

  for (const sc of schemes) {
    if (sc.name.endsWith('…') || sc.name === 'Unnamed scheme')
      sc.unclear = 'the scheme name could not be read cleanly';
    else if (sc.closingUnits === null) sc.unclear = 'no closing balance was found';
  }

  if (schemes.length === 0) {
    // holdings statements (demat): ISIN, name, units, NAV, value
    const hold =
      /(INF[0-9A-Z]{9})\s+(.+?)\s+([\d,]+\.\d{3,4})\s+([\d,]+\.\d{2,4})\s+([\d,]+\.\d{2})(?=\s|$)/g;
    for (const m of t.matchAll(hold)) {
      schemes.push({
        amc: null,
        folio: 'demat',
        folioLast4: 'demt',
        isin: m[1]!,
        name: cleanSchemeName(m[2]!),
        openingUnits: null,
        closingUnits: casNumber(m[3]!),
        navDate: period ? casDate(period[2]!) : null,
        nav: casNumber(m[4]!),
        costValue: null,
        marketValue: casNumber(m[5]!),
        transactions: [],
        holdingsOnly: true,
      });
    }
    if (schemes.length > 0)
      warnings.push(
        'This looks like a holdings statement: balances are read, but there is no transaction history.',
      );
    else warnings.push('No folios or holdings were recognised in this statement.');
  }
  const basisM = /consolidation has been carried out based on the (email|PAN)/i.exec(t);
  return {
    pan,
    basis: basisM ? (basisM[1]!.toLowerCase() === 'email' ? 'email' : 'pan') : 'unknown',
    periodFrom: period ? casDate(period[1]!) : null,
    periodTo: period ? casDate(period[2]!) : null,
    schemes,
    warnings,
  };
}

// ------------------------------------------------------------------------------------------------
// Lots (first in, first out)
// ------------------------------------------------------------------------------------------------
export interface CasLot {
  acquiredOn: string;
  units: number;
  /** cost of the units still held; null when the purchase is before the statement began */
  cost: number | null;
}

export interface CasRealised {
  soldOn: string;
  acquiredOn: string;
  units: number;
  cost: number | null;
  proceeds: number;
}

export interface LotResult {
  lots: CasLot[];
  realised: CasRealised[];
  /** the lots add up to the closing balance, so they can be relied on */
  reconciled: boolean;
  /** units held before the first transaction on the statement, whose purchases are not on it */
  priorUnits: number;
}

const EARLY = '1900-01-01';

/** The units the lots may be out by against the closing balance (a statement prints units to three or four decimals). */
export const LOT_UNIT_TOLERANCE = 0.01;

export function fifoLots(
  s: Pick<CasScheme, 'transactions' | 'openingUnits' | 'closingUnits' | 'costValue'>,
): LotResult {
  const txns = [...s.transactions].sort((a, b) => a.date.localeCompare(b.date));
  const prior = s.openingUnits && s.openingUnits > 0.0005 ? s.openingUnits : 0;
  const lots: CasLot[] = prior > 0 ? [{ acquiredOn: EARLY, units: prior, cost: null }] : [];
  const realised: CasRealised[] = [];
  for (const t of txns) {
    if (t.units > 0) {
      lots.push({
        acquiredOn: t.date,
        units: t.units,
        cost: t.kind === 'bonus' ? 0 : Math.abs(t.amount),
      });
      continue;
    }
    if (t.units < 0) {
      let left = -t.units;
      const perUnit = Math.abs(t.amount) / left;
      while (left > 0.00005 && lots.length > 0) {
        const lot = lots[0]!;
        const take = Math.min(lot.units, left);
        const costShare = lot.cost === null ? null : (lot.cost * take) / lot.units;
        realised.push({
          soldOn: t.date,
          acquiredOn: lot.acquiredOn,
          units: take,
          cost: costShare,
          proceeds: perUnit * take,
        });
        if (lot.cost !== null) lot.cost -= costShare ?? 0;
        lot.units -= take;
        left -= take;
        if (lot.units < 0.00005) lots.shift();
      }
    }
  }
  const held = lots.reduce((a, l) => a + l.units, 0);
  const reconciled =
    s.closingUnits !== null && Math.abs(held - s.closingUnits) <= LOT_UNIT_TOLERANCE;
  // units from before the statement: cost is what the statement's total cost leaves after the known lots
  if (prior > 0 && s.costValue !== null) {
    const known = lots.reduce((a, l) => a + (l.cost ?? 0), 0);
    const first = lots.find((l) => l.acquiredOn === EARLY);
    if (first) first.cost = Math.max(0, s.costValue - known);
  }
  return { lots, realised, reconciled, priorUnits: prior };
}

/** Sender or subject of a fund statement mail from a registrar or depository. */
export function looksLikeCas(m: { from: string; subject: string }): boolean {
  return (
    /consolidated account statement|\bcas\b|mutual fund (?:folio|statement)/i.test(m.subject) ||
    /@(?:[\w-]+\.)*(?:camsonline|cams|kfintech|mfcentral|cdslindia|nsdl)\./i.test(m.from)
  );
}
