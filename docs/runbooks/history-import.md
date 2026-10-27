# Runbook: Import > History from all monthly tabs

Brings the older tabs of "Summary - Bank Reports" into the app. For what the person sees and chooses, read the user guide ("History from all monthly tabs"). This page is for the person looking after the app.

## How it runs

1. The page sends the .xlsx to the server action `previewHistory` (`apps/web/app/(app)/import/history-actions.ts`). It reads every tab named like a month with `planHistory` (`packages/ingest/src/history.ts`), matches the lines against what the database holds (`loadHistoryExisting`) and returns a light view. Nothing is written.
2. **Import the selected months** calls `importHistoryMonth` once per month. Each call plans again from the file and from the database as it is now, then `applyHistoryMonth` (`history-import.ts`) writes that one month through `historyIo` (`packages/data/src/history.ts`, the signed-in user's client, so row level security applies). The file is posted again each time (about the file's size per month) and is never stored. A request must finish within the page's `maxDuration` (60 s); reading a 30-tab workbook takes a few seconds.
3. `finishHistory` refreshes the pages.

## Safe to repeat

Writes are plain inserts, one marking an older value as replaced when the person chose the sheet's value. A value is skipped when the same account already has the same amount in the same month; a closed record is added only when no deposit or account on file matches it. So a month that failed half way is finished by running it again, and a finished month adds nothing.

## What is stored

- `observations`: `source = 'workbook'`, `confidence = 'imported_unverified'`, `source_ref = 'hist:<tab>:<cell>'` (the corrected month's name when the person chose the month of a tab: `hist:Feb 2026:F12`). A fund's figure uses `histfund:<tab>:<cell>`; `loadPortfolioData` leaves those out, so a fund's valuation never rests on the sheet. Read them for the "the sheet said" line with `source_ref like 'histfund:%'`.
- `assets.from_history = true` for each closed account or deposit added; deposits also have `fixed_deposits.ended_on`, `ended_estimated` and `start_estimated` (migration `20261027000100_history.sql`). `ended_on` is read by the period gains (`endedOn`); other pages still use the maturity date for a closed deposit.

## Settings

`estimates.historyStartsAfterDays` (Settings > Money rules > Estimated balances, default 62): how late after its month a deposit may start before a tab is flagged as probably a copy of a later month.

## When something looks wrong

- **A month does not add up.** The line says by how much. Open the tab: usually a row the reader could not place (listed under "Lines that could not be matched" with its cell) or the sheet's own total is off. The month is not selected until you choose it yourself.
- **A line is "ambiguous".** Two accounts or funds on file fit it (for example a plain "Cash" at a bank with an NRE and an NRO account). Give the account a last four digits or NRE/NRO on the sheet, or leave it.
- **A closed deposit that should not exist** (it was renewed, not closed). It is a record flagged `from_history`: open it on the Deposits page and correct its end date or status there. Nothing else refers to it.
- **Undoing a month.** Values cannot be deleted (observations are append-only). Replace a wrong one by entering the right value for the same date in the Monthly update; the newer entry wins.

## Not done

Net-worth snapshots are not backfilled from history, because a fund's figure in the sheet is not a valuation and an honest past net worth needs one for every class.
