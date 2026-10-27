import {
  buildAccountsExplain,
  buildCashExplain,
  buildDepositsExplain,
  type BankBlock,
  type BankFacts,
  type BankOverview,
  type BankShare,
  type CashBankShare,
  type MaturityYear,
} from '@fwos/core';

/** The part of the explainers' facts that comes from the bank blocks the page already built. */
export type BankBase = Pick<BankFacts, 'today' | 'scope' | 'balances' | 'rates' | 'fd'>;

/**
 * The dates of the recorded savings balances, where each savings rate came from and the span of the running deposits, from the same
 * blocks the overview is worked out from. `rates` is the per-account rate and its source (see cashRatesFor); an account missing from
 * it uses the assumed rate.
 */
export function bankBase(a: {
  today: string;
  scope: string | null;
  blocks: BankBlock[];
  rates?: Record<string, { tag: 'own' | 'market' | 'assumed' }>;
  savingsRate: number;
  tdsRate: number;
}): BankBase {
  const rows = a.blocks.flatMap((b) => b.sections.flatMap((s) => s.rows));
  const cash = rows.filter((r) => r.kind === 'cash' && r.status === 'active');
  const dates = cash.map((r) => r.asOf).filter((d): d is string => !!d);
  const fds = rows.filter(
    (r) => r.kind === 'fd' && r.fd && r.status === 'active' && !r.fd.needsConfirmation,
  );
  const booked = fds.map((r) => r.fd!.bookedOn).sort();
  const matures = fds.map((r) => r.fd!.maturityOn).sort();
  const tag = (id: string) => a.rates?.[id]?.tag ?? 'assumed';
  return {
    today: a.today,
    scope: a.scope,
    balances: {
      count: cash.length,
      oldest: dates.length > 0 ? dates.reduce((x, y) => (x < y ? x : y)) : null,
      newest: dates.length > 0 ? dates.reduce((x, y) => (x > y ? x : y)) : null,
      stale: cash.filter((r) => r.stale).length,
    },
    rates: {
      own: cash.filter((r) => tag(r.assetId) === 'own').length,
      market: cash.filter((r) => tag(r.assetId) === 'market').length,
      assumed: cash.filter((r) => tag(r.assetId) === 'assumed').length,
      assumedRate: a.savingsRate,
      tds: a.tdsRate,
    },
    fd: {
      count: fds.length,
      firstBooked: booked[0] ?? null,
      lastMaturity: matures.at(-1) ?? null,
    },
  };
}

/** The links an explainer on an overview panel can offer: the page itself, or its sample twin. */
export function bankLinks(sample: boolean): BankFacts['links'] {
  const to = (path: string) => (sample ? `/demo${path}` : path);
  return {
    monthly: to('/monthly'),
    accounts: to('/accounts'),
    deposits: to('/deposits'),
    cash: to('/cash'),
    maturities: to('/deposits?tab=maturities'),
    cover: to('/deposits?tab=cover'),
    rates: to('/rates'),
    settings: to('/settings'),
  };
}

const noFacts: Pick<BankFacts, 'banks' | 'ladder' | 'cash'> = { banks: [], ladder: [], cash: null };

/** The explainers of the Accounts overview and its grand total. */
export function accountsExplain(o: BankOverview, base: BankBase, sample: boolean) {
  return buildAccountsExplain(o, {
    ...base,
    ...noFacts,
    cover: o.cover,
    toConfirm: o.toConfirm,
    links: bankLinks(sample),
  });
}

/** The explainers of the Deposits overview. */
export function depositsExplain(
  o: BankOverview,
  base: BankBase,
  sample: boolean,
  extra: {
    cover: { limit: number; uninsured: number; banksOver: number };
    toConfirm: number;
    banks: BankShare[];
    ladder: MaturityYear[];
  },
) {
  return buildDepositsExplain(o, {
    ...base,
    cash: null,
    cover: extra.cover,
    toConfirm: extra.toConfirm,
    banks: extra.banks.map((b) => ({
      name: b.bank,
      amount: b.current,
      share: b.share,
      count: b.count,
    })),
    ladder: extra.ladder.map((s) => ({ year: s.year, amount: s.amount, count: s.count })),
    links: bankLinks(sample),
  });
}

/** The explainers of the Cash overview. */
export function cashExplain(
  o: BankOverview,
  base: BankBase,
  sample: boolean,
  extra: {
    banks: CashBankShare[];
    interestYear: number;
    avgRate: number | null;
    largest: { code: string; bank: string; amount: number } | null;
  },
) {
  return buildCashExplain(o, {
    ...base,
    cover: null,
    toConfirm: 0,
    ladder: [],
    banks: extra.banks.map((b) => ({
      name: b.bank,
      amount: b.balance,
      share: b.share,
      count: b.count,
    })),
    cash: { interestYear: extra.interestYear, avgRate: extra.avgRate, largest: extra.largest },
    links: bankLinks(sample),
  });
}
