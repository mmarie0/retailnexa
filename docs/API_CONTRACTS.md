# API contracts

RetailNexa uses Server Actions for form mutations, Route Handlers for machine endpoints and file downloads, and Postgres RPCs for privileged writes. `tests/db/api-contract.test.ts` checks every `.rpc()` and `.from()` call in `src/` against the real schema.

## Route handlers

| Method & path | Auth | Purpose | Responses |
|---|---|---|---|
| `POST /api/webhooks/stripe` | Stripe signature (`STRIPE_WEBHOOK_SECRET`) | Billing events → subscription mirror | 200 `{received, outcome}`; 400 bad/missing signature; 500 processing failed (Stripe retries); 503 not configured |
| `GET /api/cron/reconcile-billing` | `Authorization: Bearer $CRON_SECRET` (constant-time compare) | Re-sync stale subscriptions from Stripe | 200 `{checked, synced, failed}`; 401; 503 |
| `GET /app/billing/return?session_id=cs_…` | Signed-in member | Verify Checkout session belongs to caller's org, sync, redirect | 303 → `/app/billing?checkout=success\|pending\|unknown` |
| `GET /app/export` | `data.export` | JSON export of the org (RLS-scoped) | 200 attachment; 403 |
| `GET /auth/confirm?token_hash&type&next` or `?code` | — | Email confirmation, recovery, invite links | 307 → `next` (sanitised) or `/login?error=link_expired` |
| `POST /auth/signout` | — | Sign out, clear active-org cookie | 303 → `/` |
| `GET /account/security` (page) | Signed in | Set up a TOTP authenticator (required before platform access) | — |

### Stripe events handled
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created|updated|deleted|paused|resumed|trial_will_end`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`. All others are acknowledged and recorded as `ignored`. Enable exactly these on the Stripe webhook endpoint.

## Server actions

All return `ActionState { ok, message, fieldErrors?, data? }`, validate input with zod, take the organization from the session (never the form), and re-check permission + access state.

| Module | Action | Permission |
|---|---|---|
| auth | `signIn`, `signUp`, `requestPasswordReset`, `updatePassword` | — |
| onboarding | `createOrganization` → RPC `create_organization` | signed in |
| leads | `submitLead` (honeypot, 5/hour per IP hash) | public |
| billing | `startCheckout`, `openPortal`, `cancelSubscription`, `resumeSubscription` | `billing.manage` |
| settings | `updateOrganization` | `org.manage` |
| settings | `createLocation`, `updateLocation` | `locations.manage` |
| settings | `inviteMember`, `revokeInvitation`, `changeMemberRole`, `setMemberStatus` | `members.manage` (+ rank rules in SQL) |
| settings | `setMemberPermission` | `roles.manage` |
| settings | `grantSupportAccess`, `revokeSupportAccess` | `org.manage` |
| bills | `createVendor`, `updateVendor` | `vendors.manage` |
| bills | `createBill` → RPC `create_bill` (redirects to the bill) | `bills.create` |
| bills | `approveBill`, `voidBill` | `bills.approve` |
| bills | `recordBillPayment` (form carries a one-time key so double-submits record once) | `bills.pay` |
| admin | `setOrgStatus` (superadmin/billing; close = superadmin), `setFeatureOverride`, `sendPasswordReset`, `updateLead`, `createAnnouncement`, `endAnnouncement` | platform role + MFA |

## RPC signatures
See `supabase/migrations/20261109000300_rpc.sql`, `20261110000100_ledger.sql` and `20261110000200_vendors_bills.sql`. Parameter names are part of the contract (PostgREST calls by name).

## Versioning
Breaking changes to a route handler or RPC require a new name/version (`sync_subscription_v2`) and a migration window; the old one is removed in a later release after callers are updated.
