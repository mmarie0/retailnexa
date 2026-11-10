# Database schema

Source of truth: `supabase/migrations/*.sql` (applied in filename order). This document explains intent; if they disagree, the migration wins and this file must be fixed.

## Schemas
- `public` — application tables and API-callable RPCs (exposed through PostgREST).
- `private` — helper functions used inside RLS policies and RPCs, plus `rate_limits`. Not exposed by the API.
- `auth` — owned by Supabase Auth. We only reference `auth.users(id)` and call `auth.uid()` / `auth.jwt()`.

## Phase 1 tables

| Table | Purpose | Client access (RLS) |
|---|---|---|
| `organizations` | Tenant. `business_type` retail/wholesale/both, `status` active/suspended/closed, `trial_consumed_at`, `canceled_at`, `retention_review_at` | Members read; `org.manage` updates name/legal_name/phone/website/timezone/currency only (column grants). Platform admins read. |
| `profiles` | One per auth user (created by trigger) | Self, co-members, platform admins read; self updates `full_name` |
| `memberships` | user ↔ org with `role`, `status` | Self, `members.view`, platform admins read. **Writes only via RPCs.** |
| `locations` | Stores, warehouses, offices | Members read; `locations.manage` inserts/updates (no delete — deactivate) |
| `member_locations` | Optional per-member location restriction | `members.view` read; writes only via `set_member_locations` (rank-checked); same-org enforced by trigger |
| `permissions`, `role_permissions` | Permission catalog + role defaults | Authenticated read |
| `member_permission_overrides` | Per-member allow/deny | `members.view` read; writes via `set_member_permission` |
| `invitations` | Email invites; **token stored as SHA-256 only**, 7-day expiry, cannot invite owners | `members.manage` reads all columns except `token_hash` |
| `billing_accounts` | org ↔ Stripe customer (unique both ways) | `billing.view` read; service role writes |
| `subscriptions` | Mirror of the org's Stripe subscription; `past_due_since` anchors the 7-day grace | Members read status/plan/date columns only (Stripe ids not granted); service role writes via `sync_subscription` |
| `subscription_events` | trial_started / status_change / reactivated / cancel_scheduled / cancel_unscheduled | `billing.view` read |
| `stripe_events` | Webhook idempotency ledger (no payloads stored) | Platform superadmin/billing read |
| `feature_overrides` | Platform-granted entitlement exceptions | Members read; platform admins write via RPC |
| `platform_admins` | Platform staff + role + `mfa_required` | Self / superadmin read; no client writes |
| `support_access_grants` | Tenant-granted, ≤72h, revocable staff access | `org.manage` and platform admins read |
| `leads` | Demo requests / contact messages | Platform admins read; service role inserts |
| `announcements` | Platform announcements | Authenticated read while live |
| `audit_logs` | Append-only activity log. `organization_id` has **no foreign key** on purpose so history survives an owner-approved org deletion | `audit.view` per org; platform admins all |

## Phase 2 ledger tables (migration `20261110000100_ledger.sql`)

| Table | Purpose | Client access |
|---|---|---|
| `accounts` | Chart of accounts; 25 system accounts seeded per org with a semantic `role` (cash_on_hand, inventory, accounts_payable, sales, cogs, rent …) | `accounting.view` (or support grant) reads; `accounting.post` adds/renames non-system accounts |
| `accounting_periods` | “Books closed through date” markers | `accounting.view` reads; `close_books_through()` writes |
| `journal_entries` | Posted entries: date, memo, source, idempotency key + payload hash, `reverses_entry_id` | read-only; **immutable** (trigger) |
| `journal_lines` | Debit or credit lines in cents, account of the same org | read-only; **immutable** (trigger) |

RPCs: `post_journal_entry` (accounting.post; balanced, ≥2 lines, same-org active accounts, open period, idempotent), `system_post_journal_entry` (service role, for imports/POS sync), `reverse_journal_entry` (once, mirrored lines, reason required), `close_books_through` (accounting.close; past dates only, monotonic), `trial_balance(org, as_of)` (accounting.view).

Posting rules from business events to lines live in `src/lib/accounting/postings.ts` (inventory purchase → asset, COGS at sale, bill payment settles AP, sales tax → liability, owner draws → equity, card deposits split fees).

## Phase 2 accounts-payable tables (migration `20261110000200_vendors_bills.sql`)

| Table | Purpose | Client access |
|---|---|---|
| `vendors` | Suppliers: contact details, `payment_terms_days`, optional default account; name unique per org (case-insensitive) | `vendors.view` reads; `vendors.manage` inserts/updates listed columns; no deletes |
| `bills` | Vendor bills: number, dates, `status` (draft/approved/paid/void), `total_cents`, `paid_cents`, link to the posting entry | `bills.view` reads; writes only via RPCs |
| `bill_lines` | Expense or inventory account + amount per line | `bills.view` reads; **insert-only** |
| `bill_payments` | Payments from bank or cash, idempotency key, link to the posting entry | `bills.view` reads; **insert-only** |

RPCs: `create_bill` (bills.create; active vendor, 1–100 positive lines on expense/inventory accounts; due date defaults from vendor terms), `approve_bill` (bills.approve; posts Dr lines / Cr AP), `record_bill_payment` (bills.pay; ≤ open balance, not before bill date, idempotent), `void_bill` (bills.approve; reason required; reverses the posting; refused once paid), `bill_account_options` (bills.view/create; lets managers pick accounts without reading the books). A trigger blocks `reverse_journal_entry` on bill/bill-payment entries so bill status and ledger can’t drift.

## Phase 2 sales tables (migration `20261110000300_sales_days.sql`)

| Table | Purpose | Client access |
|---|---|---|
| `sales_import_batches` | One per CSV import: source (csv/vela), filename, rows recorded | `sales.view` reads; `create_sales_import_batch()` writes |
| `sales_days` | Register Z-report per location/register/date: gross, discounts, tax, cash, card, store credit, journal entry; voidable once | `sales.view` reads; writes via RPCs; amounts immutable (trigger) |
| `sales_day_categories` | Optional category breakdown (net sales, quantity) | `sales.view` reads; insert-only |

RPCs: `record_sales_day` (sales.import; tenders must equal gross − discounts + tax; one live record per location/register/date; posts like `dailySales()`), `void_sales_day` (sales.edit; reason required; reversal dated on the business date), `create_sales_import_batch` (sales.import). Sales entries can’t be reversed directly through the journal.

`account_activity(org, from, to)` (migration `20261110000400`): net debits − credits per account role for a date range (≤ 10 years); accounting.view or profit.view. Feeds the dashboard P&L via `profitInputsFromBalances()` + `computeProfit()`.

`account_activity_detail(org, from, to)` (migration `20261110000500`): every account with its net movement in the range; accounting.view or profit.view. Feeds the Profit & loss page via `incomeStatement()`; the Balance sheet uses `trial_balance` + `balanceSheet()` (`src/lib/accounting/statements.ts`).

`record_money_movement(org, kind, date, amount, key, fees, account, memo, location)` and `recent_money_movements(org, limit)` (migration `20261110000600`): guided card/cash deposits, sales-tax payments, owner draws and contributions posted straight to the journal (`source_type` = kind). No extra table — the journal is the record; reversals go through `reverse_journal_entry`.

`sales_tax_summary(org, from, to)` (migration `20261110000700`): opening, collected, paid and closing balance of Sales tax payable for a period; accounting.view or profit.view.

## Phase 2 bank tables (migration `20261110000800_bank_reconciliation.sql`)

| Table | Purpose | Client access |
|---|---|---|
| `bank_import_batches` | One per statement import: filename, inserted / duplicate counts | `bank.view` reads; RPC writes |
| `bank_lines` | Statement lines (signed cents), de-duplicated by date + amount + description + occurrence; `status` unmatched / matched / categorized / ignored; linked journal entry | `bank.view` reads; amounts immutable; status only via RPCs |

RPCs (writes need `accounting.post`): `import_bank_lines`, `bank_match_candidates` (bank.view), `match_bank_line`, `categorize_bank_line`, `ignore_bank_line`, `unmatch_bank_line`.

## Recurring bills (migration `20261110001500`)

`recurring_bills`: template (vendor, store, lines, `frequency` weekly/monthly/quarterly/yearly, `day_of_month`, `next_date`, optional `end_date`, `due_days`). `bills.recurring_bill_id` + `recurring_period` with a unique index make each period bill at most once. RPCs: `save_recurring_bill` (bills.create, location-scoped), `create_due_recurring_bills(org, through)` (draft bills for every due period up to the business-local today; ≤ 60 periods per template per run; ≤ 31 days ahead). Reads: `bills.view` + store scope.

Migration `20261110001600`: editing a template keeps its stored `day_of_month` unless the next bill date moves (#65). Bill creation is shared through `private.insert_bill` (no caller checks); `create_bill` and the recurring run call it after their own checks. `run_recurring_bills_job()` (service_role only; refuses any signed-in caller) runs every writable business's due templates up to its local today; one business failing is logged to `audit_logs` (`recurring_bills.failed`) and doesn't stop the others. Bills it creates have `created_by` null and a `system` audit entry.

Money movements (#27): `record_money_movement` requires a store the caller can access (store-restricted members can't record org-wide entries); `recent_money_movements` shows cash-only callers just their stores' deposits.

## Key functions

Authorization helpers (`private`, SECURITY DEFINER, `search_path=''`): `is_org_member`, `member_role`, `has_permission`, `is_platform_admin(roles[])` (requires `aal2` when `mfa_required`), `has_support_access`, `org_is_writable` (org active **and** subscription trialing/active or past_due ≤ 7 days), `shares_org_with`, `role_rank`.

Tenant RPCs (granted to `authenticated`): `create_organization`, `my_permissions`, `invite_member`, `revoke_invitation`, `accept_invitation` (requires a confirmed email), `update_member_role`, `set_member_status`, `set_member_permission`, `set_member_locations`, `grant_support_access`, `revoke_support_access`.

Triggers: `set_updated_at`, row-change audit on configuration tables, same-org checks on `member_locations` / overrides, store-count plan limit on `locations`, profile creation and email sync from `auth.users`, verified-authenticator requirement on `platform_admins`, append-only guard on `audit_logs`.

Platform RPCs (authenticated, re-check platform role + MFA): `admin_set_org_status`, `admin_set_feature_override`, `admin_update_lead`, `admin_create_announcement`, `admin_end_announcement`.

System RPCs (`service_role` only): `claim_stripe_event`, `finish_stripe_event`, `link_billing_customer`, `sync_subscription`, `check_rate_limit`.

Migration `20261110001700` (Stripe guards):
- `claim_stripe_event_state` returns `claimed` | `done` | `in_flight`. The webhook answers in-flight deliveries with 409 so Stripe retries them (#12).
- `sync_subscription` never replaces a live subscription with a different live one. It returns `conflict_second_live_subscription` and records the conflict once (`subscription_events` kind `second_live_subscription` plus an audit entry, both shown on /admin/system) (#11).
- `begin_checkout` / `finish_checkout` keep a 60-second per-business lock and the last open Checkout session (`billing_accounts.pending_checkout_session`). A new start expires the previous open session (#11).

## Conventions for new tables (Phase 2+)
- `id uuid default gen_random_uuid()`, `organization_id uuid not null references organizations on delete cascade`, `created_at`, `updated_at` + `private.set_updated_at` trigger.
- Money as `bigint` cents with a `currency char(3)`; quantities as `numeric(14,3)` where fractional units exist.
- Enable RLS; SELECT policy `is_org_member(organization_id) or has_support_access(organization_id)` narrowed by the relevant `has_permission`; write policies check permission **and** `org_is_writable`.
- Location-scoped tables check `member_locations` when the member has restrictions, via `private.can_access_location(org, location)` in the read policy **and** a BEFORE INSERT/UPDATE trigger (`private.enforce_location_scope`) so every write RPC is covered. Applied to `sales_days`, `sales_day_categories`, `bills`, `bill_lines`, `bill_payments`, `bill_payment_voids` (migration `20261110001100`). Org-wide rows (`location_id is null`) are hidden from restricted members. New location-scoped tables must reuse the helper and add the trigger.
- Revoke defaults, grant only needed columns; add the table to the audit trigger if it is configuration.
- Ledger tables are insert-only (no UPDATE/DELETE grants; corrections via reversing entries).
- Add RLS tests to `tests/db` before merging.

## Migrations and recovery
- Create migrations with a timestamp prefix; never edit a migration that has run in production — add a new one.
- Destructive migrations (drop/rename column, delete data) need owner approval and a written rollback.
- Supabase Pro plan: daily backups + point-in-time recovery (enable PITR before launch). Restore drill each quarter, documented in PROJECT_STATUS.md.
