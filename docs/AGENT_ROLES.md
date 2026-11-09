# Agent roles and collaboration

| Role | Who | Responsibilities |
|---|---|---|
| Owner | The business owner | Final say on scope, prices, legal text; **approves every production financial, billing, authentication and destructive database change**; holds all credentials |
| Primary developer | Claude | Architecture, migrations, backend, frontend, tests, docs; opens PRs; fixes reported bugs; keeps PROJECT_STATUS.md current |
| PM / QA / security reviewer | Grok (xAI) | Reviews PRs, tests preview deployments, files bug reports and recommendations as GitHub issues; never merges or deploys |

## Workflow (GitHub is the source of truth)
1. Work starts from a GitHub issue (label `phase-N`, `type:feature|bug|security`).
2. Claude branches `feat/<issue>-<slug>` or `fix/<issue>-<slug>`, commits with tests, opens a PR that links the issue, lists what was tested and what was not, and includes migration notes.
3. CI must pass (lint, typecheck, unit, DB security tests, build). Vercel posts a preview URL.
4. Grok reviews the diff and the preview, comments on the PR and opens issues for defects. Claude addresses them on the same branch.
5. The owner approves and merges. Production database migrations and anything touching billing/auth/money run only after explicit owner approval.
6. Claude updates `docs/PROJECT_STATUS.md` in the PR.

Claude and Grok do **not** talk to each other directly. All coordination happens through issues, PR comments and the docs in this repo.

## Grok integration (deferred — owner asked for it to be added last)
Planned design, to be built once the core modules are done and the owner provides an xAI API key:
- A GitHub App (or fine-grained token) with **read** access to code and **write** access only to issues and PR comments. No merge, push, deploy or secrets access.
- A small controller (Vercel function or GitHub Action) triggered by `pull_request` and `deployment_status` webhooks. It sends the diff, PR description, TEST_PLAN.md and SECURITY_RULES.md to the xAI API and posts Grok’s review as a PR comment; findings tagged `bug` become issues.
- Preview testing: the controller gives Grok the preview URL and a seeded **demo tenant** login only (fictional data, test-mode Stripe). Never production credentials.
- Rate limits and a spend cap on the xAI key; every controller action logged.

## Guardrails for all AI agents
- Never commit secrets; never print env values in logs or PRs.
- No unrestricted production actions: agents cannot run production migrations, change Stripe products/prices, refund, or delete data.
- Do not claim an integration works until it has been tested; say what was and wasn’t verified.
