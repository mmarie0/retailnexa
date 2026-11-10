# Architecture

RetailNexa is one Next.js application deployed on Vercel, backed by one Supabase project (Postgres, Auth, Storage) and Stripe Billing. Four areas share a single codebase, auth system and database:

| Area | Route prefix | Who |
|---|---|---|
| Public marketing site + interactive demo | `/`, `/features`, `/pricing`, `/demo`, `/help`, `/legal/*` | Anyone |
| Tenant application (retail + wholesale share it) | `/app/*` | Members of a business |
| Super-admin portal | `/admin/*` | Platform staff (`platform_admins`), MFA required |
| Machine endpoints | `/api/webhooks/*`, `/api/cron/*` | Stripe, Vercel Cron |

Retail and wholesale are **modules inside one tenant app**, not separate apps. An organization subscribes to `retail`, `wholesale` or both; entitlements decide which modules appear. They share accounting, inventory, permissions, billing and reporting (spec §2).

## Request path

```
Browser ──► src/proxy.ts           refresh Supabase session cookie; optimistic redirect to /login
        ──► Server Component / Server Action / Route Handler
              └─ src/lib/auth/context.ts  (Data Access Layer)
                   • getUser() verified with Supabase Auth (not just the cookie)
                   • active org = cookie value ∩ caller's own memberships
                   • permissions = DB function my_permissions(org)
                   • access state = computeAccess(org status, subscription)
              └─ Supabase client *as the user*  ──► PostgREST ──► Postgres RLS (final authority)
```

Authorization is enforced three times, from cheapest to most authoritative:
1. **UI** hides what the user cannot do (`can(ctx, 'perm')`).
2. **Server actions** re-check permission and access state before writing.
3. **Postgres RLS + SECURITY DEFINER RPCs** enforce tenant isolation and role rules regardless of what the app does. A bug in layers 1–2 cannot leak another tenant's data.

## Tenancy model

- `organizations` is the tenant. Every tenant-owned table carries `organization_id` and has RLS.
- `memberships(organization_id, user_id, role, status)` links users to orgs. One user can belong to many orgs (switcher in the app shell).
- `locations` (store / warehouse / office) belong to an org; `member_locations` can restrict a member to specific locations (enforcement on business tables arrives with those tables in Phase 2–3).
- Roles: owner, admin, manager, accountant, sales_rep, employee, viewer. Defaults live in `role_permissions`; per-member overrides in `member_permission_overrides`. `private.has_permission(org, perm)` is the single check used by every policy.

## Billing model

Stripe is the source of truth. The app never stores card data and never trusts webhook payload bodies:

1. Owner picks products on `/app/billing` → server creates/links a Stripe Customer (idempotency key per org), then a Checkout Session with `payment_method_collection: 'always'` and `trial_period_days: 7` **only if the org has never had a trial** (`organizations.trial_consumed_at`).
2. Stripe redirects to `/app/billing/return`, which verifies the session belongs to the caller's org and syncs immediately.
3. Webhooks (`/api/webhooks/stripe`) are signature-verified, claimed once in `stripe_events` (idempotent, retry-safe), and for every relevant event the **subscription is re-fetched from Stripe** and mirrored via `sync_subscription()` (order-independent; stale syncs ignored).
4. A daily cron re-syncs any subscription not refreshed in 20h (missed-webhook safety net).
5. `computeAccess()` maps org status + subscription status to `full | grace | read_only | billing_only | suspended | closed`. Cancellation → read-only with export; data is never deleted automatically (`retention_review_at` flags accounts for owner-approved review after 12 months).

## Rendering and caching

Next.js 16 ships with Cache Components on by default. It is **turned off** here: every authenticated page reads cookies and renders per request, so tenant data can never land in a shared cache. Marketing pages are static (the demo and homepage revalidate daily because their sample data is date-relative). Revisit only with a per-tenant cache-key design reviewed against SECURITY_RULES.md.

## Background work

Phase 1 has one scheduled job (billing reconcile, Vercel Cron). Phase 2 introduces document imports (CSV/XLSX/PDF/photo OCR), which need durable, retryable jobs. Decision record:

- **Chosen direction:** a Postgres-backed job table (`jobs` with status, attempts, run_after, locked_by, idempotency_key) processed by a Vercel Cron-triggered worker route for short jobs, with **Supabase Edge Functions or a dedicated worker (e.g. Inngest / Trigger.dev)** for long OCR/AI jobs that exceed serverless limits. Final choice is made at the start of Phase 2 after measuring OCR job duration; it requires an account the owner must create.
- Every job is idempotent and tenant-scoped; workers use the service role only for the job's own `organization_id` and write audit entries.

## Integrations status

| Integration | Phase 1 state |
|---|---|
| Supabase Auth (email+password, email confirmation, password reset, TOTP MFA for staff) | Implemented; needs project keys |
| Supabase Postgres | Migrations + RLS implemented and tested locally |
| Stripe Billing (Checkout, Portal, webhooks, cancel/resume, invoices) | Implemented and unit-tested; needs keys + prices |
| Vercel (hosting, cron, preview deploys) | Config committed; needs project link |
| GitHub (issues, PRs, CI) | CI workflow committed; repo not yet connected |
| Transactional email (invites, receipts) | Invite links are copy/paste in Phase 1; email provider (e.g. Resend) planned |
| Grok (xAI) reviewer controller | Designed in AGENT_ROLES.md; built last, per owner direction |
