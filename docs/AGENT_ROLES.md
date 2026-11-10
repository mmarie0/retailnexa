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

## Grok integration
**Built: PR reviews** (`.github/workflows/grok-review.yml` + `scripts/grok-review.mjs`). On every non-draft pull request, GitHub Actions sends Grok the PR description, the diff (lockfiles excluded, capped at 120k characters), `docs/SECURITY_RULES.md` and `docs/TEST_PLAN.md`, and posts Grok’s review as one PR comment that is updated on each new push. Grok’s output has fixed sections: Verdict, Findings (severity, file:line, scenario, fix), Tests to add, Questions for the owner.

To turn it on (owner):
1. Create an API key at console.x.ai (set a monthly spend limit there).
2. In the GitHub repo: Settings → Secrets and variables → Actions → **New repository secret** `XAI_API_KEY`.
3. Optional: repository **variable** `XAI_MODEL` to change the model (default `grok-4.7`).
Without the secret the job skips itself and never fails CI.

Permissions: the workflow token can read code and write PR comments only (`contents: read`, `pull-requests: write`). It uses `pull_request`, never `pull_request_target`, so code from a fork can never see the key. Diff content is passed to Grok as untrusted data.

Claude reads Grok’s comment on the PR and addresses findings on the same branch; Grok re-reviews on the next push.

**Not built yet:** Grok testing the live preview deployment (needs Vercel preview URLs and a seeded demo-tenant login with test-mode Stripe — never production credentials), and Grok opening GitHub issues from findings (would add `issues: write`).

## Guardrails for all AI agents
- Never commit secrets; never print env values in logs or PRs.
- No unrestricted production actions: agents cannot run production migrations, change Stripe products/prices, refund, or delete data.
- Do not claim an integration works until it has been tested; say what was and wasn’t verified.
