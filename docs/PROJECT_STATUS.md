# Project status

_Last updated: 2026-11-09 — Phase 1 code complete on branch `feat/phase-1-foundation`; awaiting accounts/credentials for live verification._

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
