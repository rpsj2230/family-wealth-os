# Phase 1 — Proposed Database Schema (PostgreSQL / Supabase)

Status: **proposal for approval**. Implementation and migrations begin in Phase 2. Scope: India-only tax and product rules; INR is the reporting currency; SGD balances are stored natively and converted.

## 1. Design principles

1. **Append-only facts.** Balances, valuations and transactions are never updated; corrections add a row and an audit event.
2. **One asset, one row.** Net worth = latest valid observation per asset. Goals, scenarios and tax simulations are *overlays* and cannot create value.
3. **Owner ≠ holder ≠ beneficial owner.** Required by the third-party-held accounts and children's accounts.
4. **Fixed precision.** `numeric(18,2)` money, `numeric(18,6)` units, `numeric(18,4)` NAV/FX, `numeric(9,6)` rates.
5. **Every row carries provenance** (`source`, `source_ref`, `as_of`, `confidence`).
6. **Tax rules are data**, effective-dated, never code constants.
7. **RLS everywhere**; household members see the household; service-role key is server-only.

## 2. Table groups

| Group | Tables |
|---|---|
| Identity | `households`, `household_members`, `owners` (person; `pan_last4`, `is_minor`, `residency`), `institutions` |
| Assets | `assets` (type enum), `accounts`, `fixed_deposits`, `fd_events`, `receivables`, `receivable_payments`, `policies`, `properties` |
| Observations | `observations` (balance/valuation), `fx_rates`, `snapshots`, `snapshot_lines` |
| Mutual funds | `mf_schemes` (AMFI code, ISIN, plan, option, exit-load rule id), `mf_folios`, `mf_transactions`, `mf_lots`, `mf_lot_allocations`, `mf_navs`, `sip_plans`, `mf_opening_positions` |
| Goals | `goals`, `goal_allocations` |
| Tax (India) | `tax_rules` (effective-dated), `tax_ledgers` (per owner PAN-ledger per FY), `tax_events`, `tds_entries`, `loss_carryforwards`, `harvest_simulations`, `filing_packs` |
| Planning | `plan_assumptions`, `scenarios`, `retirement_runs`, `cashflow_plans` |
| Ingestion | `import_batches`, `source_documents`, `import_exceptions`, `reconciliation_items`, `parser_templates` |
| Operations | `tasks`, `notifications`, `delivery_log`, `audit_events` |
| Emergency | `emergency_registry`, `emergency_documents`, `trusted_contacts`, `access_requests` |

## 3. Core DDL (illustrative; final in `supabase/migrations/`)

```sql
create type asset_type as enum
  ('bank_account','fixed_deposit','mutual_fund','stock','receivable','policy',
   'property','ulip','nps','third_party_held','other');

create table households (id uuid primary key default gen_random_uuid(), name text not null);

create table household_members (
  household_id uuid references households on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('admin','member','emergency_viewer')),
  primary key (household_id, user_id)
);

create table owners (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households,
  display_name text not null,
  pan_last4 char(4),                  -- never the full PAN
  is_minor boolean not null default false,
  tax_residency text not null default 'NRI',
  dob date
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households,
  type asset_type not null,
  owner_id uuid not null references owners,         -- legal owner for tax
  holder_name text,                                 -- if held in someone else's name
  beneficial_owner_id uuid references owners,       -- who the money belongs to
  institution_id uuid references institutions,
  nickname text not null,
  identifier_last4 text,
  currency char(3) not null default 'INR',
  status text not null default 'active'
    check (status in ('active','matured','closed','matured_unconfirmed','stopped')),
  expected_freshness_days int not null default 35,
  created_at timestamptz not null default now()
);

create table observations (                          -- append-only
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets,
  kind text not null check (kind in ('balance','ledger_balance','available_balance','valuation','accrued_value')),
  amount numeric(18,2) not null,
  currency char(3) not null,
  fx_rate numeric(18,4),                            -- INR per unit, with fx_source/fx_date
  as_of date not null,                              -- the date the value represents
  received_at timestamptz,                          -- when the email/file arrived
  source text not null,                             -- manual | email | statement | cas | workbook
  source_ref text,
  confidence text not null check (confidence in ('verified','manual_confirmed','imported_unverified','manual_unverified','estimated')),
  superseded_by uuid references observations,
  created_by uuid, created_at timestamptz not null default now()
);

create table fixed_deposits (
  asset_id uuid primary key references assets,
  principal numeric(18,2) not null,
  rate numeric(9,6) not null,
  booked_on date not null,
  maturity_on date not null,
  compounding text not null default 'quarterly',
  payout text not null default 'cumulative',
  bank_maturity_amount numeric(18,2),
  account_kind text check (account_kind in ('NRE','NRO','FCNR','resident')),
  joint boolean not null default false,
  renewed_from uuid references fixed_deposits(asset_id),
  maturity_instruction text
);

create table mf_transactions (                       -- append-only ledger
  id uuid primary key default gen_random_uuid(),
  folio_id uuid not null references mf_folios,
  scheme_id uuid not null references mf_schemes,
  txn_date date not null,
  kind text not null check (kind in ('purchase','sip_purchase','redemption','switch_in','switch_out','dividend_reinvest','stamp_duty','stt')),
  units numeric(18,6) not null,
  nav numeric(18,4) not null,
  amount numeric(18,2) not null,
  source_doc uuid references source_documents,
  dedupe_key text not null unique                   -- hash(folio, date, kind, units, amount)
);

create table goal_allocations (
  goal_id uuid references goals,
  asset_id uuid references assets,
  method text not null check (method in ('percent','amount')),
  value numeric(18,4) not null,
  primary key (goal_id, asset_id),
  check (value >= 0)
);
-- trigger: SUM(percent) per asset <= 100; SUM(amount) per asset <= latest valuation.
```

## 4. Row Level Security pattern

```sql
create function is_member(h uuid) returns boolean language sql stable security definer as
$$ select exists (select 1 from household_members m where m.household_id = h and m.user_id = auth.uid()) $$;

alter table assets enable row level security;
create policy assets_read  on assets for select using (is_member(household_id));
create policy assets_write on assets for all
  using (is_member(household_id)) with check (is_member(household_id));
```

- Both spouses have `role='admin'` and see everything (your decision).
- Tax tables join through `owners.id`; **a tax ledger row can reference exactly one owner**, and views that aggregate for the household are labelled informational. Cross-owner loss set-off is not possible by construction.
- `emergency_viewer` can read only the emergency tables, and only after an approved `access_request`.
- Storage buckets are private; files are served by short-lived signed URLs.

## 5. Net worth and freshness rules

- **Net-worth value of an asset** = latest observation with `confidence != 'estimated'` and `status in ('active')`; FDs use `accrued_value` (principal compounded quarterly to the valuation date), never the maturity amount.
- **Freshness** = today − `as_of` versus `expected_freshness_days`: *current*, *older than expected*, *stale* (> 2×), *missing*, *imported-unverified*, *manually confirmed*.
- **Receivables** = Σ lent − Σ repayments; excluded from "liquid".
- **Insurance coverage** is stored on `policies`; it is never summed into net worth.
- **Double-count guard:** a unique constraint on `(institution_id, owner_id, account_kind, identifier_last4)`, plus the ULIP rule (counted once).

## 6. Audit

`audit_events(actor, table, row_id, action, before jsonb, after jsonb, reason, at)` written by triggers on every financial table; corrections require a reason string.
