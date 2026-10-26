# Family Wealth OS

Private household wealth, mutual-fund, tax-filing and retirement-planning system (India rules, INR reporting).

**Status:** Phase 1 (discovery) approved. Build in progress — see the living [Master Build Plan](docs/PLAN.md).

## Phase 1 documents
1. [Workbook analysis](docs/phase1/01-workbook-analysis.md)
2. [Data dictionary and migration mapping](docs/phase1/02-data-dictionary-and-migration-mapping.md)
3. [Schema proposal](docs/phase1/03-schema-proposal.md)
4. [Cost and dependency register](docs/phase1/04-cost-register.md)
5. [Open questions, missing fields, assumptions](docs/phase1/05-open-questions-and-missing-fields.md)

## Tools
`tools/analyse_workbook.py` — re-runs the independent cross-checks on the workbook. Run with `python3 -I tools/analyse_workbook.py <path-to-xlsx>`. The workbook itself is never committed (see `.gitignore`).

## Brand
`public/brand/rp-logo.png` — RP logo (531×368, transparent PNG). A vector (SVG) version is preferable for the final build.

## Data safety
Never commit spreadsheets, statements, CAS PDFs, `.env` files or keys. PANs and account/policy numbers are stored masked.
