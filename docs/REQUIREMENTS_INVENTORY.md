# Requirements inventory

Every requirement in the master brief, with where it stands **in this codebase**, and whether an existing prototype already explores it (useful for porting behaviour, copy and design — not code, since the prototypes are single-file browser apps with no backend).

**Status key** — ✅ Done (built and tested in this repo) · 🟡 Partial · ⏳ Planned (phase) · 🔑 Blocked on owner credentials/decision

**Existing prototypes examined (left unmodified, per owner direction):**
- **A — “RetailNexa Online Reporting”** artifact: full clickable prototype (public site, retail owner, wholesale owner, salesperson, employee, kiosk, HQ admin). All data in one localStorage blob; no auth, no backend, Stripe/email simulated.
- **B — “RetailOS Preview”** artifact: role-switching preview (Owner/Manager/Employee) with a 35-key permission matrix and an append-only activity log; in-memory only.
- **C — “RetailNexa”** artifact (the owner’s day-to-day app, ~5,800 lines): the most complete prototype. Overview, Bills (due calendar + budget/forecast, invoice archive with AI reading, vendors with terms/aging/payments/credits/merge, fixed costs, statements, bank reconciliation, rep visits, inter-store balances), Sales (daily reports up to 8 registers, over/short, monthly + year-over-year, categories, cash, profit with partner splits, investor PDF, year-end Excel), Staff (schedules, payroll, labor %, paystub PDFs), Upkeep, an “Ask” chat over local data, undo, backups, 8 themes. Persists in the Claude artifact document store; roles are stubbed (everyone is owner).

None of the prototype features count as “implemented” for the SaaS: they have no server, no tenant isolation and no real auth. They are specifications we port from.

## §1 Collaboration & repo
| Requirement | Status | Notes |
|---|---|---|
| CLAUDE.md + docs set (PRD, architecture, schema, agent roles, API, security, status, roadmap, test plan) | ✅ | Plus SETUP.md and this inventory |
| GitHub issues/branches/PRs as source of truth | 🔑 | Committed locally on `feat/phase-1-foundation`; needs repo access |
| CI | ✅ | `.github/workflows/ci.yml` (runs once the repo exists) |
| Grok reviewer integration via GitHub + xAI controller | ⏳ Phase 5 | Designed in AGENT_ROLES.md; deferred per owner |
| No secrets committed; no unrestricted AI production actions; owner approval for prod money/auth/destructive changes | ✅ | SECURITY_RULES.md §14, `.gitignore`, `.env.example` |

## §2 Platform architecture
| Requirement | Status | Notes |
|---|---|---|
| Marketing site, retail app, wholesale app, super-admin | ✅ shell / ⏳ modules | One Next.js app; retail & wholesale are modules gated by entitlements |
| Shared accounting/reporting/auth/billing/inventory/permissions foundation | 🟡 | Auth, billing, permissions done; accounting/inventory Phase 2–3 |
| Subscribe to retail, wholesale or both | ✅ | Checkout line items + entitlements |
| Multiple locations & warehouses | ✅ | `locations` (store/warehouse/office), plan store limit enforced in DB |
| Complete tenant isolation, RLS, audit, session security, role permissions | ✅ | 51 DB security tests incl. schema-wide guards; independent review found no cross-tenant path |

## §3 Public website
| Requirement | Status | Prototype |
|---|---|---|
| Home, features, retail, wholesale, accounting, pricing, request demo, login, signup, help center, contact, legal | ✅ | A had landing, pricing calculator, FAQ — copy and prices reused |
| Interactive demo using real components + fictional data | ✅ | Shared KPI tile, trend chart, data table, profit and quantity logic; data isolated in `src/demo` (lint-enforced) |
| Dashboards, graphs, vendor profiles, invoices, inventory, order builder in demo | ✅ | |
| Demo requests → lead management in super-admin | ✅ | Rate-limited, honeypot; `/admin/leads` |
| Desktop/tablet/mobile | ✅ | Checked at 1366px and 390px |
| Legal text | 🔑 | Drafts; attorney review required |

## §4 Subscriptions & trials
| Requirement | Status | Notes |
|---|---|---|
| Card required before 7-day trial; $0 at signup; charge at day 7 | ✅ | Checkout `payment_method_collection: always`, `trial_period_days: 7`, disclosure on pricing, billing and Stripe page |
| Statuses trialing/active/past_due/canceled/suspended/unpaid/reactivated | ✅ | Stripe mirror + `subscription_events` (reactivated recorded) + org suspension |
| Self-cancel without destroying records; retention; export; reactivation | ✅ | Cancel at period end, resume, read-only after end, JSON export, reactivate (no second trial) |
| Webhooks, failed-payment recovery, invoice history, self-service payment method | ✅ | Idempotent webhooks, 7-day grace from first failure, Stripe portal, invoice list; Stripe Smart Retries configured in dashboard |
| One trial per customer | ✅ | Per owner across their businesses; card-fingerprint check is a follow-up |
| Live Stripe verification | 🔑 | Needs test keys + prices |
| Prototype’s “HQ approves request before trial” flow | — | Not adopted: brief specifies self-serve trials. Owner to confirm |

## §5 Onboarding
| Requirement | Status | Prototype |
|---|---|---|
| Wizard: company, business type, locations | ✅ | |
| Employees | ✅ (invites) | |
| Accounting preferences, products, vendors, customers, sales history, bank statements | ⏳ Phase 2–4 | A: invoice/statement scanning simulated |
| CSV/XLSX/PDF/photo import with OCR/AI, validation, preview, dedupe, reconciliation, confirmation | ⏳ Phase 2 | Job-queue decision in ARCHITECTURE.md |
| Imported history feeds reports | ⏳ Phase 2 | |
| Tutorials, checklists, searchable help center | 🟡 | Setup checklist + searchable help ✅; tutorials later |

## §6 Financial dashboard
| Requirement | Status | Prototype |
|---|---|---|
| KPI set (today/yesterday/MTD/last year/same weekday/projection/transactions/avg ticket/COGS/GP/margin/payroll/opex/operating profit/net income/bills/vendor balances/inventory value/cash/receivables) | 🟡 | Calculation library done and tested (`finance/metrics.ts`); real-data dashboard Phase 2. A/B: dashboards with hard-coded ratios (48% GP, 52% COGS, 18% labor) — **not** reused |
| Gross vs operating vs net separated; net income only when complete | ✅ (logic) | Enforced by `computeProfit().netIncomeComplete` |
| Date ranges, comparisons, drill-down, exports, multi-location consolidation, drag-and-drop widgets | ⏳ Phase 2 | B: 10 customizable widgets (layout idea to port) |

## §7 Bookkeeping
| Requirement | Status |
|---|---|
| Chart of accounts, GL, journals, trial balance, P&L, balance sheet, cash flow, AP, AR, bank rec, cash & accrual, sales tax, refunds/credit memos, partial payments, period close, accountant permissions, historical imports, audit | ⏳ Phase 2 (accountant role + audit log ✅ now) |
| Transaction-safe, idempotent, reversible postings; no duplicate posting; statements reconcile; purchases ≠ payments ≠ COGS | ⏳ Phase 2 (rules written: SECURITY_RULES §15, DATABASE_SCHEMA conventions) |

## §8 Vendors & bills
| Requirement | Status | Prototype |
|---|---|---|
| Vendor profiles (names, aliases, contact, terms, credit, history, balances, YTD/all-time, cost history), merging | ⏳ Phase 2 | C: vendors with terms, aging, payments, credits, merge, learned statement-name aliases; fuzzy name match (stop-words + edit distance, 0.82 threshold — too loose, needs confirmation step). A: 12-stat profiles |
| Invoice import, recurring/scheduled bills, partial payments, reminders, matching, price-increase flags | ⏳ Phase 2 | C: AI document reading with a second verification pass and a 10-type “smart upload” router; ~12 extraction prompts (invoice, statement, Z-report, register cash/drops, monthly, days, category, bill calendar, fixed costs, bank, payroll, P&L, store transfers) to port. Due-date rule: printed due date → printed terms → vendor terms. A: checks stay open until cleared |
| Bank reconciliation matching | ⏳ Phase 2 | C: checks/withdrawals ↔ recorded payments; card deposits ↔ 1–3 days of card sales (ratio 0.93–1.005), which also yields the card-fee %. Port with review, not auto-post |
| Interactive business calendar | ⏳ Phase 2–3 | A: bills calendar |

## §9 Retail module
| Requirement | Status | Prototype |
|---|---|---|
| Inventory (catalog, variants, barcodes, imports, receiving, transfers, adjustments, counts, low/aged stock, cost history, pricing formulas, rounding, labels, printers, per-location) | ⏳ Phase 3 | Owner’s separate tools (invoice scanner, barcode sheet, wig count) inform this |
| POS (scan, search, shortcuts, payments, discounts, returns, drawer reconciliation, receipts, permissions, reporting) + external POS CSV import | ⏳ Phase 3 (Vela POS CSV import Phase 2) | C: daily reports for up to 8 registers, over/short, advances/payouts — but **no Vela-specific parser** (generic AI or column guessing); a real Vela mapping must be built from actual Vela exports. A: drawer counts by denomination; B: cash-under-18% flag |
| Employees, schedules, time clock, breaks, timesheets, payroll calc, advances, bonuses, provider integration, self-service | ⏳ Phase 3 | C: schedules, payroll with overtime/lunch rules, labor %, paystub PDFs with FICA wage bases, cash/check/ACH pay methods — income-tax withholding is a flat % (compliance risk: use a payroll provider or real tax tables). A: PIN kiosk (PINs were plaintext — must be hashed); B: payroll grid locked after approval |
| Tasks with photo evidence, approval, resubmission, history; discipline records | ⏳ Phase 3 | A: task rotation skipping people on leave |
| Optional NVR clip association via dedicated service | ⏳ Phase 3 design | |

## §10 Wholesale ERP
| Requirement | Status | Prototype |
|---|---|---|
| Catalog: case packs, MOQ, increments (default 6; 6/12/24/48), server validation | 🟡 | Rule engine done + tested (`wholesale/quantity.ts`), used in demo; catalog tables Phase 4. A: piece/pack/case/pallet units |
| Landed/historical cost, warehouses, availability, special pricing, image lookup | ⏳ Phase 4 | A: 5 price tiers, customer specials, photo approval |
| Customers (addresses, terms, credit, statements, history, rep, tiers, negotiated prices, ordering accounts) | ⏳ Phase 4 | |
| Sales reps & commissions (sales/profit/flat/tiered) | ⏳ Phase 4 (`sales_rep` role ✅) | A: commission lifecycle |
| Customizable drag-and-drop ordering portal, favorites, reorders, saved carts, templates, quotes, approvals | ⏳ Phase 4 | Demo order builder shows the interaction model |
| Operations: POs, receiving, transfers, allocation, pick/pack, backorders, partial shipments, invoicing (PDF/CSV/email with UPC+SKU), payments, returns/credits, valuation, forecasting | ⏳ Phase 4 | A: invoices as PDF/print/CSV, returns & damage claims |

## §11 Super-admin
| Requirement | Status |
|---|---|
| Isolated, staff-only, MFA | ✅ (MFA enforced in app and DB; authenticator required before access is granted) |
| Manage customers, suspend/reactivate, review trials, billing history (Stripe link + events), password resets, MRR, audit logs, entitlements, announcements, support access with authorization + auditing | ✅ |
| Cancel subscriptions / manage plans on a customer’s behalf | 🟡 Done in Stripe dashboard (owner approval rule); in-app action later |
| Tenant usage, infrastructure cost, cost per customer, contribution margin | ⏳ Phase 5 |
| Manage onboarding/imports for customers | ⏳ Phase 2 |
| Support tickets & chat | ⏳ Phase 5 (A had a ticket list) |
| Errors & job failures, availability | 🟡 Billing-event failures + config health ✅; error monitoring & uptime Phase 1 follow-up |

## §12 AI
| Requirement | Status |
|---|---|
| Ask RetailNexa with permission scoping, citations, verified-vs-estimate labelling, no autonomous financial changes | ⏳ Phase 5 (`ai.ask` permission + rules ✅; B prototyped role-limited answers) |

## §13 Engineering
| Requirement | Status |
|---|---|
| Modular architecture, strict TS, input validation, server-side permission enforcement, tenant isolation | ✅ |
| Idempotent financial operations | ✅ billing / ⏳ ledger |
| Secret management, migrations | ✅ |
| Backup & recovery procedures | 🟡 Documented (PITR on Supabase Pro); restore drill after project exists |
| Unit + integration tests | ✅ 91 tests (unit + DB security + API contract) |
| End-to-end and performance tests | ⏳ need live services |
| Audit trails, rate limiting | ✅ |
| Error logging/monitoring | 🟡 server logs; Sentry follow-up |
| Background job retries | 🟡 webhook retry ledger + reconcile cron; job queue Phase 2 |
| Accessible, mobile-responsive UI | ✅ (keyboard-navigable chart, labelled forms, reduced motion, AA text colours) |
| No placeholder buttons / fake data / hard-coded financials in production | ✅ (unshipped modules are not in the app menu; marketing marks them “In development”) |

## Notes from the prototypes

**Migrating the owner’s existing data (Phase 2).** Prototype C stores its records in the Claude artifact document store under collections for bills, fixed costs, statements, sales (by date), months and profits (by `YYYY-MM`), categories, employees, pay runs, schedule weeks, vendors (`v_<slug>`), bank lines, maintenance, cash weeks, profits, store transfers and distributions, plus uploaded files. A one-time importer (export from the artifact → JSON → RetailNexa import job) is planned so the owner’s history populates the new dashboards. Field-level mapping is kept in the working notes from the inventory, not in this repo, because they contain real partner names.

**Accounting problems in prototype C that the new ledger must not repeat:**
- Its “net profit” is cash in minus purchases: gross sales including tax, minus every bill and inventory order due that month, minus payroll. Inventory purchases are fully expensed and there is no cost of goods sold. RetailNexa separates purchases (inventory asset), COGS (recognised on sale) and payments (cash), and labels net income only when complete.
- Costs land in the wrong month: bills count by due-date month, credits by invoice month, and bills with no due date never count. The ledger uses accrual dates with cash-basis reports derived from payments.
- Points/discounts may be subtracted twice. Bank backfill can count spending twice and treats owner draws and sales-tax payments as expenses — these are equity and liability movements.
- Editing a fixed cost rewrites past months. Recurring bills will generate dated entries; history is immutable.
- Partner payouts are overstated (unrecorded months assumed fully paid). Distributions become explicit equity entries.
- Payroll mixes gross pay and employer cost between pages.
- Defaults to avoid hard-coding per tenant: $50,000 bank reserve, 12% labor target, 10% employer tax, 2 registers, 40h × 1.5 overtime — these become tenant settings.
- UI bug: the “Add vendor” button opens the add-invoice form (duplicate action key).

**Other prototype issues not to repeat:** client-only roles (A, B) and stubbed roles (C); plaintext employee PINs; check numbers assumed globally unique; fixed profit ratios; real partner names and ownership percentages built into code as defaults (C) or demo data (B) — never ship personal data as product defaults.
