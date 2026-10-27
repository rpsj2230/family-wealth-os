# What is configurable (and where)

Settings is split into sections, each with its own address: `/settings?tab=` `setup` (checklist of what is configured), `people`
(people, income and spending), `rules` (Money rules: deposits, reminders, estimates, rate suggestions, NRO refunds, harvesting,
fund history check, "When I need money"), `tax` (rules per financial year), `notifications` (e-mail, Telegram, WhatsApp, deliveries), `connections`
(AI keys with their order and on/off switch, Gmail label, bank rate pages) and `access` (emergency access and handbook content). Old links such as `/settings#tax`
or `#email` are moved to the right section by a small script. Each Money rules card saves alone and is marked "Confirmed by you"
once saved; until then it runs on the built-in numbers. The names below (for example "Limits and reminders") are the old section
names; they now live under Money rules.

Nothing personal and no tunable number is written into the code. Everything below is edited in the app (Settings) and stored per household in the database.

| What | Where in Settings | Used by |
|---|---|---|
| Date of birth, PAN (write-only; last four shown), tax residency, guardian, minor, primary/spouse role | People | Retirement ages, tax per person, fund-statement password (full PAN is read only by the importer) |
| Salary, other income, spending: any currency, monthly or yearly | Income and spending | Monthly saving shown in Settings; available to planning |
| Retirement age, planning end age, spending, return and inflation assumptions, scenarios, one-off costs | Can I retire now? (assumptions panel) | Retirement verdict |
| Deposit insurance limit (per ownership name, per bank); maturity alert steps; "maturing soon" days | Limits and reminders | Accounts, Deposits, Home, daily summary |
| Reminder windows for policies and tasks; harvest reminder date | Limits and reminders | Daily summary, tasks, Home |
| Home: days that "this month" compares with, how far ahead Coming up looks, share of bank money at which a bank is flagged | Limits and reminders | Home (headline change, What changed, Coming up, What to watch) |
| Out-of-date days for balances; assumed savings rate; assumed tax on interest; include SIP instalments; days after its month at which a monthly tab's deposit makes it suspect (Import history) | Limits and reminders | Current value estimates |
| Instalments in a row that make a SIP (default 3): a new, resumed or changed SIP is proposed from a fund statement or file only after this many similar instalments one gap apart. Whether a SIP has stopped is not a setting: it is judged from each SIP's own pattern | Limits and reminders | The Preview changes step of Import (fund statements and fund app exports) and the emailed statements |
| Harvest: smallest sale, extra holding months, leave out SIP funds, non-resident withholding | Limits and reminders | Automatic tax-gain plan |
| Fund history check: the date every fund's transactions should go back to (default 1 Jan 2021), the units a history may be out by (default 0.001), the rupees the invested amount may be out by (default 1) | Money rules → Fund history check | The Data check under each person on Investments, the status chip on every fund, the "Does this add up?" block and the "est." marks on a fund whose history does not reconcile |
| Months before international, gold and fund-of-funds units are long-term (default 24) | Money rules → Tax-gain harvesting | The short-term / long-term split in the Exit load and tax panel of those funds (equity funds use the holding period in Tax rules) |
| Tax rules per financial year: months to long-term, short and long-term rates, tax-free allowance, cess, verified flag, source note | Tax rules | Tax page, simulator, filing papers |
| Digest recipients; bank-email label; AI provider and key (write-only) | Daily summary, Bank emails and AI | Email jobs |
| Dated tasks (plans, deadlines) | Tasks > Add many tasks at once | Daily summary reminders |
| AI prices: rupees per US dollar, and one price line per model (input / output / cache read / cache write, dollars per million tokens) | Money rules → AI prices | AI cost page |

Built-in defaults exist only as starting values and are marked as such in the screens. A financial year with no tax rules entered uses the latest earlier year and says so.
CI runs `scripts/check-private-data.sh`, which fails the build if a PAN-shaped value or a personal email appears in code.
