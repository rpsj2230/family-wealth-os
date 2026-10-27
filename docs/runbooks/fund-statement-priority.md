# Fund statements win: how lines are replaced, reviewed and brought back

A detailed fund statement (CAS) is the top-priority record. This page is for the person looking after the app: what is stored, how to see
what a statement replaced, how to undo it, and what to check when a statement shows something odd. The rules are in
`packages/core/src/fund-precedence.ts` (the table) and `packages/core/src/fund-import-diff.ts` (the comparison); the plain-words version
is in USER-GUIDE.md, "Which record wins".

## What is stored

| Where | What |
|---|---|
| `mf_transactions.source` | `cas` (a statement), `csv` (an app export), `estimate`, `manual`. Lines imported from an app export before this change were stored as `cas`; the migration relabels the ones that read exactly like the export's wording (`Purchase (folio 1234)`, `SIP purchase (folio …)`, `Redemption (folio …)`). |
| `mf_transactions.superseded_on / superseded_by_ref / superseded_statement_on / superseded_reason` | A line a statement replaced. All four are set or all empty. A line with `superseded_on` set is set aside: every reader (`loadFundStates`, Investments, fund page ledger, lots and tax harvesting, realised gains, SIP estimates, the ledger check) leaves it out. Nothing is deleted. |
| `mf_positions.cas_detail_from / cas_detail_to` | The period of the latest detailed statement that decided the fund (and that added up). An older statement cannot override it; an app export cannot overwrite what it decided. |
| `public.supersede_fund_lines`, `public.restore_fund_lines` | The only two ways a line is set aside or brought back. Both run with the caller's rights (row-level security) and never touch a line whose source is `cas`. |
| `audit_events` | Setting aside and bringing back are logged (only those, not ordinary inserts). |

## See what a statement replaced

- On the fund page, Transactions tab: the collapsed group **Replaced by the statement** lists the date, what, where it came from and the statement it was replaced by.
- In SQL: `select txn_on, kind, amount, units, source, superseded_by_ref, superseded_statement_on, superseded_reason from mf_transactions where asset_id = '<fund>' and superseded_on is not null order by txn_on;`
- Import > Fund statement > Recent statements keeps the full change list of every import, including how many lines each fund had replaced.

## Undo it for one line or one statement

A replaced line is data, not rubbish. To bring it back (for example the statement turned out to be the wrong person's), as an administrator:

```sql
update mf_transactions
   set superseded_on = null, superseded_by_ref = null, superseded_statement_on = null, superseded_reason = null
 where asset_id = '<fund>' and superseded_by_ref = '<the statement reference, e.g. upload:abc123 or the message id|file name>';
```

The lines come back live with their old source. Their position figures are not recalculated: if the units or the amount invested were
changed by that statement, correct them on the fund (Investments > edit) or import the right statement. To forget that a statement
decided a fund (so that an older one may be used), `update mf_positions set cas_detail_from = null, cas_detail_to = null where asset_id = '<fund>';`.

## What to check when a preview looks wrong

| You see | Meaning and what to do |
|---|---|
| "Nothing on file was replaced: its lines lead from X to Y units but it says it closes at Z" | The statement's own lines do not add up, so it replaces nothing and records no period. Usually the PDF text was read incompletely: ask for the statement again, or compare the fund's rows with the PDF. |
| "A statement dated … is already applied, so this older one replaces nothing." | You uploaded a statement older than the one already decided. Nothing was lost; use the newer one. |
| "Kept: the fund statement dated … is more accurate than this file" | An app export was imported after a statement that covers it. The statement's values stand. |
| **Not on this statement: check** | A fund on file is not listed. Statements made from an email address list only folios registered under that email, so this is expected for funds registered elsewhere. Close the fund yourself on its page if it was sold. |
| "Folios of someone not in your family list: skipped" | The statement holds folios whose PAN is not saved for anyone in Settings. Add the PAN, or ignore them. |
| A fund is replaced twice | It is not: importing the same statement again finds the statement's lines by their stored reference and the replaced lines are no longer live. |

## Before relying on it for a new person

1. Settings: the PAN (last four characters are enough for matching folios; the full PAN is needed to open the PDF in the mailbox job) is saved for everyone whose folios may be on a statement.
2. Import one detailed statement, read the preview (it replaces nothing until you press Apply), and check one fund's Transactions tab afterwards.
3. Run `PGHOST=/var/run/postgresql PGUSER=root ./supabase/tests/run.sh` after changing the migration `20261027000130_cas_priority.sql`.
