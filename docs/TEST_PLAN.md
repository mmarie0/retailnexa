# Test plan

## Automated (run in CI on every PR)

| Suite | Command | What it proves |
|---|---|---|
| Unit | `npm run test:unit` | Billing access states, plan pricing and Stripe line items, webhook handler (idempotency, re-fetch, tenant-mapping attacks, failure retry), permission model, profit separation (gross/operating/net), sales comparisons and projections, wholesale quantity rules, lead validation, open-redirect guard, revenue summary |
| Database security | `npm run test:db` | Fresh DB + Supabase emulation + all migrations. Tenant isolation, role rules (rank, last owner, self-change), invitation security (email-bound, single use, expiry, hashed tokens), column-level grants, audit immutability, platform MFA + support-grant gating, suspension read-only, Stripe ledger/sync ordering and reactivation, rate limiter, **schema-wide guards** (RLS on every table, nothing executable by anon, pinned search_path), TS↔DB permission catalog sync, **API contract** (every `.rpc()`/`.from()` call matches real functions/columns) |
| Static | `npm run lint && npm run typecheck` | Types, React rules, demo data cannot be imported by tenant code |
| Build | `npm run build` | Builds with **no credentials**; public pages static, all authenticated routes request-time |

Current totals: **91 tests** (40 unit, 51 database). Mutation checks performed: a deliberately broken RLS policy, a wrong column, a wrong RPC parameter and a wildcard select on a column-restricted table were each caught. `tests/db/review-fixes.test.ts` pins every finding from the independent security review.

## Not yet automated (needs live services)
End-to-end browser tests against a real Supabase project and Stripe test mode. To add once credentials exist: Playwright suite in `tests/e2e` run against Vercel preview with a seeded test tenant.

## Manual acceptance script (run on each preview before merge)
1. Sign up with a new email → confirm email → onboarding → create business (retail) → billing shows $0-today trial text.
2. Checkout with Stripe test card `4242 4242 4242 4242` → returns to billing with “Free trial”, trial end date 7 days out. Stripe dashboard shows a trialing subscription, no charge.
3. Add a second location; invite an employee (copy link) → open in a private window → sign up as that email → accept → employee sees only Overview; `/app/settings/team` shows no team list; `/app/audit` denied.
4. Owner: change employee to manager, grant “View reports”, remove access → audit log shows each change with the actor.
5. Billing: Cancel subscription → banner “ends at the close…”; Resume → banner gone. Stripe test clock: advance past trial → status Active, invoice paid.
6. Use test card `4000 0000 0000 0341` (attach then fail) → advance clock → status “Payment failed” banner, app still usable (grace).
7. Cancel and let it end → app read-only, export downloads, “Reactivate” shows **no** free trial.
8. Second account cannot see the first account’s anything (try `/app/settings/team` after switching cookie value manually — must fall back to own org).
9. Platform admin: `/admin` requires TOTP enrollment; suspend the test org with a reason → tenant sees suspended notice, cannot add locations; reactivate. Non-admin visiting `/admin` gets 404.
10. Request a demo on the public site → appears in `/admin/leads`; 6th submission within an hour from the same network is refused.
11. Lighthouse on `/`, `/pricing`, `/demo` (mobile): accessibility ≥ 95, no console errors.
