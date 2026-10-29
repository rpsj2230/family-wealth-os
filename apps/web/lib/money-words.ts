/**
 * The names of the money figures, the same on every page (Home, Accounts, Deposits, Investments), so one idea never has two names:
 *  - your own money: what you brought in from outside (salary, money sent from abroad, the balances on the opening day); never interest
 *    or profit;
 *  - amount invested now: what the holdings you have today cost (deposit principal, fund purchases, balances), which includes interest
 *    reinvested from earlier deposits;
 *  - value today, and the profit on each of the two amounts above;
 *  - the yearly return (XIRR) says which money it is measured on.
 */
export const MONEY_WORDS = {
  ownMoney: 'Your own money brought in',
  investedNow: 'Amount invested now',
  investedNowNote: 'what today’s holdings cost; includes interest reinvested from earlier deposits',
  principalNow: 'Amount invested now (principal)',
  valueToday: 'Value today',
  atMaturity: 'Value at maturity',
  profitOnInvested: 'Profit on amount invested now',
  profitTotal: 'Total profit on your own money',
  earnedSince: 'Interest and gains earned since first record',
  xirrOwn: 'Yearly return on your own money (XIRR)',
  xirrInvested: 'Yearly return on amount invested (XIRR)',
  earnsRate: 'Earns interest at',
  booked: 'Profit booked by selling',
  profitAll: 'Total profit (held and booked)',
} as const;
