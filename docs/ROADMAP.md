# Roadmap

Each phase ships as a series of reviewed PRs (never one giant change). Every phase follows: requirements → migrations → backend → screens → tests → PR → preview review (Grok, owner) → fixes → PROJECT_STATUS update.

## Phase 1 — SaaS foundation ✅ code complete (awaiting credentials for live verification)
Multi-tenant schema with RLS, roles & permissions, auth flows, organizations/locations/team/invitations, Stripe subscriptions with 7-day card-required trial, webhooks, portal, cancel/resume/reactivate, retention-safe cancellation and export, audit log, marketing site with real-component demo, help center, legal drafts, lead capture, super-admin basics with MFA, CI.

**Phase 1 follow-ups (small):** transactional email provider for invites and receipts; error monitoring (Sentry) wiring; e2e Playwright suite against preview; Supabase generated types.

## Phase 2 — Money core: accounting, vendors, bills, imports, dashboard
1. Ledger: chart of accounts templates (retail, wholesale), journal entries, posting engine (atomic, idempotency keys, reversing entries), periods and close, trial balance.
2. Vendors (aliases, merge, terms, credit, spend), bills (recurring, scheduled, partial payments, approvals), payments, AP aging, price-history and increase flags.
3. Import pipeline + job queue: CSV/XLSX first (including Vela POS daily and category reports — the owner’s current POS), then PDF/photo OCR with AI extraction, preview, duplicate detection, confirmation.
4. Bank statement import + reconciliation with vendor alias matching.
5. Financial statements (P&L, balance sheet, cash flow; cash & accrual), sales tax tracking.
6. Dashboard v1 with real data: the §6 KPI set, comparisons, projections, multi-location consolidation, drill-down, exports; widget layout persistence (drag-and-drop).
7. Business calendar (bills, payroll dates, deliveries, events).

## Phase 3 — Retail operations
Catalog and inventory (variants, UPC/SKU, receiving, transfers, counts, adjustments, cost layers, low/aged stock, pricing formulas and rounding, label templates and printing), POS module (or certified integrations) with drawer reconciliation, employees, schedules, time clock and breaks, timesheets, payroll calculation and provider integration, tasks with photo evidence and approval, discipline records. NVR clip association designed as an optional separate service.

## Phase 4 — Wholesale
Catalog with case packs and quantity rules (shared `validateQuantity` already built), warehouses and allocation, customers with tiers/negotiated prices/credit, sales rep portal and commissions, customizable ordering portal, quotes and approvals, POs, pick/pack/ship, backorders, invoicing (PDF/CSV/email), payments, returns and credits, valuation, forecasting.

## Phase 5 — Intelligence and scale
Ask RetailNexa (permission-scoped, cited answers), forecasting and reorder suggestions, automation rules, usage metering and cost-per-customer contribution margin in the admin portal, support ticketing and chat, status page, performance testing at thousands of tenants, enterprise features (SSO, advanced roles). **Grok reviewer controller** added here per owner direction.
