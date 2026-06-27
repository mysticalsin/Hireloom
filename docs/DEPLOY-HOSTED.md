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
supabase db push            # applies supabase/migrations/0001..0014 (forward-only)
```
`0005_security_hardening.sql` is the security-critical one: paywall lockdown (subscriptions/
usage_counters SELECT-only), atomic `consume_quota`, `audit_log`, `stripe_events`, CHECK
constraints, `delete_my_account()`. Confirm it applied cleanly.

## 2. Supabase — auth posture
`supabase/config.toml` enforces `enable_confirmations = true` + min password length 8.
Set a real transactional SMTP (Resend/Postmark) in the Supabase dashboard (Auth → SMTP) so
confirmation/reset emails send. Add your web origin under Auth → URL Configuration.

**Google OAuth (required for Google sign-in + Connect Gmail).** In Auth → Providers → Google,
enable the provider and paste the OAuth **client id** and **client secret** from a Google Cloud
OAuth consent screen / credentials. Authorize the Supabase callback
(`https://<proj>.supabase.co/auth/v1/callback`) as a redirect URI on the Google side. Request
the `https://www.googleapis.com/auth/gmail.readonly` scope so the same Google grant powers the
client-side "Sync inbox" Gmail read (the SPA fetches `https://gmail.googleapis.com`, allowed by
the CSP `connect-src` in `web/nginx.conf`).

## 3. Supabase — edge functions
```bash
supabase functions deploy evaluate
supabase functions deploy tailor
supabase functions deploy apply-assist
supabase functions deploy validate-key
supabase functions deploy recruiter-score
supabase functions deploy checkout
supabase functions deploy billing-portal
supabase functions deploy demo-eval        # optional keyless "try a sample score" demo (off unless DEMO_API_KEY is set)
supabase functions deploy stripe-webhook --no-verify-jwt   # Stripe can't send a JWT; signature is the auth
```
The per-function `verify_jwt` posture is also pinned in `supabase/config.toml` (`[functions.*]`)
so it survives a plain redeploy — `stripe-webhook` stays `verify_jwt = false`, every other
function stays `verify_jwt = true`.
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

**Optional — keyless "try a sample score" demo.** The `demo-eval` function lets a signed-in
user with no BYO key yet run ONE sample A-G evaluation on **your** (the operator's) key, to
feel the product before the BYOK wall. It is **operator-opt-in and OFF by default**: with no
`DEMO_API_KEY` set the function returns `{ disabled: true }` and the UI hides the button — you
spend nothing. When funded it is hard-capped: **one per user** (`profiles.demo_used`, set via
the service role) plus a **3-per-minute** per-user burst limit. The operator key is never
logged or returned, and a user's own BYO key is never used for the demo.
```bash
supabase secrets set DEMO_API_KEY="sk-ant-..."        # the OPERATOR's key — funds the demo; omit to keep it OFF
supabase secrets set DEMO_PROVIDER="anthropic"        # optional; default anthropic (anthropic|openai|kimi|openrouter|gemini)
supabase secrets set DEMO_MODEL="claude-sonnet-4-0"   # optional; default per provider
```
Deploy the function (`supabase functions deploy demo-eval`) for the feature to exist at all.

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

## 5a. Scheduled maintenance
Migration `0014` schedules all retention prunes automatically **if `pg_cron` is available**:
`prune_rate_limits` (0008), `prune_audit_log` (90d), `prune_analytics_events` (180d), and
`prune_stripe_events` (30d). The scheduling is guarded — if `pg_cron` is not installed the
migration emits a `notice` and continues (non-fatal), so the prune functions still exist but are
not auto-scheduled.

If `pg_cron` is unavailable on your host, invoke the prune functions from any external scheduler:
`prune_rate_limits()` on a ~15-minute cadence, and the other three daily, e.g.
```sql
select public.prune_rate_limits();
select public.prune_audit_log();
select public.prune_analytics_events();
select public.prune_stripe_events();
```

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
pgTAP RLS/isolation suite keeps tenant isolation honest — keep it green before charging anyone.

## Known not-yet-done (see WORKING.md)
- Session is in localStorage (CSP mitigates; httpOnly-cookie migration via `@supabase/ssr` pending).
- `import-roles` (OSS→hosted) pending.
- DPA + final legal review by counsel pending (Privacy/Terms drafts ship at `/privacy.html` and
  `/terms.html`; AUP drafted).
