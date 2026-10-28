# Definitions

Generated from `packages/core/src/figure.ts`; do not edit by hand.

## The five kinds of figure

- **Actual** (actual): Read from a bank, a fund statement, a confirmed transaction or your own entry, on the date it applies to.
- **Estimate** (est.): Worked out from rates, contract terms or a rule since the last actual record. Replaced by the next actual record.
- **Market value** (market): Units or an amount you hold times an official published price (NAV, closing price or exchange rate) of the date shown.
- **Projection** (proj.): Expected but not confirmed yet, such as a SIP instalment due after the last statement. Never counted as money invested or as profit.
- **Past performance** (history): A figure about a past period, worked out from actual records, estimates and prices.

## Metrics

### Net worth

Everything the family owns (savings, deposits, maturity proceeds not yet placed, funds, shares, other assets) less what it owes. Each part is valued by its own rule and keeps its own label.

- Kind: mixed (each part keeps its own label)
- Applies to: The valuation date shown (today, or the day of a past snapshot).

### Assets

The value of everything owned, before loans owed are taken off.

- Kind: mixed (each part keeps its own label)
- Applies to: The valuation date.

### Liabilities

What the family owes: the outstanding amount of each loan on the valuation date.

- Kind: Estimate
- Applies to: The valuation date.

### Savings (estimated balance)

The last actual balance, plus confirmed money in and out since, plus interest worked out day by day at the rate in force (including slab rates). Becomes actual again when the next balance arrives.

- Kind: Estimate
- Applies to: The valuation date; the baseline balance keeps its own date.

### Fixed deposits (current value)

For each running deposit: the principal plus the interest earned on its contract terms and not yet paid out.

- Kind: Estimate
- Applies to: The valuation date.

### Deposit principal

The amount each running deposit was opened with, as on its contract.

- Kind: Actual
- Applies to: The booking date of each deposit.

### Accrued interest

Interest earned so far and still held in the deposit (not yet paid out). Interest already paid out to an account is shown apart as credited.

- Kind: Estimate
- Applies to: The valuation date.

### Maturity value

What the deposit pays on its maturity date on its contract terms (the bank’s own figure when it is on file). A future amount, not part of today’s value.

- Kind: Estimate
- Applies to: The maturity date.

### Maturity proceeds awaiting confirmation

Money paid out by deposits that matured where you have not yet said where it went (a savings account, a new deposit, taken out). Counted once in net worth; never reinvested automatically.

- Kind: Estimate
- Applies to: The maturity date of each deposit.

### Funds: confirmed value

Units confirmed by your fund statements (CAS) or a unit count, times the official NAV of the date shown. No projected instalment is in it.

- Kind: Market value
- Applies to: The NAV date shown.

### Funds: estimated value

The confirmed value plus the units the active SIPs are expected to have bought since the last statement, each at the NAV of its own date. Replaced by actual figures when the next statement is imported.

- Kind: Estimate
- Applies to: The NAV date shown.

### Projected SIP activity

SIP instalments due after the last statement, with the amount in force on each date and the units the NAV of that date buys. Not money invested until a statement confirms it.

- Kind: Projection
- Applies to: Each instalment’s own date.

### Shares

Quantity held times the latest official closing price; a price older than Settings allows is flagged as stale.

- Kind: Market value
- Applies to: The price date shown.

### Other assets

Property, money lent, pension and insurance savings and anything else: the value last recorded, moved on only at a growth rate you set in Settings (then marked as an estimate).

- Kind: Actual
- Applies to: The date of the value recorded.

### Cash

Savings and current accounts in rupees and in other currencies (converted at the exchange rate of the date shown).

- Kind: Estimate
- Applies to: The valuation date.

### Own money put in (lifetime)

The opening position plus all money that came in from outside the family’s accounts (salary, gifts received, sale of something not tracked) less all money taken out of them. Interest, gains, renewals, reinvestment and transfers between your own accounts never change it.

- Kind: Past performance
- Applies to: The valuation date.

### Net outside money

Money that came in from outside less money that went out, in the period. Confirmed movements are shown apart from amounts worked out from balances.

- Kind: Past performance
- Applies to: The period shown.

### Opening position

Net worth on the first date with a value for the holdings on record, taken as the money the family started with. Profit is measured from it, never from zero.

- Kind: Past performance
- Applies to: The opening date shown.

### Lifetime profit

Net worth less own money put in: interest, fund and share gains, exchange-rate moves and income, after fees and taxes. Changes not yet explained are shown apart and not counted.

- Kind: Past performance
- Applies to: The valuation date, since the opening date.

### Lifetime profit (%)

Lifetime profit as a per cent of own money put in.

- Kind: Past performance
- Applies to: The valuation date, since the opening date.
- Per cent of: Own money put in (opening position plus net outside money). Not shown when that is zero or negative.

### Annual return (XIRR)

The yearly rate that turns the opening position and every dated movement of outside money into today’s net worth (money-weighted). Internal transfers, renewals and reinvested interest are not movements.

- Kind: Past performance
- Applies to: From the opening date to the valuation date.
- Per cent of: Money-weighted: each sum counts for the time it was invested.

### Time-weighted return

The growth of the money invested over the period with the effect of money added or taken out removed: each stretch between movements is measured on its own and the stretches are chained.

- Kind: Past performance
- Applies to: The period shown.
- Per cent of: Value at the start of each stretch.

### Invested (cost)

For funds: the purchase cost of the units still held, matched first-in first-out against sales (the method Indian capital-gains tax uses). Projected instalments are not in it.

- Kind: Actual
- Applies to: The date of the last statement.

### Cost of current holdings

What the holdings you have today cost: each running deposit’s amount, the last balance of each savings account, and the first-in first-out cost of the fund units still held. A deposit renewed with its interest counts at its new, larger amount, so reinvested interest is inside it. Not the same as own money put in (lifetime).

- Kind: Actual
- Applies to: Today.

### Gain on current holdings

Value today of the holdings you have now, less what they cost. Interest already rolled into a renewed deposit is part of its cost, so it is not in this gain; the lifetime profit counts it once.

- Kind: Estimate
- Applies to: Today.
- Per cent of: Cost of current holdings.

### Realised gain

Sale proceeds less the first-in first-out cost of the units sold.

- Kind: Past performance
- Applies to: The sale dates in the period.

### Unrealised gain

Value of the units still held less their cost.

- Kind: Market value
- Applies to: The NAV or price date shown.

### Interest earned

Interest on savings and deposits in the period, whether credited to an account, paid out, reinvested or still accruing; credited and accrued are shown apart.

- Kind: Estimate
- Applies to: The period shown.

### Income and distributions

Dividends and fund payouts (IDCW) received in the period.

- Kind: Actual
- Applies to: The payment dates.

### Not yet explained

The difference between a new actual balance and what the earlier balance, confirmed movements and interest predicted. Never counted as profit or as money put in until you classify it.

- Kind: Estimate
- Applies to: The date of the balance that showed it.

### Change in wealth

Net worth at the end of the period less net worth at its start, split into outside money, interest, market gains, income, fees and taxes, and anything not yet explained.

- Kind: Past performance
- Applies to: The period shown.
