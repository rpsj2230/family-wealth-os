# Tax harvesting for mutual funds in India: how it works and how the app applies it

Written 26 Oct 2026 for the financial year 2026-27 (assessment year 2027-28). This is research and arithmetic, not tax advice: the
rates below come from several secondary sources that agree with each other (listed at the end), and a few points are marked
**check**. Confirm with the Income Tax Department's pages or a chartered accountant before acting, above all for NRI withholding.

## 1. What is taxed, and how

Only **equity-oriented** funds (at least 65% in domestic equity; this includes arbitrage, aggressive hybrid, equity-savings and index
funds) get the rules below.

| | Held 12 months or less | Held more than 12 months |
|---|---|---|
| Equity-oriented fund | Short-term gain, **20%** (s.111A) | Long-term gain, **12.5%** on the part above **₹1,25,000 a year** (s.112A); no indexation |

- The ₹1,25,000 is **per person, per financial year**, across *all* listed shares and equity funds together, not per fund. It is not
  carried forward: unused allowance is lost on 31 March. Rupash and Ragini each have their own.
- Health and education cess (4%) is added. A surcharge can apply on high incomes (**check**: on these gains it is capped at 15%).
- Other fund types do **not** get this treatment:
  - Debt and money-market funds bought on or after 1 April 2023: taxed at your slab rate whatever the holding period (s.50AA). Nothing to harvest.
  - International funds, fund-of-funds and gold/silver funds: long-term only after **24 months**, then 12.5% with **no** allowance.
  - Hybrids with 35–65% equity: slab rate if sold within 24 months, 12.5% after (**check** each fund; sources disagree on the boundaries).
  - ELSS: equity rules, but each purchase is **locked for 3 years**; buying back starts a new lock-in.

## 2. Every purchase is its own lot

This is the point that matters most for SIP investors.

- Each SIP instalment is a separate lot with its own purchase date, cost, one-year clock and exit-load window.
- Units are redeemed **oldest first (FIFO)**, per folio. You cannot choose to sell a particular instalment.
- A lot is long-term only from the **day after** its first anniversary (bought 15 Oct 2025, long-term from 16 Oct 2026).
- So a monthly SIP started in January becomes harvestable one instalment a month from the next January, not all at once. The app's
  "When more units become ready" table lists each date, the units, the gain, and the running total of gain that will be ready by then.
- A fund with a big recent SIP and a small old holding can offer only a small harvest, however large its value.

## 3. Gain harvesting (use the ₹1,25,000 each year)

1. Sell long-term units whose gain fits the allowance, then buy the same fund again. The new units cost today's price, so a later sale
   books a smaller gain. The tax saved is up to 12.5% (plus cess) of the gain you moved inside the allowance.
2. Work per person. Use the allowance left after any gains already booked this year (including shares and ETFs, which the app cannot see).
3. Sell the oldest units, by **units**, so the gain is what you planned. Pick funds with the smallest gains first to finish more funds inside the limit.
4. Do it before the end of March, but not on the last days: an order after the 3 pm cut-off or on a holiday is priced on the next working day.
5. **Buy first, then sell**, to stay invested. A purchase joins the back of the queue, so the sale still uses the old units. If you sell first, buy the same day.
6. Costs: stamp duty 0.005% on the purchase and securities transaction tax 0.001% on the sale (both settings, tiny).
7. The new units start fresh clocks: a sale within a year is a 20% short-term gain, and an exit load applies again. Do not plan to need that money soon.

## 4. Exit load

- Typically 1% on units redeemed within 365 days, but each scheme sets its own (some 30 or 90 days, some 0.25–3%).
- It is charged **per lot**: only units still inside the window pay, and they are the newest, which FIFO sells last.
- A gain harvest uses lots older than a year, so it normally pays none. The app still holds back a lot until the load window has passed
  (Settings has a household default; each fund can have its own on the Funds page).
- Buying back restarts the window. That is the real cost of harvesting if you might need the money within a year.

## 5. Loss harvesting

- A **short-term loss** can be set off against short-term gains and long-term gains. A **long-term loss** only against long-term gains.
- Set-off happens **before** the ₹1,25,000 allowance. A loss therefore saves tax only if you have short-term gains, or long-term gains
  above the allowance. If your gains are inside the allowance, the loss saves nothing this year.
- Unused losses carry forward **8 years**, but only if the return is filed by the due date for the year of the loss.
- Because of FIFO, the loss on your *newest* units can only be booked by selling the older units too, and an older profitable lot
  offsets part of the loss. The app shows the net result of selling the oldest N lots, not the loss lots alone. Separate folios would let you choose.
- There is no wash-sale rule in India, but a sale and repurchase with no purpose except tax can be challenged under the general
  anti-avoidance rule. Keep a reason on file, and consider a similar fund or a gap before buying back.

## 6. Non-resident investors

- The fund house withholds tax on redemption: 12.5% on long-term and 20% on short-term gains for equity funds, plus cess.
- Several sources say withholding often ignores the ₹1,25,000 allowance; the excess comes back when you file the return. **Check** with
  your fund house's contract notes and Form 16A.
- Keep the contract notes: they show the units, the price and the tax withheld, and you need them for the refund and for Schedule 112A.
- The app tracks each harvest's expected withholding as a refund to claim (Tax > Refunds).

## 7. Units bought before 1 February 2018 (grandfathering)

For long-term sales the cost is the **higher** of what you paid and the **lower** of the 31 January 2018 value and the sale value.
The app uses the 31 Jan 2018 price from the NAV history when it has it, and otherwise the actual cost (which overstates the gain, so
the plan is cautious). Schedule 112A needs the 2018 price per unit.

## 8. A yearly rhythm

| When | What |
|---|---|
| April | New allowance. Note the gains booked so far (the app does this from fund statements). |
| Every month | Check "When more units become ready"; import the latest fund statement so lots are exact. |
| January | Plan the harvest per person; decide on losses to book. |
| Early to mid March | Place the sell and buy-back orders. Do not wait for the last week. |
| After the sale | Keep contract notes. Enter the actual tax withheld in Tax > Refunds. |
| July | File the return on time (needed to carry losses forward and to claim the refund). |

## 9. What the app does, and does not

- Works per person, per fund, per lot. Equity-oriented funds only; says why any other fund is left out.
- With a fund statement the lots are exact. Without one, lots are **estimated** from the SIP start date, instalment and price history
  and are marked as estimates everywhere.
- The Tax page (What to sell) gives each person a headline, an allowance bar and one **Sell this** list with exact units, worth, tax-free gain and plain checks
  (long-term period, exit load, allowance, lots from a statement or estimated). A fund is never listed without units: with no price it is left out and says why.
- Under **Show the working** per fund: the purchases sold (oldest first, with date, cost, gain), the long/short split, the buy-back amount, stamp duty, STT, exit load and the NRI withholding.
- **Do not sell yet** names funds with short-term units or an exit load still running and the date each becomes ready. Funds only ready next year, in loss, or of another type are listed with a reason.
- Shows **Losses you can book** in plain words, with the short- and long-term split, the set-off order and the tax saved this year or carried forward.
- Does not see shares, ETFs or other brokers' gains, other income, or surcharge. Reduce the allowance by hand for those.
- Never trades. Always check the redemption screen and the fund's own exit load.
- Every number (allowance, rates, holding period, exit-load days, stamp duty, STT, days kept clear before 31 March) comes from Settings; nothing is fixed in the page.

## Sources

- [Mutual fund taxation FY 2026-27 (Calculatorship)](https://www.calculatorship.in/mutual-fund-taxation-india-complete-guide), [Bajaj Finserv](https://www.bajajfinserv.in/investments/understanding-long-term-capital-gains-tax), [TaxGarden](https://taxgarden.in/blog/mutual-fund-taxation-india-ay-2026-27)
- [Tax-loss harvesting FY2026 (Value Research)](https://www.valueresearchonline.com/learn/mutual-funds/tax-loss-harvesting-fy2026-reduce-capital-gains-tax/), [Share.Market](https://www.share.market/buzz/learn/tax-loss-harvesting/), [IndiaFilings](https://www.indiafilings.com/learn/tax-loss-harvesting-in-india)
- NRI withholding: [TrustNRI](https://www.trustnri.in/learn/nri-redemption-tax-guide), [Belong](https://getbelong.com/blog/mutual-funds/returns-taxable/), [Bajaj Broking](https://www.bajajbroking.in/blog/nri-mutual-fund-tax-in-india)
- Budget 2026 (no change to these rates reported): [Angel One](https://www.angelone.in/news/taxation/union-budget-2026-ltcg-tax-unchanged-at-12-5-stt-on-commodity-futures-hiked), [Axis Mutual Fund](https://www.axismf.com/mutual-fund-knowledge-centre/articles/union-budget-2026-impact-on-mutual-funds)
- Hybrid and other fund types: [Kotak Mutual Fund](https://www.kotakmf.com/Information/blogs/mutual-fund-taxation), [Bajaj AMC](https://www.bajajamc.com/knowledge-centre/union-budget-2024-new-mutual-funds-capital-gains-tax-explained), [Primeinvestor](https://primeinvestor.in/reports/budget-2024-equity-and-debt-investments-taxation/)
- Grandfathering: [Quicko](https://learn.quicko.com/ltcg-tax-equity-shares), [Scripbox](https://scripbox.com/mf/section-112a-income-tax-act/)
- Exit load per instalment and FIFO: [DSP](https://www.dspim.com/knowledge-hub/personal-finance-guide/tax-on-sip-investments-how-each-instalment-is-taxed), [Value Research](https://www.valueresearchonline.com/stories/29904/tax-and-exit-load-on-sip-investments/)
