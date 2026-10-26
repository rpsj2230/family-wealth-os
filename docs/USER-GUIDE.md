# Family Wealth OS: user guide

For Rupash and Ragini. Everything here describes what the app does today. Items marked *(waiting)* need something from you first (see `docs/NEEDS-FROM-YOU.md`).

## What the numbers mean

- **Verified** is the last balance you entered or an official statement showed, with its date.
- **Estimated today** is the verified figure moved forward: fixed deposits by their own interest terms, savings at an assumed rate, mutual funds by the latest published NAV, Singapore dollars by the latest exchange rate. Each figure is labelled *calculated*, *estimated* or *carried forward*.
- An asset with no value is listed but never counted as zero. Insurance cover and matured deposits you have not confirmed are never counted in net worth.
- Money you have lent is shown as owed, not as cash.

## Monthly routine (about 10 minutes)

1. Open **Monthly update**. Every account is on one screen.
2. Type the new balance and the date for each account that has changed (a pasted column from your bank app works too).
3. Press **Save all**. The dashboard and the history chart update.
4. Check **Tasks** for anything the app has raised, such as a deposit that has matured.

## Fixed deposits

**Deposits** lists every deposit with its bank, owner, rate, maturity date and the amount at maturity. A matured deposit stays out of net worth until you say where the money went. The insured-limit view shows each person's exposure per bank against the ₹5 lakh deposit insurance limit.

## Mutual funds and goals

- **Funds** matches each fund in your sheet to the official scheme list once; you confirm the match.
- **Goals** lets you assign holdings to goals (education, marriage and so on). An asset can be split across goals but never above 100%. A goal shows its projected funding under the inflation and return you set.

## Can I retire now?

Open **Retire**. Enter spending, retirement age, expected return and inflation. The result is one of:

- **Meets the plan** under your assumptions,
- **Shortfall**, with the size of the gap and what would close it (spend less, retire later, save more),
- **Cannot assess**, with the missing item named.

It never says "safe". A range of outcomes (market ups and downs) is shown next to the single projection. The public sample at `/demo/retire` uses made-up numbers.

## Tax

- **Tax** (redemption simulator): enter the lots of a fund and the amount to redeem. It shows first-in-first-out lots, short or long term, exit load, the allowance used, tax at source for non-residents and the refund expected on filing. The harvest suggestion never trades for you.
- **Tax filing papers** (`/tax/filing`): fixed-deposit interest per person and financial year (taxable for NRO, exempt for NRE, joint accounts flagged), an optional tax-at-source estimate at a rate you type, a CSV download and a checklist of documents. Capital-gains schedules *(waiting for the consolidated statements)*.
- Check every figure against your bank certificates, Form 26AS and the Annual Information Statement before filing. Tax rules are marked unverified until checked against the official source.

## Money lent and policies

**Others** records loans (add one, record repayments, set an expected date) and insurance policies (renewal, end date, nominee, where the documents are). Renewals and end dates appear in the daily summary 45 days ahead.

## Daily summary

**Settings** turns the daily email on and adds up to five extra recipients. The email says plainly when no new bank balance has arrived, shows the date of every market input and never presents an estimate as a bank balance. **Share** gives a short version for WhatsApp.

## Family emergency guide

**Emergency** lists, per institution, who holds the account, the nominee, what the family does first and where documents are. A print view is included. A separate read-only role for trusted people exists in the database and can never see balances.

## Backups

Every night the database is exported, encrypted with a key only you hold and stored on the `backups` branch of the repository. Restore steps and the test restore are in `docs/runbooks/backup-and-restore.md`. Keep the private key somewhere other than this repository (for example a password manager and a printed copy in a safe).

## When something looks wrong

- A balance is far off: check its date. A stale value is flagged and carried forward.
- S$ looks different from your sheet: the sheet used ₹65; the app uses the latest market rate and shows the currency effect.
- The site shows an error: `/api/health` says whether the database is reachable.

## I need money

Open **I need money** (Home button or menu), type an amount, and choose whose money it is. The page shows, for each deadline
(today, 3 days, 14 days, and so on, set in Settings), the most you can have by then, what it costs, and exactly what to do:
cash in bank accounts (a balance is left in each, set in Settings), deposits that mature in time, deposits you could break early
(interest lost is estimated), mutual funds and shares (settlement days, exit load, tax with the non-resident withholding and refund),
money lent out, and property as a last resort. **Advanced: choose where to look** lets you leave a source out for one search;
**Settings, When I need money** sets the usual order, costs and delays. "Make these steps into reminders" turns a plan into tasks.

Limits: costs are estimates from what is recorded; where a fund's cost is not recorded the gain is assumed (Settings) and the plan says so.
Nothing is moved for you.

## Tax harvesting and refunds

**Tax** shows, per person, which funds to sell, how much, the gain realised, and how much to **buy back** afterwards. Each harvest creates a
**Tax refunds to claim** record by itself (expected tax withheld and expected refund). Update it as the sale happens, the return is filed
and the refund arrives; **Download as CSV** gives it to your adviser. NRO interest tax is handled on the filing papers because the refund
depends on your total Indian income. The app prepares figures; the return itself is filed on the income-tax portal using Form 26AS and the
Annual Information Statement, which the app cannot download for you.

## Fund statements (CAS) and exact harvesting

Ask CAMS/KFintech (or MF Central) for a **detailed** statement from the first investment to today, for each person, and forward the
e-mail to your `FWOS/Inbox` label. The inbox job opens it with the PAN saved in Settings, finds each fund by ISIN (or name and folio),
adds funds it does not know, stores every transaction and updates invested amount, first purchase date, SIP and value. You can also upload
the PDF under **Import** (type the PAN once to open it; it is not saved). From then on harvesting works from real purchase lots, oldest units
first, includes funds with a running SIP, and counts long-term gains you have already realised this year.

## Who can open the handbook, and when

Settings → Emergency information: the read-only family login can open the handbook always, only after nobody from the household has signed
in for a number of days, or only when you release it. Release or lock it again with one button. Members always have access.

## Returns, capital gains and the summary

- **Investments** shows the annual return (XIRR) per fund, per person and for the household from the imported fund statements, and a chart of money put in over time. Funds without a statement are not counted, and the page says how many are.
- **Tax filing papers** lists every fund sale of the year, short and long term, with the estimated tax, and downloads the schedule 112A rows per person. Compare the column order with the portal's current template before uploading. Units bought before 1 February 2018 need the 31 January 2018 value per unit, which the file leaves blank. Each person's FD interest can be compared with the tax shown in Form 26AS.
- **Lent, policies, property** also shows property, NPS, ULIP and foreign-currency balances with the exchange rate used.
- The daily summary now also carries the tax-harvest deadline and amounts, refunds still to claim, and on the first of each month a month-in-review line per person.

## Changing the order

Accounts → **Change the order** lists your banks and, inside each, its rows. Drag a bank or a row, or use the arrow buttons (they work from the keyboard), then press **Save this order**. Accounts and the monthly update follow the new order from then on. Uploading your workbook again with "Apply the sheet layout" sets the order back to the sheet's.

## Form 26AS and the AIS

Tax filing papers → "What the tax department holds". Download **Form 26AS** from TRACES (PDF, text or HTML; the PDF opens with your date of birth, which the app already has from Settings) and the **Annual Information Statement** from the income-tax e-filing portal (PDF or JSON), then upload them there, or e-mail them to your inbox label and they are read by themselves. The app lists each deductor and the tax credited, then compares it with the tax it expected on your deposit interest and fund sales, and compares the AIS's interest, dividends and fund sales with your own records. Differences are shown for you to check; nothing is changed automatically. The department does not publish the exact file layouts, so the reader looks for the parts every version has; if it cannot read a file, forward it by e-mail and an AI reader (the key in Settings) tries, marking the result "read by AI: check the figures".

## Getting your fund statements by e-mail

1. Go to the CAMS or KFintech statement page (or MF Central) and request a **Consolidated Account Statement**: type **Detailed**, period **from the first investment to today**, include folios with zero balance, to the Gmail address the app reads.
2. When the form asks for a password, **type your PAN in capital letters** (the same one saved in Settings). The password is whatever you choose on that form.
3. In Gmail, make a filter: from `camsonline.com`, `kfintech.com`, `mfcentral.com`, `cdslindia.com` or `nsdl.com` and has an attachment, then apply the label `FWOS/Inbox`. Statements are then imported by themselves, now and when the registrars send you monthly ones.
