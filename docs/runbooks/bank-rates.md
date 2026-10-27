# Runbook: bank rates (monthly refresh and Sync bank rates)

Rates are read only from a bank's own published pages. No comparison or aggregator website is read, and a bank that refuses an automated visit is reported plainly, never worked around.

## What reads the rates

One function, `syncBankRates` (`packages/data/src/rate-sync.ts`), reads one bank. Two callers use it, so their behaviour cannot differ:

- The monthly job `workers/src/rates.ts` (GitHub Actions workflow `rates.yml`, started daily; it reads the pages on the day set under Rates in Settings, the 30th by default, or the last day of a shorter month; a manual run always reads them). It uses the service-role client and reads every enabled row of `rate_sources`, grouped by bank.
- The page **Sync bank rates** (`/rates/sync`, `apps/web/app/(app)/rates/sync/`). The browser calls the server action `syncBank` once per bank, one after the other, so each call stays within the page's `maxDuration` of 60 seconds (the same limit the Settings and Import pages already use; the Hobby plan limit was not re-verified against Vercel documentation, and 60 seconds is within every documented Hobby configuration). The action uses the signed-in member's client, so row level security applies and the service-role key never reaches Vercel. The AI keys are fetched through the member-only function `ai_keys_for_server`, as the Settings checks do.

For each bank the function:

1. Stops with "Not read: no AI key is switched on" when `aiChainFor` returns an empty chain.
2. Reads, at the same time, the pages saved for the bank in Settings (`rate_sources.url`, each with a `kind`: `savings`, `fd` or `both`) and the bank's own documents listed in the registry (`packages/ingest/src/rate-docs.ts`). Each document is labelled with its kind in the text given to the reader.
3. When nothing could be read, writes a plain "Cannot read: …" result (for example "Cannot read: ESAF Small Finance Bank's site refused the automated visit (403 Access Denied)") and keeps the rates on file.
4. Skips the AI when the text, the bank's correction rules and the rate ceiling hash to the value stored in `rate_sources.page_hash` and the last read is younger than half of `rates.staleDays`; the stored rates are confirmed as checked today.
5. Otherwise asks the AI keys in order (purpose `rates_refresh`, recorded on the AI cost page) and saves the rates with `saveRatesRead`: rates typed by a person are never overwritten; a rate read earlier that is no longer on the page is removed, but only for the products (savings, deposits) that the documents actually read carry.
6. Records `last_run_on`, `last_result`, `last_docs` (each document tried, its kind, whether it was read and why not) and `page_hash`/`read_on` on every row of the bank.

## The registry (`rate-docs.ts`)

- `official`: the bank's own pages and PDFs. An entry is either a fixed document (`url`, `label`, optional `kind`, `from`, `max`) or a document found by following a link on one of the bank's pages (`page`, `link`, `linkName`, `label`).
- `domains`: the bank's own domains. A unit test asserts that every address in the registry belongs to one of them and that none names a comparison website. A link found on a page is followed only when it leads to one of these domains.
- A link entry is used for rate PDFs whose address changes with each revision. The link is found in the page's own HTML (visible text, `aria-label`, `title`, `data-gtm-clicktext` or the text of the row the anchor sits in), ignoring dates; a "Bulk" or "≥" row is used only when it is the only match; a PDF is preferred; the first match in page order wins. No script is run. When the link is only created by a script the result says "Cannot read: the “…” link was not found in the page's text (the button may be built by a script)".
- The `label` tells the reader which column or table applies (general public, deposits below ₹3 crore, NRE minimum one year) and where the "effective from" date is.

To add a bank: find its own interest-rate page or rate-sheet PDF, add an entry and its domains, and verify it with `readRateDoc` (plain request, honest user agent). If a plain request is refused, leave the bank without an official entry: the person saves the page address in Settings or pastes the page text on the Sync page.

## When a bank cannot be read

The card on the Sync page says why and opens **Paste the page**. The person opens the bank's page in their own browser, expands every section (collapsed accordions are not copied), selects all, copies and pastes. The reader finds the rates in the text; they are saved marked "Pasted by you". The same box exists in Settings.

A bank may answer the program from one network and refuse it from another (GitHub Actions for the monthly job, Vercel for the Sync page). The result recorded on the bank's rows shows which one the last run was.

## Rates once saved from comparison websites

Earlier versions saved rates from comparison websites with the note "Reference only, from …". They are kept until the bank's own page is synced, then replaced by `saveRatesRead` (their slots are updated or removed like any other read rate). The Sync page counts them and offers **Remove rates from comparison websites**, which deletes exactly the rows with `source_kind = 'ai'` and a note starting "Reference only" for the household.

## Database

`rate_sources` has no uniqueness per bank, so a bank can have several pages (savings on one, deposits on another). Migration `20261027000110_rate_source_kind.sql` adds `kind` and `last_docs`. The SQL test is `supabase/tests/93_rate_source_kind.test.sql`.

## Checks

- `pnpm --filter @fwos/ingest test` (registry, link matcher, wording), `pnpm --filter @fwos/data test` (the shared sync with a fake database, fake pages and a fake AI), `pnpm --filter @fwos/web test` (the page's view builders).
- `apps/web/e2e/ratessync.spec.ts` drives the public sample `/demo/rates/sync` at phone, tablet and desktop widths, including a wide-font overflow check.
