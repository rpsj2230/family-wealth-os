# What is configurable (and where)

Settings is split into sections, each with its own address: `/settings?tab=` `setup` (checklist of what is configured), `people`
(people, income and spending), `rules` (Money rules: deposits, reminders, estimates, rate suggestions, NRO refunds, harvesting,
"When I need money"), `tax` (rules per financial year), `notifications` (e-mail, Telegram, WhatsApp, deliveries), `connections`
(AI key, Gmail label, bank rate pages) and `access` (emergency access and handbook content). Old links such as `/settings#tax`
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
| Out-of-date days for balances; assumed savings rate; assumed tax on interest; include SIP instalments | Limits and reminders | Current value estimates |
| Harvest: smallest sale, extra holding months, leave out SIP funds, non-resident withholding | Limits and reminders | Automatic tax-gain plan |
| Tax rules per financial year: months to long-term, short and long-term rates, tax-free allowance, cess, verified flag, source note | Tax rules | Tax page, simulator, filing papers |
| Digest recipients; bank-email label; AI provider and key (write-only) | Daily summary, Bank emails and AI | Email jobs |
| Dated tasks (plans, deadlines) | Tasks > Add many tasks at once | Daily summary reminders |

Built-in defaults exist only as starting values and are marked as such in the screens. A financial year with no tax rules entered uses the latest earlier year and says so.
CI runs `scripts/check-private-data.sh`, which fails the build if a PAN-shaped value or a personal email appears in code.
