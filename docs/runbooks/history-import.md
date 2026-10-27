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

A closed account or deposit added by the import gets one short note, `From the monthly tabs (2021-06 to 2021-10); ended about 2021-11 (estimate).` (deposits whose start was also estimated add ` Start also estimated.`). The longer explanation (the tabs do not say when an account ended, so the end is the first month it is missing from) is written on the account's own page, which recognises the prefix `HISTORY_NOTE_PREFIX` and reads `ended_estimated` / `start_estimated`. Earlier imports wrote a long note with the explanation inside; the page still recognises it, and Accounts shows any note as one line (full text on hover).

**Accounts and these deposits.** An imported deposit has status `closed` (or `matured`), so Accounts hides it at once; `Show matured` (`?matured=all`) lists it, dimmed. A deposit whose date, or `ended_on`, is more than `deposits.hideMaturedAfterDays` (Settings, default 60) days ago is hidden whatever its status. The Balance history grid and the account's page still show it. None of these deposits is in any total: a deposit past its maturity date is valued as matured and not counted (`packages/core/src/deposit-state.ts`).

## Identifying savings lines from other tabs

`packages/ingest/src/history-identity.ts` (pure, tested in `history-identity.test.ts`; wired in `history.ts` right after the lines are matched).

For each bank-and-person group, the cash lines of a tab are an ordered list. A tab whose lines are all identified (directly matched, or already written by an earlier import, or chosen by the person) is a witness. For a tab with a line the matcher left ambiguous (`candidates` = the accounts it narrowed to), the nearest witness before and after (by month, never a copy or a tab in doubt) decide:

1. **Position, certain.** Same number of lines in both witnesses, listed the same way, so the line is the account at its position. Needs a witness on each side. One side only is *likely*.
2. **Order with opened/closed accounts, likely.** Counts differ. Every assignment of accounts to the open lines is tried that gives the account present in both witnesses a line, uses only accounts present in either, and keeps the listed order; if one remains the line is likely. If none keeps the order or the must-have accounts, the same is tried without those two conditions (the line then says the order differs).
3. **Balance tie-break, likely only.** Among the accounts still possible, the one whose neighbouring balances are closer by `estimates.historyTieRatio` (3) times.
4. **Blocked, with the reason.** The position names an account the line itself rules out (stated NRE/NRO or last four); no assignment fits; or the balance is more than `estimates.historyJumpFactor` (50) times above or below what that account held in both neighbours **and** by more than `estimates.historyJumpFloor` (₹1,00,000). Blocked lines are listed and can still be chosen.

Only *certain* lines are written without a decision. A person's answers travel as `pins` (line id `tab|cell` to account id, or `''` for "leave out") on every preview and import request; a pin is accepted only if the account is one of the accounts of that bank and person that do not contradict the line. A line whose `hist:<tab>:<cell>` value is already on file for one of those accounts keeps it (that is what makes a re-import give the same answer). The observation's note says the account was inferred or chosen (note text only).

Separate check: a line matched only because it does not say "joint" (the matcher takes it to be an account that is not joint) is run through the same inference as a shadow; where the other tabs point to a different account the month's Notes say "Check it". Nothing is changed by it.

## Settings

`estimates.historyStartsAfterDays` (Settings > Money rules > Estimated balances, default 62): how late after its month a deposit may start before a tab is flagged as probably a copy of a later month.

`estimates.historyJumpFactor` (50), `estimates.historyJumpFloor` (₹1,00,000) and `estimates.historyTieRatio` (3): see above.

## When something looks wrong

- **A month does not add up.** The line says by how much. Open the tab: usually a row the reader could not place (listed under "Lines that could not be matched" with its cell) or the sheet's own total is off. The month is not selected until you choose it yourself.
- **A line is "ambiguous".** Two accounts or funds on file fit it. For a savings or cash line (a plain "Cash" at a bank with an NRE and an NRO account) see "Identifying savings lines from other tabs" above. For a fund or a loan, give it a clearer name on the sheet, or leave it.
- **A closed deposit that should not exist** (it was renewed, not closed). It is a record flagged `from_history`: open it on the Deposits page and correct its end date or status there. Nothing else refers to it.
- **Undoing a month.** Values cannot be deleted (observations are append-only). Replace a wrong one by entering the right value for the same date in the Monthly update; the newer entry wins.

## Not done

Net-worth snapshots are not backfilled from history, because a fund's figure in the sheet is not a valuation and an honest past net worth needs one for every class.
