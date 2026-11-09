# RetailNexa — instructions for AI developers

Read before changing anything: `docs/SECURITY_RULES.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`. Agent roles and the PR workflow are in `docs/AGENT_ROLES.md`.

## Stack
Next.js 16 (App Router, `src/proxy.ts` instead of middleware, async request APIs, Cache Components **off**), React 19, TypeScript strict, Tailwind v4, Supabase (Postgres + Auth), Stripe Billing, Vitest. This Next.js version differs from older training data — read `node_modules/next/dist/docs/` before using an API you are unsure about (see AGENTS.md).

## Commands
```
npm run dev          # local app (needs .env.local, see .env.example)
npm run lint
npm run typecheck    # regenerates route types first
npm run test:unit
npm run test:db      # needs Postgres at TEST_DATABASE_URL (default postgres://postgres:postgres@localhost:5432)
npm run build        # must succeed with no env vars
```

## Where things live
- `supabase/migrations/` — schema, RLS, RPCs (source of truth). `tests/db/supabase-shim.sql` emulates Supabase roles/auth for tests only.
- `src/lib/auth/context.ts` — the data access layer. Every tenant page/action starts with `getOrgContext()`; admin with `getAdminContext()`.
- `src/lib/auth/permissions.ts` — TS mirror of the permission catalog (kept in sync by a DB test).
- `src/lib/billing/` — plans, access states, webhook logic (pure, tested), Stripe wiring.
- `src/lib/finance/metrics.ts`, `src/lib/wholesale/quantity.ts` — shared domain logic used by the demo now and the real modules later.
- `src/demo/` — fictional demo data. Only marketing pages may import it (lint-enforced).
- `src/content/` — marketing feature status and help articles. Mark a feature `available` only when it ships.

## Non-negotiables
- New tenant table ⇒ RLS + explicit revoke/grant + tests in `tests/db` in the same PR.
- Never take `organization_id` from user input; never use the service-role client to read tenant data for a user.
- Money in integer cents. Ledger rows are insert-only.
- Use `failFrom(e)` in Server Action catch blocks (it rethrows Next.js redirects).
- Don’t claim something works unless a test or a manual check proved it; say what was not verified.
- Production billing/auth/financial/destructive DB changes need explicit owner approval.
