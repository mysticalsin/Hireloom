# Deploying the Hireloom hosted SaaS

End-to-end runbook: **Supabase** (auth + Postgres/RLS + edge functions + Vault) ·
**Stripe** (billing) · **Fly.io** (the React SPA). Nothing here provisions cloud for you —
run it when you're ready with your own accounts.

## 0. Prereqs
- `supabase` CLI, `deno`, `flyctl`, Node 20+.
- A Supabase project, a Stripe account, a Fly.io account.

## 1. Supabase — database + RLS
```bash
supabase link --project-ref <your-ref>
supabase db push            # applies supabase/migrations/0001..0005 (forward-only)
```
`0005_security_hardening.sql` is the security-critical one: paywall lockdown (subscriptions/
usage_counters SELECT-only), atomic `consume_quota`, `audit_log`, `stripe_events`, CHECK
constraints, `delete_my_account()`. Confirm it applied cleanly.

## 2. Supabase — auth posture
`supabase/config.toml` enforces `enable_confirmations = true` + min password length 8.
Set a real transactional SMTP (Resend/Postmark) in the Supabase dashboard (Auth → SMTP) so
confirmation/reset emails send. Add your web origin under Auth → URL Configuration.

## 3. Supabase — edge functions
```bash
supabase functions deploy evaluate
supabase functions deploy tailor
supabase functions deploy apply-assist
supabase functions deploy checkout
supabase functions deploy stripe-webhook --no-verify-jwt   # Stripe can't send a JWT; signature is the auth
```
Set function secrets:
```bash
supabase secrets set SITE_URL="https://app.hireloom.example"            # CORS allowlist + Stripe return URLs
supabase secrets set ALLOWED_ORIGINS="https://hireloom.example"          # optional extra origins
supabase secrets set STRIPE_SECRET_KEY="sk_live_..."
supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_..."
supabase secrets set STRIPE_PRICE_PRO="price_..." STRIPE_PRICE_STUDIO="price_..."
# Optional: KIMI_BASE_URL if using a non-default Moonshot endpoint.
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 4. Stripe
1. Create two recurring Products/Prices (Pro, Studio); copy the price IDs into the secrets above.
2. Add a webhook endpoint → the deployed `stripe-webhook` function URL; subscribe to
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`. Copy its
   signing secret into `STRIPE_WEBHOOK_SECRET`.

## 5. Web (Fly.io)
```bash
cd web
fly launch --no-deploy --copy-config        # first time; app name = hireloom-web
fly deploy \
  --build-arg VITE_SUPABASE_URL="https://<proj>.supabase.co" \
  --build-arg VITE_SUPABASE_ANON_KEY="<anon-key>"
```
`VITE_*` are public (the anon key is meant to be public; RLS does the protection). The
container serves the static build via nginx with a strict CSP (see `web/nginx.conf`).
Railway alternative: point a service at `web/` with the same Dockerfile + build args.

## 6. Smoke test (do before inviting anyone)
- Sign up → confirm email → sign in.
- Settings → save an Anthropic/OpenAI key → it shows as saved (never echoed back).
- Paste a Greenhouse/Lever URL → evaluate → role + report appear.
- Confirm a **non-job-board internal URL is rejected** (SSRF guard) and a bad key returns a
  friendly error (not a stack trace).
- As a second user, confirm you cannot see the first user's roles (tenant isolation).
- Stripe test-mode checkout → webhook flips plan → quota lifts.

## CI gate (before any of this)
`.github/workflows/ci-hosted.yml` runs: web typecheck+vitest+build, engine provider tests,
and `deno check` on the edge functions + entitlement-twin tests. The `supabase start` +
pgTAP RLS/isolation suite is the Phase-1 addition — keep it green before charging anyone.

## Known not-yet-done (see WORKING.md)
- Session is in localStorage (CSP mitigates; httpOnly-cookie migration via `@supabase/ssr` pending).
- pgTAP RLS isolation tests + per-user rate limiting + `import-roles` (OSS→hosted) pending.
- Legal docs (ToS/Privacy/AUP/DPA), data-export endpoint, cookie consent pending.
