# Product requirements

Condensed from the owner’s master instructions (Nov 2026). Section numbers (§) refer to that brief. Status per requirement is tracked in REQUIREMENTS_INVENTORY.md.

## Product
RetailNexa is a multi-tenant SaaS for independent retail stores and wholesale distributors: daily sales and reporting, vendor bills, inventory, staff, wholesale ordering, and a double-entry bookkeeping core underneath. Customers subscribe to Retail, Wholesale or both. One business can run many stores and warehouses. Thousands of businesses share the platform, fully isolated from each other.

## Users
- **Owner** — runs the business, pays, sees everything.
- **Manager / employee** — run the floor; see only what their role allows.
- **Accountant** — books, bills, bank, payroll figures, exports.
- **Sales rep** — wholesale ordering for their customers, own commissions.
- **Wholesale customer** — orders through a branded portal (Phase 4).
- **Platform staff** — support, billing and administration of all tenants.

## Principles
1. Numbers must be right: gross profit, operating profit and net income are distinct; inventory purchases ≠ COGS ≠ bank payments; nothing is labelled net income unless every expense is accounted for (§6, §7).
2. Tenant data never leaks; least privilege by role (§2).
3. Cancelling never destroys records; customers can always export (§4).
4. No fake data, placeholder buttons or hard-coded financials in production features; fictional data only in the isolated demo and tests (§13).
5. AI reads with the user’s permissions, cites records, labels estimates, never changes money on its own (§12).

## Acceptance criteria by area (abbreviated)
- **Subscriptions (§4):** card required before a 7-day trial; $0 at signup; first charge at trial end; statuses trialing/active/past_due/canceled/unpaid/suspended/reactivated represented; self-service cancel, payment method, invoices; failed-payment recovery; one trial per business.
- **Onboarding (§5):** guided wizard; imports (CSV, XLSX, PDF, photos) with OCR/AI extraction, preview, duplicate detection, user confirmation; imported history feeds reports.
- **Dashboard (§6):** the listed KPIs, date ranges, same-weekday and year-over-year comparisons, projections, drill-down, exports, multi-location consolidation; drag-and-drop widgets.
- **Bookkeeping (§7):** chart of accounts, GL, journals, trial balance, P&L, balance sheet, cash flow, AP/AR, bank reconciliation, cash & accrual, sales tax, credit memos, partial payments, period close, accountant role, imports, audit; postings atomic, idempotent, reversible by entries only; statements reconcile.
- **Vendors & bills (§8):** profiles with aliases, terms, credit limits, histories, YTD/all-time spend, cost history; merging without losing history; invoice import; recurring/scheduled bills; partial payments; reminders; matching; price-increase flags; business calendar.
- **Retail (§9):** catalog with variants/UPC/SKU, barcode scan and print, receiving, transfers, adjustments, counts, low stock, aged stock, cost history, pricing formulas and rounding, label templates, per-location stock; POS (scan, search, shortcuts, payments, discounts, returns, drawer reconciliation, receipts, permissions) and POS CSV import (e.g. Vela POS); employees, schedules, time clock, breaks, timesheets, payroll calc and provider integration, advances, bonuses, self-service; tasks with photo evidence and approval; discipline records; optional NVR clip association via a dedicated service.
- **Wholesale (§10):** catalog with case packs/MOQ/increments (default 6; 6/12/24/48 configurable; server-validated), landed/historical cost, multi-warehouse availability, special pricing, image lookup via authorized services; customers with addresses, terms, credit limits, statements, tiers, negotiated prices; sales reps with commissions (percent of sales/profit, flat, tiered); customizable drag-and-drop ordering portal with favorites, reorders, saved carts, templates, quotes, approvals; POs, receiving, transfers, allocation, pick/pack, backorders, partial shipments, invoicing (PDF/CSV/email with UPC+SKU), payments, returns/credits, valuation, forecasting.
- **Super-admin (§11):** customers, suspend/reactivate, cancel, trials, plans, billing history, password resets, MRR, usage, infrastructure cost and contribution margin per customer, onboarding/imports, support tickets and chat, errors and job failures, availability, audit, entitlements, announcements, audited support access.
- **AI (§12):** Ask RetailNexa over the tenant’s own data with citations and permission scoping.
- **Engineering (§13):** modular, typed, validated, server-side permission enforcement, idempotent money operations, migrations, backups, unit/integration/e2e/performance tests, audit, monitoring, job retries, rate limiting, accessible and responsive UI.
