# Project status

_Last updated: 2026-11-10 — Phase 1 merged and migrations live on Supabase. Phase 2 in progress on stacked feature branches (PR #3 ledger, then vendors/bills)._

## Phase 2 — in progress
- **2.1 Ledger core** (branch `feat/phase-2-ledger`, PR open): chart of accounts seeded per business, immutable double-entry journal, idempotent posting, single reversal, period close, trial balance, posting rules that fix the prototype’s accounting errors. 65 DB tests + 49 unit tests pass locally. Accounting screens (chart of accounts, journal, trial balance) added. Not yet applied to the live database (needs merge approval).
- **2.2 Vendors and bills / accounts payable** (branch `feat/phase-2-vendors-bills`, stacked on 2.1): vendors (with payment terms), bills as draft → approved → paid/void, duplicate invoice-number guard per vendor, approval posts Dr expense/inventory / Cr AP, partial and full payments from bank or cash post Dr AP / Cr bank|cash, idempotent payment retries, voiding an approved bill posts a reversal, bill entries can’t be reversed behind the bill’s back. Screens: Vendors, Bills (to pay / paid / void, unpaid and overdue totals), Enter a bill, Bill detail with approve / pay / void. Role split: managers enter, accountants approve, owners/admins pay. 22 DB tests + 13 unit tests. **Verified:** DB tests, typecheck, lint, production build. **Not verified:** the screens in a browser against a live Supabase (no preview deployment yet).

- **2.3 Daily sales and imports** (branch `feat/phase-2-sales-import`, stacked on 2.2): one record per store + register + day (Z-report). Recording posts revenue excluding tax, sales tax as a liability, discounts, and cash / card-in-transit / store credit, and refuses days whose payments don’t equal sales − discounts + tax. A register-day can be recorded once; to correct it, void it (posts a reversal on the same date) and record it again. Optional category breakdown stored for reports. Screens: Sales (by day, with void), Add sales (CSV import with column matching, preview and per-row errors, plus a manual form). CSV parser handles quotes, BOM, tab/semicolon files; amounts like “(12.00)” and dates like 11/06/26. 13 DB tests + 18 unit tests. **Not verified:** the Vela POS column names are a best guess — needs one real Vela daily-sales CSV export to confirm the automatic matching (the user can still match columns by hand). Screens not yet tried in a browser.

- **2.4 Overview dashboard** (branch `feat/phase-2-dashboard`, stacked on 2.3): sales tiles (today, yesterday, last 7 days vs prior week, month to date vs the same weekdays last year), 14-day net-sales bar chart with hover values, missing-day markers and a table view; bills to pay / overdue; month gross and operating profit from the ledger (`account_activity` RPC, accounting/profit roles only), flagged “cost of goods not tracked yet” until inventory lands. Each block appears only for roles with the matching permission. 3 DB + 6 unit tests; chart rendered and checked in headless Chrome with sample data. **Not verified:** with real data against live Supabase.

- **2.5 Financial statements** (branch `feat/phase-2-statements`, stacked on 2.4): Profit & loss for this month / last month / quarter / year to date / last year / custom dates (revenue net of discounts, COGS, gross profit, operating expenses, operating profit, other income and expenses, net income) and Balance sheet as of any date (net income to date shown in equity; the page flags any imbalance). Accrual basis. Warns when COGS is $0 because inventory isn’t tracked yet. New `account_activity_detail` RPC. DB test proves the balance sheet balances and P&L net income equals equity growth on real postings (sales, bill, payment). **Not yet:** cash-basis view, cash-flow statement, sales tax report.

- **2.6 Deposits & payments** (branch `feat/phase-2-money-movements`, stacked on 2.5): guided entries with fixed posting rules — card processor deposit (bank gets gross − fees, fees expensed, card clearing settled), cash taken to the bank, sales tax paid to the state (reduces the liability), owner draw (equity, never an expense), owner contribution. Store managers/employees with `cash.create` can record cash deposits only; everything else needs `accounting.post`. Idempotent per form submission. 8 DB tests. **Not verified:** screen in a browser.

- **2.7 Reports: bills aging and sales tax** (branch `feat/phase-2-reports`, stacked on 2.6): Bills aging (approved unpaid bills by vendor in not-yet-due / 1–30 / 31–60 / 61–90 / 90+ day buckets, any as-of date) and Sales tax (owed at start + collected − paid = owed at end, period presets or custom dates; warns when payments exceed collections; states that it doesn't file returns). New `sales_tax_summary` RPC. 1 DB + 10 unit tests. **Not verified:** screens in a browser.

## Phase 1 — what exists and how it was verified

| Area | Built | Verified how | Not yet verified |
|---|---|---|---|
| Database: tenancy, roles, permissions, invitations, locations, audit, platform admin, support grants, leads, announcements, billing mirror, rate limiting, billing-state + plan-limit enforcement | ✅ 3 migrations | 51 DB tests on Postgres 16 with a Supabase emulation layer, incl. schema-wide guards, column-grant and API-contract checks; mutation-checked | On a real Supabase project (`supabase db push`) |
| Data access layer, proxy session refresh, org switching | ✅ | Typecheck; API-contract test confirms every query/RPC matches the schema | Against real Supabase Auth |
| Auth: sign up, email confirm, log in, reset password, sign out, invitation accept | ✅ | Typecheck, contract test, build; DB rules tested | Live flow (needs Supabase project) |
| Stripe: checkout w/ one-per-owner 7-day trial, return sync, webhooks, portal, cancel/resume, reactivation, invoices list, reconcile cron | ✅ | Unit tests of webhook logic (idempotency, re-fetch, tenant-mapping attacks, retries), plan/line-item tests, DB sync-ordering tests; webhook route rejects unsigned/unconfigured requests (smoke-tested) | Real Stripe test-mode run (needs keys + prices) |
| Access states (trial, grace, read-only, suspended, closed) and banners | ✅ | Unit tests | In live app |
| Tenant app pages: overview, billing, profile, locations, team (+ per-person permissions), support access, audit, export | ✅ | Build, typecheck, lint | Rendered with real data (requires login) |
| Super-admin: MFA, overview/MRR, customers, suspend/reactivate/close, entitlements, password reset, leads, announcements, audit, system health | ✅ | Build; DB tests for MFA gating, role limits, audit | Rendered with real data |
| Marketing: home, features, retail/wholesale/accounting, pricing calculator, interactive demo, request demo, contact, help center (search), legal | ✅ | Smoke test (all 200), screenshots at 1366px and 390px with interactions, no console errors | Lighthouse audit |
| CI (lint, typecheck, unit, DB, build) | ✅ workflow file | Each step run locally | On GitHub Actions (repo not connected) |

## Independent security review (2026-11-09)
A separate reviewer audited migrations, auth, billing, webhooks, admin and route handlers without seeing the author’s reasoning. **No cross-tenant read/write path was found.** Findings and resolution:

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Open redirect: `?next=/.//evil.com` normalised to `//evil.com` after login | High | Fixed; regression tests |
| 2 | Billing state and plan store limit enforced only in the app; direct API calls could write while unpaid | Med-High | Fixed: `org_is_writable` checks subscription + 7-day grace; store-limit trigger; tests |
| 3 | `member_locations` writable without rank checks | Medium | Fixed: RPC-only `set_member_locations` with rank checks |
| 4 | Permission overrides survived demotion / re-activation | Medium | Fixed: cleared on role change, disable, rejoin |
| 5 | Orgs could never be deleted (audit FK vs append-only) | Medium | Fixed: audit log keeps plain org id; deletion tested |
| 6 | Past-due grace measured from the (advanced) period end ≈ 37 days | Medium | Fixed: `past_due_since` anchor in DB and app |
| 7 | Repeat free trials via multiple businesses; org-cap race | Low-Med | Fixed: one trial per owner; advisory lock. Card-fingerprint check = follow-up |
| 8 | No per-client auth rate limits (Supabase sees one server IP) | Medium | Fixed: per-IP and per-email limits on sign-in/up/reset |
| 9 | Lead limiter trusted spoofable X-Forwarded-For | Low | Fixed: platform headers only |
| 10 | Platform MFA trust-on-first-use | Low | Fixed: authenticator must exist before access can be granted |
| 11 | Hardening: default table grants, billing admin reopening closed orgs, Stripe ids visible to members, stale profile emails | Low | Fixed + tests. Remaining: nonce-based CSP (`'unsafe-inline'`) — follow-up |

## Blocked on the owner (exact requirements)
1. **GitHub** — connect GitHub to Claude and provide `owner/repo` (or a repo name to create). Code is committed locally on `feat/phase-1-foundation`.
2. **Supabase project** — URL, anon key, service-role key (into Vercel env, not chat); auth settings per SETUP.md §2.
3. **Stripe** — test secret key, webhook signing secret, three Price IDs; confirm prices ($129.99 retail, +$99.99 per extra store, $149.99 wholesale — carried over from the prototype).
4. **Vercel** — import repo, set env vars, `CRON_SECRET`, domain.
5. **First platform admin** — SQL insert after signing up (SETUP.md §2.8).
6. **Legal review** of terms, privacy and subscription terms drafts.
7. **Product decision:** the prototype required HQ approval before a trial started; the master brief asks for self-serve card-required trials. Phase 1 implements the master brief (self-serve). Demo *requests* still go to the leads inbox.

## Known gaps carried into the next steps
- No transactional email provider yet: invitations are shared as a copy-paste link. (Supabase sends auth emails itself.)
- Error monitoring (Sentry or similar) not wired.
- No browser end-to-end suite yet (needs live services).
- Supabase TypeScript types not generated (queries are checked by the contract test instead).
- CSP still allows inline scripts (nonce-based CSP planned); card-fingerprint trial check planned.
- Business modules (sales, bills, inventory, accounting, wholesale) are Phase 2–4; the marketing site marks them “In development”.
- Usage metering / cost-per-customer for the admin portal is Phase 5.

## Decisions log
- 2026-11-09 — Next.js 16 Cache Components disabled for tenant safety (ARCHITECTURE.md).
- 2026-11-09 — Platform staff cannot read tenant business records without a tenant-granted, ≤72h support grant.
- 2026-11-09 — Cancellation never deletes data; accounts are flagged for owner-approved retention review 12 months after the subscription ends.
- 2026-11-09 — Existing RetailNexa artifacts left untouched; Grok integration deferred to the end (owner direction).
- 2026-11-09 — Security-review fixes folded into the original migrations (none had been applied to any environment yet).
