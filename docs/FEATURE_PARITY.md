# Feature parity: old app (RetailOS) → RetailNexa

Source: the PM's audit of the old app's feature list against `main` @ `7e724a7`, posted in #79 (Nov 10, 2026). Each row maps an old feature to its current state and the tracking issue (label `parity`) that closes the gap.

**Update this file in every parity PR**: change the Status and Evidence columns for the rows the PR completes, so the Auditor can check them against the code.

Status: **Present** = matches the old app · Partial = some of it exists, or it differs from an old business rule (owner decides) · Missing = not built.

Owner decisions pending (Grok takes these to the owner; nothing changes until decided):
- **P1**: Retail price $129.99 (current) vs $149.99 (old app).
- **P3**: 7-day trial (current) vs 30 days / up to 2 stores, card at first sign-in after approval (old app).
- **#15 follow-up**: a business on a billing waiver isn't store-capped; after it subscribes, stores above its plan stay active and the Locations page warns. Nothing is switched off automatically.

| # | Old feature | Status | Evidence / what's missing | Tracking |
|---|---|---|---|---|
| G1 | Undo last change (10 s) | Missing | No undo anywhere; only void/reverse actions | #88 |
| G2 | "Need help?" in top bar | Partial | `/help` (9 articles in `src/content/help.ts`) is marketing-only; no in-app button | #88 |
| G3 | Tabs Overview/Bills/Sales/Staff/Upkeep (mobile) | Partial | `src/app/app/layout.tsx` flat nav; no Staff/Upkeep | #88 |
| G4 | Store switcher + "All stores" combined view | Missing | No switcher; store chosen per form only | #82 |
| G5 | Every list: search, filters, date range, CSV export | Partial | CSV *import* only (sales, bank); `/app/export` is a JSON account export | #82 |
| G6 | i18n en/es/fr/ht/ar(RTL)/ko/zh-Hans | Missing | `layout.tsx` hard-codes `lang="en"`; no catalog | #92 |
| O1 | Overview cards | Partial | `app/page.tsx`, `lib/dashboard/summary.ts`: today, MTD vs LY, due 7d, overdue, GP $. Missing: today vs same weekday LY, GP %, cash on hand, labor %, open maintenance, staff on shift | #87 |
| O2 | Alerts | Partial | Overdue only. Missing: uncleared checks >14d, drawer over/short, low-margin days, missing daily sales entry | #87 |
| O3 | Customize home per user | Missing | — | #87 |
| B1 | Due list; pay cash/card/ACH/check; partial; void | Partial | `bills/[id]`, `recordBillPayment`, `voidBill`, `/bills/aging`. Payment source is only `bank`/`cash_on_hand` + free-text reference | #84 |
| B2 | Vendors (rep, account #, terms incl. COD, history) | Partial | `vendors`: contact, email, phone, terms days, default account, notes. Missing account number, COD label, per-vendor bill/payment history | #84 |
| B3 | Invoice upload PDF/photo, line items (item, UPC, qty, unit cost), dup warning, due from terms | Partial | Dup guard `bills_vendor_number_uidx` ✓, due from terms (`bill-form.tsx`) ✓. `bill_lines` = account + amount only; no upload/storage bucket (Batch A) | #84 |
| B4 | Rep visit schedule | Missing | — | #86 |
| B5 | Fixed costs / recurring bills | **Present** | `recurring_bills` (29–31 → last day), `/api/cron/recurring-bills`, `/app/bills/recurring` | #64, #67, #77 |
| B6 | Vendor statement matching | Missing | (`…000500_statements.sql` is income-statement activity, not vendor statements) | #86 |
| B7 | Bank accounts + check register (not cleared/cleared/void; bill paid on clear; unique check # per store) | Partial | `/app/bank` statement import + match/categorize ✓. No check register, check status, multi-account balances | #84 |
| B8 | Location balances (owed, cash, bank per store + combined) | Missing | — | #86 |
| S1 | Daily sales entry/import | Partial | `sales_days` gross, discounts, tax, cash, card, credit, txns; manual/CSV/Vela; void + re-record. Missing refunds, "other" payments, payouts | #83 |
| S2 | Cash drawer counts by denomination, over/short, payouts w/ reason | Missing | `/app/deposits` is money movements only | #83 |
| S3 | Months & history (monthly, same month LY, best/worst, heat map) | Partial | MTD vs LY + daily chart only | #87 |
| S4 | Profit per month and store | Partial | `/accounting/profit-loss`; COGS manual (#50); no per-store net | #87 |
| S5 | Categories YoY + items below margin % | Partial | `sales_day_categories` stored; no report (needs product costs) | #87 |
| ST1 | Employees (profile, pay, PIN, private docs, status) | Missing | Batch C | #85 |
| ST2 | Leave requests + approval | Missing | Batch C | #85 |
| ST3 | Weekly schedule (drag/drop, copy week, conflicts) | Missing | Batch C | #85 |
| ST4 | Time clock iPad kiosk (PIN, breaks, audited edits) | Missing | Batch C | #85 |
| ST5 | Payroll (display-only or provider) + export | Missing | Batch C; a provider costs money → owner | #85 |
| ST6 | Paystubs PDF (own only, retention) | Missing | — | #85 |
| ST7 | Labor % by day vs target | Missing | — | #85 |
| ST8 | Tasks (rotation, leave reassign, override audit, photo) | Missing | Batch C | #85 |
| U1 | Maintenance log | Missing | — | #88 |
| U2 | Help articles per screen + contact form | Partial | `/help` 9 articles, `/contact` lead form | #88 |
| U3 | Monthly investor report PDF | Missing | — | #89 |
| U4 | Year-end report + accountant export | Partial | P&L, BS, cash flow, trial balance, sales tax ✓; no annual by-store/vendor PDF/export | #89 |
| U5 | File storage (folders, expiry reminders) | Missing | No storage buckets in migrations | #88 |
| U6 | Appearance (theme, accent, logo, language) | Missing | — | #88 |
| SS | Store settings: hours, tax rate, timezone, budget | Partial | Timezone only (`settings`, `settings/locations`) | #88 |
| A1 | Multiple stores, roles & permissions, billing page | **Present** | `/settings/locations`, `/settings/team` (roles, per-member perms + stores), `/app/billing` | — |
| A2 | Access-request status | Missing | No approval flow | #81 |
| R1 | Owner/Manager/Employee + Super Admin | **Present** | `member_role` enum (+admin, accountant, sales_rep, viewer), `platform_admins` | — |
| R2 | Signup pending until HQ approves; HQ sets Retail/Wholesale, customer can't change; switch cancels retail tasks | Missing | `onboarding/actions.ts` lets customer pick `business_type` and creates the org immediately | #81 |
| R3 | Employees never see cash/sales/profit; own data only | Partial | `lib/auth/permissions.ts` + store scoping (#76/#27) ✓; "own data only" needs Staff | #85 |
| R4 | Owner-only login↔staff link; audit log | Partial | `audit_logs` + `/app/audit` ✓; no staff profiles | #85 |
| H1 | HQ: customers, MRR, subscriptions | **Present** | `admin/(portal)/page.tsx` (`lib/billing/revenue.ts`), `/admin/tenants` | — |
| H2 | HQ: comp accounts | **Present** | `setFeatureOverride` (waiver ≤90 d, aal2) | #71 |
| H3 | HQ: password resets | **Present** | `sendPasswordReset` on `tenants/[id]` | — |
| H4 | HQ: export & backup | Partial | Tenant self-export JSON only; backups/PITR = #16 (paid → owner) | #91 |
| H5 | HQ: support tickets | Missing | Only support-access grants + leads | #91 |
| H6 | HQ: bugs & patches | Missing | — | #91 |
| H7 | HQ: costs & P&L | Missing | — | #91 |
| W1 | Excel product import (≤10k rows / 10 MB) | Missing | Batch D | #90 |
| W2 | Phone barcode scan + lookup | Missing | Batch D | #90 |
| W3 | Tier pricing 1–11/12–47/48–99/100–499/500+; packs keep price | Partial | Only `lib/wholesale/quantity.ts` (min/increment rules) | #90 |
| W4 | Per-customer pricing, ordering, customer accounts | Missing | Batch D | #90 |
| W5 | AP/AR + P&L with cost & price history | Partial | AP (bills, aging) + P&L ✓; no AR, no price history (Batch A/B) | #90 |
| P1 | Retail $149.99 + $99.99/extra store | Partial (Differs) | `plans.ts`: 12999 + 9999 → **owner decision** | owner decision |
| P2 | Wholesale $149.99, single store | Partial | 14999 ✓; single-store cap not confirmed in code | #90 |
| P3 | 30-day trial up to 2 stores; card at first sign-in after approval | Partial (Differs) | `TRIAL_DAYS = 7` → **owner decision** | owner decision |
| P4 | One trial per owner; each business billed separately | **Present** | `trial_consumed_at` + `trial_claims` (#17), release rules (#73, #80), merged in #72 | #72 (#17, #73, #80) |
| SEC | RLS everywhere, HQ MFA, Stripe signature + idempotency, DEFINER search_path, rate limits, service key server-only | **Present** (+in flight) | `constructEvent` + `stripe_events`, `/admin/mfa`, Auditor reviews; #19/#23 hardening merged in #72; kiosk PIN limit comes with ST4 | #72 (#19, #23) |

## Tracking issues (highest priority first)
1. #81 Signup approval + HQ-locked account type
2. #82 Store switcher + All stores; search, filters, date range, CSV export on every list
3. #83 Cash drawer + fuller daily sales
4. #84 Bills completeness
5. #85 Staff module
6. #86 Vendor statements, location balances, rep schedule
7. #87 Overview + sales analytics
8. #88 Upkeep + settings
9. #89 Reports
10. #90 Wholesale
11. #91 HQ (includes AI usage & margin)
12. #92 i18n
