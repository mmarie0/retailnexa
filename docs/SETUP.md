# Setup checklist (owner)

Everything below needs an account or a secret only the owner can create. Never paste secret keys into chat or commit them; put them in Vercel environment variables (and `.env.local` for local development).

## 1. GitHub
1. Create a private repository (suggested: `retailnexa`).
2. Connect GitHub to Claude (claude.ai → Settings → Connectors) and tell Claude the `owner/repo`; Claude pushes the code on a branch and opens the first pull request.
3. Protect `main`: require the **CI** workflow to pass and one review before merge.

## 2. Supabase
1. Create a project (Pro plan recommended before launch for backups/PITR).
2. Authentication → Providers → Email: enable, **Confirm email = ON**, minimum password length 10.
3. Authentication → URL configuration: Site URL = your production URL; add `https://<your-domain>/auth/confirm` and your Vercel preview pattern to redirect URLs.
4. Authentication → Email templates (server-side confirmation, works across devices):
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
5. Authentication → MFA: enable TOTP.
6. Apply migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push` (or paste each file in `supabase/migrations` into the SQL editor in order).
7. Copy Project URL, anon key and service-role key into Vercel env vars (see `.env.example`).
8. Create the first platform admin (owner only): sign up through the app, then in the SQL editor run
   `insert into public.platform_admins (user_id, role) select id, 'superadmin' from auth.users where email = 'you@example.com';`
   Then visit `/admin` and enrol your authenticator app.

## 3. Stripe
1. Use **test mode** first.
2. Products → create “RetailNexa Retail” with a monthly price ($129.99), “Retail additional location” monthly price ($99.99, per unit), “RetailNexa Wholesale” monthly price ($149.99). Confirm these amounts — they came from the prototype.
3. Copy the three Price IDs into `STRIPE_PRICE_RETAIL`, `STRIPE_PRICE_RETAIL_EXTRA_LOCATION`, `STRIPE_PRICE_WHOLESALE`.
4. Settings → Billing → Customer portal: enable payment-method updates, invoice history and cancellation (at period end).
5. Developers → Webhooks → add endpoint `https://<domain>/api/webhooks/stripe` with the events listed in API_CONTRACTS.md; copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
6. Settings → Billing → Subscriptions and emails: turn on Smart Retries and failed-payment / trial-ending emails.
7. Decide on Stripe Tax (sales tax on subscriptions) — needs your tax registrations.

## 4. Vercel
1. Import the GitHub repo; framework Next.js; Node 22.
2. Add all variables from `.env.example` for Production and Preview (Preview should use Stripe **test** keys and a separate Supabase project if possible).
3. Add `CRON_SECRET` (random 32+ characters). The billing reconcile cron in `vercel.json` runs daily.
4. Add the custom domain and set `NEXT_PUBLIC_SITE_URL` to it.

## 5. Before public launch
- Attorney review of `/legal/terms`, `/legal/privacy`, `/legal/billing`.
- Confirm prices and that the pricing page disclosure matches Stripe settings.
- Run the manual acceptance script in TEST_PLAN.md against the preview deployment.
