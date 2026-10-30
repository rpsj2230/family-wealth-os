/**
 * What each line of a bank statement was (Explain movements > Bank statements), so own money and lifetime profit can be worked out
 * from what really happened rather than from the change in balances.
 *
 * The rules run in this order, and the first that fits decides:
 *   1. your own answer for the line, when you gave one;
 *   2. interest credited to the account, and the tax taken at source on it (the same day); a deposit's interest paid into the
 *      account is the deposit's own earnings;
 *   3. rent: a credit with one of the words in Settings (the tenant's name): earnings;
 *   4. money sent from abroad: a credit with one of the remittance words in Settings: own money coming in;
 *   5. a transfer between your own accounts: the same sum leaving one account and arriving in another within a few days;
 *   6. a deposit booked from the account (the deposit's amount, on its booking day) or paid back into it (on its maturity or closing day);
 *   7. a fund purchase or sale in your CAS: the same sum within a few days of the allotment;
 *   8. the same, from the wording alone (a deposit, a fund house, a clearing house), when the other side is not on file;
 *   9. a transfer naming another of your accounts by its last four digits;
 *  10. bank charges;
 *  11. anything else: below the limit in Settings a debit is spending and a credit a small amount coming in; above it, you are asked.
 *
 * Money moved between your own holdings changes nothing in the family's own money; money in from outside and money out are own money;
 * interest, rent and earnings you name are profit. `statementMoves` turns the lines into the ledger's confirmed movements, one per
 * account, month and kind, so ten years of lines stay a few hundred movements.
 *
 * Pure: no I/O.
 */
import { addDaysIso } from './harvest-lots';

export type LineClass =
  | 'interest'
  | 'interest_tax'
  | 'fd_interest'
  | 'own_transfer'
  | 'fd_funding'
  | 'fd_proceeds'
  | 'fund_buy'
  | 'fund_sell'
  | 'outside_in'
  | 'rent'
  | 'income'
  | 'fee'
  | 'tax'
  | 'spent'
  | 'ask_in'
  | 'ask_out';

/** What you can say a line was. */
export type LineAnswer = 'outside' | 'own' | 'income' | 'rent' | 'out';

export interface StmtLine {
  id: string;
  assetId: string;
  ownerId: string;
  date: string;
  /** + money in, − money out */
  amount: number;
  narration: string;
  answer?: LineAnswer | null;
}

export interface ClassifyContext {
  accounts: { assetId: string; ownerId: string; last4: string | null; bank?: string | null }[];
  /** the household's people, by the names a bank writes them in a narration (first names; a one-letter slip is still them) */
  people?: { ownerId: string; names: string[] }[];
  /** the Singapore account money from abroad leaves (a Wise or DBS remittance moves money out of it) */
  singaporeAssetId?: string | null;
  deposits: {
    assetId: string;
    ownerId: string;
    /** the bank the deposit is with, when known: a deposit is booked from, and paid back to, an account at the same bank */
    bank?: string | null;
    principal: number;
    bookedOn: string;
    maturityOn: string;
    endedOn: string | null;
    maturityAmount: number | null;
  }[];
  /** the purchases and sales in your fund statements (CAS), in rupees */
  fundTxns: {
    ownerId: string;
    /** the fund, so the money that bought it can be followed */
    assetId?: string;
    date: string;
    amount: number;
    side: 'buy' | 'sell';
  }[];
  rentWords: string[];
  remittanceWords: string[];
  reviewAbove: number;
  pairDays: number;
  fundDays: number;
  /** transfers from Singapore already on file (Wise): a credit of the same sum a few days after is that transfer */
  remittances?: {
    id: string;
    date: string;
    amount: number;
    toAssetId: string | null;
    fromAssetId: string | null;
  }[];
}

export interface Classified {
  id: string;
  cls: LineClass;
  /** the other holding, when it is known: the paired account, the deposit */
  counterpart: string | null;
  reason: string;
  /** the transfer from Singapore on file that this credit is */
  remittanceId?: string;
  /** money from Singapore with no transfer on file yet (it can be added as one) */
  fromSingapore?: boolean;
  /** the person whose account is on the other side, when the narration names one of the household */
  person?: string;
}

const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole word or phrase, any case, any spacing. */
const hasWord = (text: string, words: string[]) =>
  words.some((w) =>
    new RegExp(`(^|[^a-z0-9])${escape(w).replace(/\s+/g, '\\s*')}($|[^a-z0-9])`, 'i').test(text),
  );

const INTEREST =
  /\bint(?:erest)?\b\.?\s*(?:pd|paid|cr|credit|capitali[sz]ed|coll)?|\bint\.?pd\b|\binterest\b/i;
const DEPOSIT_WORDS =
  /\b(fd|td|tdr|stdr|term\s*dep(osit)?|fixed\s*dep(osit)?|recurring\s*dep(osit)?|rd)\b/i;
const TDS = /\btds\b|tax\s*ded|withholding|\btax\b.*\bint/i;
const FD_CLOSE = /matur|clos|liquid|premat|proceeds|redeem|repay|\bred\b/i;
/** a deposit paid back into the account, principal and interest together ("PRIN AND INT AUTO_REDEEM", "IB TD RED XFER TO CASA") */
const FD_PAYBACK =
  /auto[_\s]?redeem|princ?(ipal)?\s*(and|&|\+)\s*int|\b(td|fd)\s*red\b|\b(td|fd)\s*(closure|matur)|closure\s*proceeds/i;
/** a deposit's interest alone paid out ("INT AUTO REDEEM"), not its principal */
const FD_INT_ONLY = /^\s*int(erest)?\.?\s+auto[_\s]?redeem/i;
/** a deposit opened from the account ("NET TXN: FD BOOKED", "NEW FD", "TD OPENING") */
const FD_OPEN = /\bfd\s*booked|\bnew\s*fd\b|\b(td|fd)\s*opening/i;
/** money from Singapore: a Wise payout, or a DBS remittance landing through DBS Bank India */
const SINGAPORE = /transfer\s*wise|\bwise\s*payments?\b|\bDBSS(0|…)/i;
/** the bank of an IFSC code's first four letters, as a bank name is written (for telling which account a transfer is with) */
const IFSC_BANK: Record<string, string> = {
  HDFC: 'hdfc',
  IDFB: 'idfc',
  ESFB: 'equitas',
  RATN: 'rbl',
  AUBL: 'au',
  JSFB: 'jana',
  INDB: 'indusind',
  ESMF: 'esaf',
  YESB: 'yes',
  UTKS: 'utkarsh',
  SCBL: 'standard chartered',
  UJVN: 'ujjivan',
  SURY: 'suryoday',
  KKBK: 'kotak',
  ICIC: 'icici',
  SBIN: 'sbi',
  UBIN: 'union',
  FDRL: 'federal',
  IBKL: 'idbi',
  DBSS: 'dbs',
  CNRB: 'canara',
  PUNB: 'punjab national',
  BARB: 'baroda',
  SIBL: 'south indian',
  DCBL: 'dcb',
  BDBL: 'bandhan',
  USFB: 'unity',
  CSBK: 'csb',
  KVBL: 'karur vysya',
};
export const bankWord = (b: string) =>
  b
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\b(bank|ltd|limited|small|finance|first)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** one letter added, dropped or changed */
const near1 = (a: string, b: string) => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};
const FUND_WORDS =
  /\b(bse|bsestarmf|nse\s*clearing|nsccl|iccl|indian\s*clearing|cams|camsonline|kfin|kfintech|karvy|mutual\s*fund|mf\s*(sip|purchase|redemption)|amc|zerodha|coin|groww|kuvera|paytm\s*money|et\s*money)\b/i;
const FEES =
  /\b(charges?|chrgs?|chg|fee|fees|gst|cgst|sgst|igst|sms\s*alert|amc|annual\s*(fee|charges?)|min(imum)?\s*bal(ance)?|non[-\s]?maint|debit\s*card|dc\s*ann|consolidated\s*chgs?)\b/i;
const TRANSFER_WORDS = /\b(trf|transfer|self|own|imps|neft|rtgs|ft|fund\s*trf|ib\s*funds?)\b/i;

export function classifyLines(lines: StmtLine[], ctx: ClassifyContext): Classified[] {
  const out = new Map<string, Classified>();
  const set = (l: StmtLine, cls: LineClass, reason: string, counterpart: string | null = null) =>
    out.set(l.id, { id: l.id, cls, counterpart, reason });
  const open = (l: StmtLine) => !out.has(l.id);
  const sorted = [...lines].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );

  // 1. your answers
  const ANSWER: Record<LineAnswer, LineClass> = {
    outside: 'outside_in',
    own: 'own_transfer',
    income: 'income',
    rent: 'rent',
    out: 'spent',
  };
  for (const l of sorted) if (l.answer) set(l, ANSWER[l.answer], 'Your answer');

  // 2. interest and the tax on it
  const interestDays = new Set<string>();
  for (const l of sorted) {
    if (open(l) && l.amount > 0 && FD_INT_ONLY.test(l.narration))
      set(l, 'fd_interest', 'A deposit’s interest paid out into the account: its own earnings');
    if (!open(l) || l.amount <= 0 || !INTEREST.test(l.narration) || FD_PAYBACK.test(l.narration))
      continue;
    if (DEPOSIT_WORDS.test(l.narration))
      set(
        l,
        'fd_interest',
        'A deposit’s interest paid into the account: the deposit’s own earnings',
      );
    else {
      set(l, 'interest', 'Interest credited by the bank');
      interestDays.add(`${l.assetId}|${l.date}`);
    }
  }
  for (const l of sorted) {
    if (!open(l) || l.amount >= 0 || !TDS.test(l.narration)) continue;
    if (interestDays.has(`${l.assetId}|${l.date}`) && !DEPOSIT_WORDS.test(l.narration))
      set(l, 'interest_tax', 'Tax taken at source on the interest the same day');
    else set(l, 'tax', 'Tax taken at source');
  }

  // 3. a transfer from Singapore on file (Wise): the same sum arriving within a few days, in the account it went to when that is known
  const usedRemit = new Set<string>();
  for (const l of sorted) {
    if (!open(l) || l.amount <= 0) continue;
    const r = (ctx.remittances ?? []).find(
      (x) =>
        !usedRemit.has(x.id) &&
        near(x.amount, l.amount) &&
        (!x.toAssetId || x.toAssetId === l.assetId) &&
        l.date >= addDaysIso(x.date, -2) &&
        l.date <= addDaysIso(x.date, 4),
    );
    if (!r) continue;
    usedRemit.add(r.id);
    set(l, 'own_transfer', `The transfer from Singapore (Wise) of ${r.date}`, r.fromAssetId);
    out.get(l.id)!.remittanceId = r.id;
  }

  // 3–4. rent and money from abroad, by their wording
  for (const l of sorted) {
    if (!open(l) || l.amount <= 0) continue;
    if (ctx.rentWords.length && hasWord(l.narration, ctx.rentWords))
      set(l, 'rent', 'Rent: the narration has a word you set for your tenant');
    else if (
      SINGAPORE.test(l.narration) ||
      (ctx.remittanceWords.length && hasWord(l.narration, ctx.remittanceWords))
    ) {
      if (ctx.singaporeAssetId) {
        set(
          l,
          'own_transfer',
          'Money from Singapore (a Wise or DBS remittance) not in the transfers on file',
          ctx.singaporeAssetId,
        );
        out.get(l.id)!.fromSingapore = true;
      } else set(l, 'outside_in', 'Money sent from abroad: the narration has a remittance word');
    }
  }

  // 5. transfers between your own accounts: the closest line of the opposite sign and the same sum in another account. On a day
  // with several transfers of one sum (five of ₹5 L between six banks), the bank codes the narrations print decide: "RTGS Cr-ESMF…"
  // came from ESAF, "RTGS/…/YESB…" went to Yes Bank. Pairs whose codes agree are made first; a pair whose codes name another
  // bank is never made.
  const credits = new Map<number, StmtLine[]>();
  for (const m of sorted)
    if (m.amount > 0) {
      const k = Math.round(m.amount * 100);
      credits.set(k, [...(credits.get(k) ?? []), m]);
    }
  const bankAt = new Map(ctx.accounts.map((a) => [a.assetId, bankWord(a.bank ?? '')]));
  // the household's banks as a narration writes them in words ("…/RAGINI SINGH/INDUSIND BANK", "IDFC FIRST B"): a name of four
  // letters or more alone, a shorter one ("yes", "au") only before "bank"
  const wordsOfBanks = [
    ...new Set([...bankAt.values()].map((b) => b.split(' ')[0]!).filter(Boolean)),
  ].map((w) => ({ w, re: new RegExp(`\\b${w}\\b${w.length < 4 ? '\\s*bank' : ''}`, 'i') }));
  // the other banks a narration names, by IFSC code or in words (its own bank left out)
  const named = (l: StmtLine) => {
    const own = bankAt.get(l.assetId) ?? '';
    const byCode = [...l.narration.toUpperCase().matchAll(/\b([A-Z]{4})(?:0|…)/g)].map(
      (m) => IFSC_BANK[m[1]!],
    );
    const byName = wordsOfBanks.filter((b) => b.re.test(l.narration)).map((b) => b.w);
    return [...byCode, ...byName].filter((b): b is string => !!b && !(own && own.startsWith(b)));
  };
  const names = (l: StmtLine, other: StmtLine) => {
    const bank = bankAt.get(other.assetId) ?? '';
    return !!bank && named(l).some((b) => bank.startsWith(b));
  };
  const clashes = (l: StmtLine, other: StmtLine) => {
    const bank = bankAt.get(other.assetId) ?? '';
    const n = named(l);
    return !!bank && n.length > 0 && !n.some((b) => bank.startsWith(b));
  };
  for (const hinted of [true, false])
    for (const l of sorted) {
      if (!open(l) || l.amount >= 0) continue;
      let best: StmtLine | null = null;
      for (const m of credits.get(Math.round(-l.amount * 100)) ?? []) {
        if (!open(m) || m.assetId === l.assetId || daysApart(m.date, l.date) > ctx.pairDays)
          continue;
        if (clashes(l, m) || clashes(m, l)) continue;
        if (hinted && !names(l, m) && !names(m, l)) continue;
        if (!best || daysApart(m.date, l.date) < daysApart(best.date, l.date)) best = m;
      }
      if (best) {
        set(l, 'own_transfer', 'The same sum arrived in another of your accounts', best.assetId);
        set(best, 'own_transfer', 'The same sum left another of your accounts', l.assetId);
      }
    }

  // 6. deposits booked from the account, and paid back into it
  const usedFd = new Set<string>();
  const acct = new Map(ctx.accounts.map((a) => [a.assetId, a]));
  for (const l of sorted) {
    if (!open(l)) continue;
    const amt = Math.abs(l.amount);
    const a = acct.get(l.assetId);
    const here = a?.bank ? bankWord(a.bank) : '';
    // the account holder's own deposits first; another person's only at the same bank (a child's deposit booked from a parent's account)
    const order = [...ctx.deposits].sort(
      (x, y) => Number(x.ownerId !== a?.ownerId) - Number(y.ownerId !== a?.ownerId),
    );
    const fd = order.find((d) => {
      if (usedFd.has(`${d.assetId}|${l.amount > 0 ? 'in' : 'out'}`)) return false;
      const there = d.bank ? bankWord(d.bank) : '';
      if (here && there && here !== there) return false;
      if (a && d.ownerId !== a.ownerId && !(here && here === there)) return false;
      if (l.amount < 0)
        return near(d.principal, amt) && daysApart(d.bookedOn, l.date) <= ctx.pairDays;
      const end = d.endedOn ?? d.maturityOn;
      const window = Math.max(ctx.pairDays, 7);
      if (daysApart(end, l.date) > window) return false;
      return (
        (d.maturityAmount !== null && near(d.maturityAmount, amt)) ||
        (amt >= d.principal * 0.97 && amt <= d.principal * 1.6 && DEPOSIT_WORDS.test(l.narration))
      );
    });
    if (!fd) continue;
    usedFd.add(`${fd.assetId}|${l.amount > 0 ? 'in' : 'out'}`);
    if (l.amount < 0)
      set(l, 'fd_funding', 'A deposit of this amount was booked that day', fd.assetId);
    else set(l, 'fd_proceeds', 'A deposit of yours matured or was closed then', fd.assetId);
  }

  // 7. fund purchases and sales in the CAS
  const fundsBy = new Map<string, number[]>();
  ctx.fundTxns.forEach((t, k) => {
    const key = `${t.ownerId}|${Math.round(t.amount)}`;
    fundsBy.set(key, [...(fundsBy.get(key) ?? []), k]);
  });
  const usedFund = new Set<number>();
  for (const l of sorted) {
    if (!open(l)) continue;
    const amt = Math.abs(l.amount);
    const r = Math.round(amt);
    const near3 = (owner: string) =>
      [r - 1, r, r + 1].flatMap((x) => fundsBy.get(`${owner}|${x}`) ?? []);
    // the account holder's own funds first; then another person's (a SIP for a child's fund, paid from a parent's account)
    const others = [...new Set(ctx.fundTxns.map((t) => t.ownerId))].filter((o) => o !== l.ownerId);
    const candidates = [...near3(l.ownerId), ...others.flatMap(near3)];
    const i = candidates.find((k) => {
      const t = ctx.fundTxns[k]!;
      if (usedFund.has(k) || !near(t.amount, amt)) return false;
      if (l.amount < 0 && t.side === 'buy')
        return l.date <= addDaysIso(t.date, 1) && l.date >= addDaysIso(t.date, -ctx.fundDays);
      if (l.amount > 0 && t.side === 'sell')
        return l.date >= addDaysIso(t.date, -1) && l.date <= addDaysIso(t.date, ctx.fundDays);
      return false;
    });
    if (i === undefined) continue;
    usedFund.add(i);
    const fund = ctx.fundTxns[i]!.assetId ?? null;
    const whose = ctx.fundTxns[i]!.ownerId === l.ownerId ? 'your' : 'another person’s';
    if (l.amount < 0) set(l, 'fund_buy', `A fund purchase of this amount is in ${whose} CAS`, fund);
    else set(l, 'fund_sell', `A fund sale of this amount is in ${whose} CAS`, fund);
  }

  // 8. deposits and funds from the wording alone
  for (const l of sorted) {
    if (!open(l)) continue;
    if (l.amount > 0 && FD_PAYBACK.test(l.narration))
      set(l, 'fd_proceeds', 'The narration says a deposit was paid back (principal and interest)');
    else if (l.amount < 0 && FD_OPEN.test(l.narration))
      set(l, 'fd_funding', 'The narration says a deposit was booked');
    else if (DEPOSIT_WORDS.test(l.narration)) {
      if (l.amount < 0) set(l, 'fd_funding', 'The narration says a deposit was booked');
      else if (FD_CLOSE.test(l.narration))
        set(l, 'fd_proceeds', 'The narration says a deposit matured or was closed');
    } else if (FUND_WORDS.test(l.narration)) {
      set(
        l,
        l.amount < 0 ? 'fund_buy' : 'fund_sell',
        'The narration names a fund house or clearing house',
      );
    }
  }

  // 8b. a transfer naming one of the household: to or from an account in their name (at the bank its IFSC code names, when on file)
  const people = (ctx.people ?? []).map((p) => ({
    ownerId: p.ownerId,
    names: p.names.map((n) => n.toUpperCase()).filter((n) => n.length >= 4),
  }));
  const ownerOfAsset = new Map(ctx.accounts.map((a) => [a.assetId, a.ownerId]));
  const bankOfAsset = new Map(ctx.accounts.map((a) => [a.assetId, bankWord(a.bank ?? '')]));
  if (people.length)
    for (const l of sorted) {
      if (!open(l)) continue;
      const words = l.narration
        .toUpperCase()
        .split(/[^A-Z]+/)
        .filter(Boolean);
      let who: { ownerId: string; at: number } | null = null;
      for (const p of people) {
        const at = words.findIndex((w) => p.names.some((n) => near1(w, n)));
        if (at >= 0 && (!who || at < who.at)) who = { ownerId: p.ownerId, at };
      }
      if (!who) continue;
      // the other side's bank: an IFSC code in the narration that is not this account's own bank
      const own = bankOfAsset.get(l.assetId) ?? '';
      const banks = [...l.narration.toUpperCase().matchAll(/\b([A-Z]{4})(?:0|…)/g)]
        .map((m) => IFSC_BANK[m[1]!])
        .filter((b): b is string => !!b && !own.startsWith(b));
      const at = banks[0];
      const theirs = ctx.accounts.filter(
        (a) =>
          a.ownerId === who!.ownerId &&
          a.assetId !== l.assetId &&
          (!at || bankWord(a.bank ?? '').startsWith(at)),
      );
      const other = at && theirs.length === 1 ? theirs[0]!.assetId : null;
      const name =
        (ctx.people ?? []).find((p) => p.ownerId === who!.ownerId)?.names[0] ?? 'one of you';
      const same = who.ownerId === ownerOfAsset.get(l.assetId);
      set(
        l,
        'own_transfer',
        `${l.amount > 0 ? 'From' : 'To'} ${same ? 'another account of yours' : `an account in ${name}'s name`}${at ? ` at ${at.toUpperCase()}` : ''}`,
        other,
      );
      out.get(l.id)!.person = who.ownerId;
    }

  // 9. a transfer naming another of your accounts by its last four digits
  const byLast4 = new Map<string, string[]>();
  for (const a of ctx.accounts)
    if (a.last4) byLast4.set(a.last4, [...(byLast4.get(a.last4) ?? []), a.assetId]);
  for (const l of sorted) {
    if (!open(l) || !TRANSFER_WORDS.test(l.narration)) continue;
    const digits = [...l.narration.matchAll(/…(\d{4})|x{2,}(\d{4})\b/gi)].map((m) => m[1] ?? m[2]!);
    const other = digits.flatMap((d) => byLast4.get(d) ?? []).find((id) => id !== l.assetId);
    if (other)
      set(
        l,
        'own_transfer',
        'The narration names another of your accounts (its last four digits)',
        other,
      );
  }

  // 10–11. charges, and everything else
  for (const l of sorted) {
    if (!open(l)) continue;
    const amt = Math.abs(l.amount);
    if (l.amount < 0 && FEES.test(l.narration) && amt < ctx.reviewAbove)
      set(l, 'fee', 'Bank charges');
    else if (amt < ctx.reviewAbove)
      set(
        l,
        l.amount < 0 ? 'spent' : 'outside_in',
        l.amount < 0
          ? 'Spending: no rule fits, and it is below the limit for asking'
          : 'A small amount coming in (a refund, cashback): below the limit for asking',
      );
    else
      set(
        l,
        l.amount < 0 ? 'ask_out' : 'ask_in',
        /\bself\b/i.test(l.narration)
          ? 'To or from your own account: one not on file here (abroad?) counts as money out or in'
          : 'No rule fits: say what it was',
      );
  }
  return lines.map((l) => out.get(l.id)!);
}

export interface StatementMove {
  idemKey: string;
  movedOn: string;
  amount: number;
  kind: 'contribution' | 'withdrawal' | 'income' | 'fee' | 'tax';
  fromAssetId: string | null;
  toAssetId: string | null;
  note: string;
}

/** The ledger kind of each class that moves money into or out of the family, or is earnings; the rest move nothing. */
const MOVE: Partial<
  Record<LineClass, { kind: StatementMove['kind']; into: boolean; note: string }>
> = {
  outside_in: { kind: 'contribution', into: true, note: 'Money from outside (bank statement)' },
  rent: { kind: 'income', into: true, note: 'Rent (bank statement)' },
  income: { kind: 'income', into: true, note: 'Earnings (bank statement)' },
  spent: { kind: 'withdrawal', into: false, note: 'Spending and money withdrawn (bank statement)' },
  fee: { kind: 'fee', into: false, note: 'Bank charges (bank statement)' },
  tax: { kind: 'tax', into: false, note: 'Tax taken at source (bank statement)' },
};

/**
 * The confirmed movements the lines make: one per account, calendar month and kind, dated on the last line it covers. Lines still
 * waiting for an answer make none (their money stays "not yet explained"); transfers, deposits, funds and interest make none either,
 * because they move money between your own holdings or are already the holdings' own earnings.
 */
export function statementMoves(lines: StmtLine[], classified: Classified[]): StatementMove[] {
  const cls = new Map(classified.map((c) => [c.id, c.cls]));
  const groups = new Map<
    string,
    { asset: string; month: string; c: LineClass; sum: number; last: string }
  >();
  for (const l of lines) {
    const c = cls.get(l.id);
    if (!c || !MOVE[c]) continue;
    const month = l.date.slice(0, 7);
    const k = `${l.assetId}|${month}|${c}`;
    const g = groups.get(k) ?? { asset: l.assetId, month, c, sum: 0, last: l.date };
    g.sum += Math.abs(l.amount);
    if (l.date > g.last) g.last = l.date;
    groups.set(k, g);
  }
  const moves: StatementMove[] = [];
  for (const g of groups.values()) {
    const m = MOVE[g.c]!;
    const amount = Math.round(g.sum * 100) / 100;
    if (amount <= 0) continue;
    moves.push({
      idemKey: `stmt:${g.asset}:${g.month}:${g.c}`,
      movedOn: g.last,
      amount,
      kind: m.kind,
      fromAssetId: m.into ? null : g.asset,
      toAssetId: m.into ? g.asset : null,
      note: m.note,
    });
  }
  return moves.sort(
    (a, b) => a.movedOn.localeCompare(b.movedOn) || a.idemKey.localeCompare(b.idemKey),
  );
}

/** The class a person reads: a few words for each. */
export const LINE_CLASS_LABEL: Record<LineClass, string> = {
  interest: 'Interest',
  interest_tax: 'Tax on interest',
  fd_interest: 'Deposit interest paid out',
  own_transfer: 'Between your own accounts',
  fd_funding: 'Into a deposit',
  fd_proceeds: 'From a deposit',
  fund_buy: 'Into a fund',
  fund_sell: 'From a fund',
  outside_in: 'Money from outside',
  rent: 'Rent',
  income: 'Other earnings',
  fee: 'Bank charges',
  tax: 'Tax at source',
  spent: 'Spending and money out',
  ask_in: 'To answer: money in',
  ask_out: 'To answer: money out',
};
