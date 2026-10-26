# Runbook — Sync with Google Sheet

The household keeps a Google Sheet ("Summary - Bank Reports") with **one tab per month** (`Oct 2026`, `Sep 2026`, …). **Sync with Google Sheet** writes the app's figures into this month's tab, in the sheet's own format. It is the reverse of the workbook importer and uses the importer's own row rules to decide which sheet row is which account.

It costs nothing: a Google service account is free and the Sheets API has a free quota far above what this uses (four to six calls per sync).

## One-time setup (about ten minutes)

1. **Create a Google Cloud project** (console.cloud.google.com; any name). No billing is needed.
2. **Enable the API.** APIs & Services > Library > "Google Sheets API" > Enable.
3. **Create the service account.** IAM & Admin > Service Accounts > Create service account. Any name; it needs no role.
4. **Create a key.** Open the account > Keys > Add key > Create new key > **JSON**. A `.json` file downloads. It is a password: do not e-mail it or commit it.
5. **Share the sheet.** Open your Google Sheet > Share > add the account's e-mail (the `client_email` in the file, `…@…iam.gserviceaccount.com`) as **Editor**. The file must be a real Google Sheet. If it is an Excel file opened in Sheets (the title shows `.xlsx`), choose File > Save as Google Sheets and use the new copy.
6. **Paste it in the app.** Settings > Connections > Google Sheet: paste the sheet's link (or its ID), paste the key (or choose the file), Save. The key is stored on the server and cannot be shown again.
7. **Test the connection** (same card). It reports step by step: key accepted, spreadsheet found, which month tabs exist, which tab will be copied for this month, that the layout is recognised, and that the account can edit.

## Using it

On **Import** (section "Or send this month to your Google Sheet") or the **Monthly update** page (button in the header):

1. **Preview sync.** Reads the sheet and the app and lists, per row, `old → new`, new rows, rows closed in the app, rows it could not match and accounts to place by hand. Nothing is changed in the spreadsheet.
2. **Confirm and write to Google Sheet.** Does it. Syncing twice gives the same sheet.

### What the sync does

| Situation | What happens |
|---|---|
| This month has **no tab** | The most recent **earlier** month tab is duplicated inside the spreadsheet (so formatting, merged group headings, formulas and column widths stay), named like the existing tabs (`Oct 2026`, or `October 2026`, `Oct'26` … whatever style the template uses) and placed on the side where the workbook already keeps its newer months (detected from the tab order: newest-left or newest-right). |
| This month **has a tab** | Its data is replaced. First **one hidden safety copy** is made, `Oct 2026 - before sync`, at the far end of the tab bar. It is overwritten on each sync (never more than one). |
| Any other month's tab | Never read for writing, never changed, never deleted. |

"This month" is the calendar month **in the household time zone** (default Asia/Singapore), so on 1 November in Singapore the sync fills `Nov 2026` even if it is still 31 October in UTC.

### What is written, per row

Only **constant cells the format uses**. A cell that holds a formula (`=F12`, `=G12-H12`, the totals) is **never** written; the preview names the formula cells it kept.

| Row | Written |
|---|---|
| Indian cash (`Cash-NRE`, `Cash-NRO`) | **F**: the balance the app shows on Accounts (the last balance carried forward at the account's rate) |
| Singapore cash (`Cash SG`) | **F**: the rupee value; **N**: the S$ amount and the exchange rate inside the note, in the note's own text (`Base: $1= Rs 74.26` / `Bal : $100.00`), other words in the note stay |
| Fixed deposit | **C** rate, **D** start date, **E** maturity date, **F** principal, **G** the bank's maturity value (or the app's computed maturity amount, as Accounts shows), **N** the deposit number as `FD Number : …` (deposit numbers are shown in full in the app; other words in the note stay) |
| Fund | **F** value (units × live price as the app shows), **H** invested, **D** start date; `(STOPPED) ` is added to **B** when the app says the SIP is stopped (never removed). Goal (**E**) and SIP note (**N**) stay as the sheet has them |
| ULIP | **F** value only |
| Money lent | **F** what is still owed |
| Held by someone else | **F** the value |

Dates are written as real dates (serial numbers) into cells that keep their own date format; where a target cell had no date format it gets the format the column already uses. Numbers are numbers.

**Never written:** column A group headings, M "Changes Req", goal text, the summary blocks to the right (P–T, V–X, Z–AB) and the Plans block (rows below the register), account numbers, PANs, or anything the sheet has no column for. Account numbers and PANs stay masked to their last four digits in the app and are never sent to the sheet; only deposit numbers (shown in full in the app) are written.

### Rows that do not match

- **Closed, renewed, matured or gifted in the app** but still in the sheet: the row is left as it is and listed ("closed in the app, still in the sheet"). Rows are never deleted.
- **In the sheet, not in the app**: left untouched and listed.
- **In the app, not in the sheet**: if its group (bank and owner; `Others` for loans; `SIP - person (PAN holder)` for funds) exists, a **new row** is inserted below the last line of the same kind in that group, with that line's formatting, and any formulas (`=F12` → `=F13`) copied into it. If there is no matching group, no unambiguous goal for a fund, or the sheet already has an unmatched line of the same kind in that group (it may be this account under another spelling), the account is **listed for you to place by hand**. ULIP and money held by others are always placed by hand when missing.

How rows are matched: the importer's identity rules (group `Bank - Owner`, the label in column B, NRE/NRO, last four digits, `JO` for joint), with deposits also matched by deposit number, then start date + amount, then dates, so two deposits labelled just `FD` in one group are told apart. Funds match on any of the fund's names plus the PAN holder and start date.

## How to undo a sync

If the month's tab existed before the sync, the hidden tab **`<month> - before sync`** holds it exactly as it was:

1. In Google Sheets: View > Hidden sheets > `Oct 2026 - before sync` > show it.
2. Either copy its cells back over the month tab, or delete the month tab, rename the safety copy to `Oct 2026` and drag it to its place.

If the month's tab was created by the sync, undo is to delete that tab (the template was only copied, never changed). The safety copy is overwritten by the next sync, so undo before syncing again. Google Sheets' own File > Version history also records every change.

## Choices made

- **Settings.** The time zone, the register's first/last row (used only when the sheet shows no total row; the real end is found from the `=SUM(F…)` total row or the `Plans` heading) and the safety copy's suffix are in the household configuration (`sheetSync`: `timeZone`, `firstRow`, `lastRow`, `backupSuffix`, validated in `packages/core/src/config.ts`). They have working defaults and are not in the Money rules screen.
- **One sync at a time.** A database marker (`claim_gsheet_sync`) stops a second press or person from starting another; it lapses after two minutes.
- **Duration.** The pages that start a sync (Import, Monthly update, Settings) set `maxDuration = 60`, the Vercel Hobby limit. Every Google call has a 15-second limit.
- **Summary blocks.** The sheet's pasted/derived summary blocks (P–AB) are not recomputed; if they are formulas they update themselves, if they are pasted values they keep last month's numbers in the copy.
- **A new row below a group's last line** sits just under that group's merged heading cell, because Google does not grow a merge for a row added at its edge.

## If it says something is wrong

| Message (shortened) | What to do |
|---|---|
| "Google did not accept the service-account key" | The key was deleted or the account disabled. Create a new JSON key and paste it. |
| "The Google Sheets API is not switched on…" | Cloud console > APIs & Services > Library > Google Sheets API > Enable; wait a minute. |
| "The spreadsheet is not shared with the service account…" | Share the sheet with the e-mail shown in Settings as **Editor** (Viewer is not enough). |
| "Google cannot find that spreadsheet" | Check the link/ID; the ID is the text between `/d/` and `/edit`. |
| "This file is an Excel file opened in Google Sheets…" | File > Save as Google Sheets, use the new link. |
| "No month tab before Oct 2026 to copy from" | Name last month's tab like `Sep 2026`. |
| "does not look like the usual layout" | The tab has none of the row types (deposit date in E, `Cash-NRE`/`Cash-NRO`, `Cash SG`, `SIP…`, `Cash Loan`). Open it and compare with an earlier month. |
| "A sync is already running" | Wait a minute and preview again. |
| "A visible tab is already called … - before sync" | The sync keeps its safety copy under that name and will not delete a tab you can see; rename yours. |

## Security

- The key is saved through a database function and **cannot be read back** by any page (column grants hide it); a member-only function hands it to server code for one request. It is never logged, never in an error message and never sent to the browser. The access token lives only in server memory for its hour.
- To revoke: tick "Remove the connection and the saved key" in Settings, and delete the key (or the service account) in Google Cloud. To rotate: create a new key and paste it.
- The service account can reach only sheets you share with it.

## What was verified, and what was not

Everything is tested against a **fake Google** (`packages/ingest/test/fake-google.ts`): it verifies the RS256 signature of the token request and implements the Sheets calls used, including formula recalculation and row insertion. It has **not** been run against the real Google Sheets API or the real workbook. First real use: run **Test connection**, then **Preview sync**, read the preview against the sheet, then confirm; the hidden safety copy makes a wrong write recoverable.
