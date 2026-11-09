# Security rules

These rules are binding for every change, human or AI. A PR that breaks one is not mergeable.

## Tenant isolation
1. Every table holding tenant data has `organization_id`, **RLS enabled**, and policies that call `private.is_org_member()` / `private.has_permission()`. `tests/db` fails if any public table lacks RLS.
2. Supabase grants ALL on new public tables and functions to `anon`/`authenticated` by default. Every migration that adds a table or function must explicitly `revoke` and re-`grant` the minimum. `tests/db` fails if `anon` holds any table privilege or can execute any function.
3. Server code reads tenant data with the **user-scoped** Supabase client (RLS applies). Never accept an `organization_id` from a form, URL or body as authority; use `getOrgContext().org.id`.
4. Privileged multi-row writes go through `SECURITY DEFINER` functions with `set search_path = ''`, that re-check `auth.uid()` and permissions and write the audit log. `tests/db` fails on any SECURITY DEFINER function without a pinned search_path.

## Service role
5. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Allowed uses only: Stripe webhook and billing sync, scheduled jobs, public lead intake (after validation + rate limiting), linking a Stripe customer, and writing audit entries for actions already authorized. It is imported only via `src/lib/supabase/admin.ts` (`server-only`).
6. Never expose secrets to the client. Only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL` may be public.

## Roles and permissions
7. Nobody changes their own role, status or permissions. Non-owners can only invite/assign roles strictly below their own and can only modify members below them. Every org keeps at least one active owner. Owners cannot be invited (only promoted). Permission overrides cannot grant what the granter lacks. All enforced in SQL and tested.
8. Sensitive permissions (profit, payroll, bank, vendor costs, billing changes, audit, exports) are never in employee/manager defaults.

## Platform staff
9. Platform admins need a `platform_admins` row **and** an MFA-verified session (`aal2`), checked in the app and again inside Postgres (`private.is_platform_admin`).
10. Staff can see account metadata (org name, plan, team list) but **not tenant business records** unless the tenant has granted time-limited support access (`support_access_grants`, max 72h, revocable, audited). Future business tables must include `or private.has_support_access(organization_id)` in their SELECT policy rather than `is_platform_admin()`.
11. Creating the first platform admin is a manual SQL step performed by the owner (see SETUP.md). There is no UI to grant platform access.

## Money
12. Card data never touches our servers (Stripe Checkout / Portal only).
13. Webhooks: verify the signature on the raw body; claim the event id before processing; re-fetch objects from Stripe; map customer→org through our own `billing_accounts`, never through metadata alone.
14. Production financial, billing, authentication and destructive database changes require **explicit owner approval** (spec §1). AI agents never run them unattended.
15. Financial postings (Phase 2+) are transaction-safe, idempotent (idempotency key per posting) and reversible only through reversing entries. No UPDATE/DELETE of posted ledger lines.

## Audit
16. `audit_logs` is append-only (trigger blocks UPDATE/DELETE/TRUNCATE even for superuser sessions). Configuration tables are audited by trigger; RPCs add semantic entries.

## Web
17. Security headers (CSP, HSTS, frame-ancestors none, nosniff, referrer policy) are set in `next.config.ts`. Redirect targets from `?next=` pass through `safeNext()`.
18. Public forms validate with zod, include a honeypot, and are rate-limited in Postgres (`check_rate_limit`). Supabase Auth applies its own rate limits to sign-in/sign-up; keep them enabled in the dashboard.
19. Email confirmation must be **enabled** in Supabase Auth (invitation acceptance relies on the verified email in the JWT).

## AI (Phase 5)
20. AI answers run with the asking user's permissions (RLS-scoped reads), cite record ids, label estimates, and never modify financial records without a separate, explicit, authorized user action.
