# What is configurable (and where)

Nothing personal and no tunable number is written into the code. Everything below is edited in the app (Settings) and stored per household in the database.

| What | Where in Settings | Used by |
|---|---|---|
| Date of birth, PAN (write-only; last four shown), tax residency, guardian, minor, primary/spouse role | People | Retirement ages, tax per person, fund-statement password (full PAN is read only by the importer) |
| Salary, other income, spending: any currency, monthly or yearly | Income and spending | Monthly saving shown in Settings; available to planning |
| Retirement age, planning end age, spending, return and inflation assumptions, scenarios, one-off costs | Can I retire now? (assumptions panel) | Retirement verdict |
| Deposit insurance limit (per ownership name, per bank); maturity alert steps; "maturing soon" days | Limits and reminders | Accounts, Deposits, Home, daily summary |
| Reminder windows for policies and tasks; harvest reminder date | Limits and reminders | Daily summary, tasks |
| Out-of-date days for balances; assumed savings rate; assumed tax on interest; include SIP instalments | Limits and reminders | Current value estimates |
| Harvest: smallest sale, extra holding months, leave out SIP funds, non-resident withholding | Limits and reminders | Automatic tax-gain plan |
| Tax rules per financial year: months to long-term, short and long-term rates, tax-free allowance, cess, verified flag, source note | Tax rules | Tax page, simulator, filing papers |
| Digest recipients; bank-email label; AI provider and key (write-only) | Daily summary, Bank emails and AI | Email jobs |
| Dated tasks (plans, deadlines) | Tasks > Add many tasks at once | Daily summary reminders |

Built-in defaults exist only as starting values and are marked as such in the screens. A financial year with no tax rules entered uses the latest earlier year and says so.
CI runs `scripts/check-private-data.sh`, which fails the build if a PAN-shaped value or a personal email appears in code.
