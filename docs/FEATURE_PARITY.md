# Feature parity: the owner's live app → RetailNexa

**Source of truth:** the owner's list from a read-only walkthrough of the live app, posted by the PM in #79 (comment 6774289287, Nov 10, 2026). It replaces the earlier list built from the older RetailOS spec. Issues #81–#92 came from that older list and are closed as superseded (#97).

**Update this file in every parity PR.** For each row the PR completes, change Status and Evidence so the Auditor can check them against the code.

**Status:**
- **Present** = done.
- **Partial** = some of it exists.
- **Missing** = not built.

Checked against `main` @ `8fcde6e` plus the QA batch 7 PR.

## Excluded by the owner (don't build)
- **Cash & safe tracking:** weekly cash summary, payouts, into/out of safe, weekly note, and the cash tiles.
- **The Ask-a-question AI box.**
- **AI/OCR reading of invoices and screenshots** stays off until the owner approves, because it costs money.

## Owner decisions pending (the PM takes these to the owner)
- **P1:** Retail price, $129.99 now vs $149.99 in the old app.
- **P3:** trial, 7 days now vs 30 days / up to 2 stores with a card at first sign-in after approval.
- **#15 follow-up:** a business on a billing waiver isn't store-capped. After it subscribes, stores above its plan stay active and the Locations page warns. Nothing is switched off automatically.

## The owner's 16 items, in build order

| # | Feature | Status | Evidence / what's missing | Tracking |
|---|---|---|---|---|
| 1 | Bills due calendar + budget: month view due calendar, monthly bills budget, Orders vs Bills filter, bills this month on Overview | Missing | `src/app/app/bills/page.tsx` is a list (≤200 rows, store column added in QA batch 7). No budget in schema or code. | #101 |
| 2 | Staff: employees, schedule, payroll, paystubs, labor % | Missing | No staff tables or routes. Permission keys exist in `src/lib/auth/permissions.ts`. | #102 |
| 3 | Sales history: monthly roll-up, multi-year, bulk import + add month, date-range lookup, year compare, CSV | Partial | `sales_days` + manual/CSV/Vela import + MTD vs last year + daily chart. `/app/sales` shows ≤120 rows with no date range. No store-card/points columns, no monthly roll-up or export. | #103 |
| 4 | Profit partners: split %, distributions ledger, pay out, profit calculator, investor PDF, bulk import | Missing | No partner tables or routes. | #104 |
| 5 | Invoices: upload to a private bucket, list by month with search, Needs review filter | Missing | No storage buckets in migrations. Bills have account + amount lines only. | #105 |
| 6 | Location balances between stores: owed to me / I owe, month-end check, mark collected, filters | Missing | No inter-store tables. | #106 |
| 7 | Vendors page: search, sorts, next due / payment method / total spend per card, vendor calendar | Partial | `/app/vendors` lists vendors with contact, terms, default account and notes. No search, sorts, per-card totals or calendar. | #107 |
| 8 | Overview: date filters, quick actions, projected profit, spend vs last year, 12-month trend, custom tiles | Partial | `src/lib/dashboard/summary.ts` covers today, yesterday, last 7 days, MTD vs last year, due in 7 days, overdue, gross profit $ and GP % (`app/page.tsx`). Missing everything else listed. | #108 |
| 9 | Bank: check register with checks and withdrawals on the calendar; card sales vs card deposits | Partial | `/app/bank` covers statement import, match, categorize, ignore and undo. No check register or card-deposit check. | #109 |
| 10 | Vendor statements: upload, match invoices, flag missing | Missing | `20261110000500_statements.sql` is account activity, not vendor statements. | #110 |
| 11 | Year-end Excel report | Partial | P&L, balance sheet, cash flow, trial balance and sales tax exist as pages. JSON account export only. No Excel workbook. | #111 |
| 12 | Sales categories: upload a category report, compare with prior month and year | Partial | `sales_day_categories` table and `record_sales_day(p_categories)` exist, but nothing in `src` passes categories yet. | #112 |
| 13 | Fixed-cost helpers: quick add for utilities and insurance, suggested recurring costs | Partial | Recurring bills (`/app/bills/recurring`, daily job) with manual templates only. | #113 |
| 14 | Rep schedule: visit day and frequency per vendor, weekday summary, last invoice date | Missing | — | #114 |
| 15 | Upkeep / maintenance schedule: suggested tasks, add task | Missing | — | #115 |
| 16 | Small items: in-app help, storage overview, themes (4 light, 4 dark) | Partial | `/help` has 9 articles (marketing only) and `/contact`. No in-app help button, storage overview or themes. | #116 |

## Already in RetailNexa (keep; not in the live app)
| Feature | Evidence |
|---|---|
| Double-entry ledger, P&L, balance sheet, cash flow, trial balance, sales tax, period close | `20261110000100_ledger.sql` and later; `/app/accounting/*` |
| Recurring bills with a daily job | `/app/bills/recurring`, `/api/cron/recurring-bills` (#64, #67) |
| Roles, per-member permissions, per-member store access | `/app/settings/team` (#76), `member_locations` + `can_access_location` |
| Audit log | `audit_logs`, `/app/audit` |
| Two-factor authentication | `/account/security`. Enforced at sign-in and in the database for users who turn it on (#96, QA batch 7). |
| Subscription billing, one trial per owner | `/app/billing`, `trial_claims` (#17, #73, #80) |
| HQ admin: customers, MRR, billing waivers, password resets | `/admin`, `/admin/tenants` (`sendPasswordReset` has no automated test yet) |

## Security posture
**Status: Partial.**

What's in place:
- RLS is on for every public table.
- Every SECURITY DEFINER function sets `search_path`.
- Stripe signature check plus idempotency.
- Auth rate limits.
- Admin MFA.
- The service key is server-only (#19).
- Customer 2FA is enforced (#96).

Still open:
- #30: leaked-password protection needs a paid plan.
- #13, #14: repo visibility and branch protection.
- #16: monitoring and backups.

## Plan facts the pricing page must match (#100)
`src/lib/billing/plans.ts` lists only shipped features. Everything else is marked "(coming soon)", and a unit test enforces this.
- **P2:** a wholesale-only subscription can't add store locations. Warehouses and offices aren't capped.
