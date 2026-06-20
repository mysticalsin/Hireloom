# Hireloom — Launch Runbook

One checklist to take the hosted platform live. Order matters. Everything below is
built and (where possible) verified; these steps wire it to live infrastructure.

---

## 1. Supabase (auth + database + functions)

1. Create a project at https://supabase.com → note the **Project URL** and the
   **anon** and **service_role** keys (Project Settings → API).
2. **Database** → SQL Editor → run, in order:
   - `supabase/migrations/0001_init.sql` (profiles, subscriptions, roles, reports,
     usage_counters, RLS, signup trigger, `increment_usage`)
   - `supabase/migrations/0002_byok.sql` (Vault-backed provider keys + `cv_md` +
     `set_provider_key` / `get_provider_key` RPCs)
   - `supabase/migrations/0003_tailorings.sql` (stored tailored CV/cover packages)
   - `supabase/migrations/0004_apply_answers.sql` (assisted-apply drafted answers)
3. **Authentication → Providers**: enable **Email**. (Optional: enable **Google**,
   add OAuth client id/secret, set Site URL + redirect to your domain.)
4. **Edge Functions** (install the Supabase CLI, `supabase link` the project):
   ```bash
   supabase functions deploy evaluate
   supabase functions deploy tailor
   supabase functions deploy apply-assist
   supabase functions deploy checkout
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
5. **Function secrets**:
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_live_... \
     STRIPE_WEBHOOK_SECRET=whsec_... \
     STRIPE_PRICE_PRO=price_... STRIPE_PRICE_STUDIO=price_... \
     SITE_URL=https://your-domain
   ```
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
   automatically.)

## 2. Stripe (billing)

1. Create two **recurring prices**: Pro **$29/mo**, Studio **$79/mo** → copy the
   price IDs into the function secrets above.
2. Developers → Webhooks → add endpoint =
   `https://<project>.supabase.co/functions/v1/stripe-webhook`; subscribe to
   `checkout.session.completed`, `customer.subscription.created|updated|deleted` →
   copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## 3. Web app (the front page + dashboard)

```bash
cd web
cp .env.example .env        # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run build               # verify (already passing)
```
Deploy `web/` to Vercel/Netlify (Root = `web`, framework = Vite, output `dist`).
Set the two `VITE_*` env vars in the host. Point your domain at it; set the same
domain as `SITE_URL` (functions) and Supabase Auth Site URL.

## 4. Smoke test (end to end)

1. Open the site → cinematic hero renders (video + glass).
2. **Get started** → sign up → confirm email → land on the dashboard.
3. **Settings** → save an Anthropic (or other) BYO key + paste your CV.
4. **Evaluate a role** → paste a Greenhouse/Lever URL → a scored role + report
   appear; "Evaluations this month" increments.
5. **Upgrade to Pro** → Stripe Checkout → pay (test mode) → webhook flips the plan
   on the dashboard.

## 5. Marketing site (optional, separate static landing)

`marketing/` is a standalone static landing (pre-React). If you keep it:
deploy it (`vercel.json` included), wire the waitlist endpoint, render a 1200×630
PNG OG image, submit `marketing/sitemap.xml` to Search Console. See
`docs/SEO-CRO-PLAN.md`. (The `web/` React app is the primary front end now.)

---

## Security notes
- BYO keys live in **Supabase Vault** (encrypted at rest); the app only ever holds
  a secret reference. Reads go through a SECURITY DEFINER RPC scoped to `auth.uid()`.
- Every table is **RLS-protected** — a user can only ever touch their own rows.
- The `stripe-webhook` function is signature-verified; `checkout`/`evaluate` require
  a valid Supabase JWT.

## Status
- Engine: ~455 unit tests green. Web: strict typecheck + build pass.
- Not runnable from the build box (needs the live Supabase/Stripe set up above).
- See `docs/HOSTED-PLATFORM-BRIEF.md` (architecture) and
  `docs/PRODUCT-GTM-STRATEGY.md` (pricing/positioning).
