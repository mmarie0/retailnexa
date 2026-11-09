# RetailNexa

Sales, bills, inventory, staff, wholesale ordering and double-entry bookkeeping for independent retail stores and wholesale distributors — a multi-tenant SaaS on Next.js, Supabase and Stripe.

- **Status:** Phase 1 (SaaS foundation) — see [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)
- **Set up accounts and keys:** [`docs/SETUP.md`](docs/SETUP.md)
- **How it’s built:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md), [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md)
- **Rules:** [`docs/SECURITY_RULES.md`](docs/SECURITY_RULES.md) · **Tests:** [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) · **Plan:** [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Quick start
```bash
npm ci
cp .env.example .env.local   # fill in Supabase + Stripe test keys
npm run dev
```
The public site and interactive demo run without any keys. Signing in, billing and the admin portal need Supabase and Stripe configured.

## Tests
```bash
npm run lint && npm run typecheck
npm run test:unit
npm run test:db     # requires a local Postgres 16 (postgres/postgres@localhost:5432)
npm run build
```
