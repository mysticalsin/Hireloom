# Hireloom Hosted SaaS — Audit Report

> Source: 18-dimension multi-agent audit (forge `hireloom-audit`, run wf_f652b357-a82).
> **Coverage caveat:** 8/18 dimensions completed; 10 failed on transient API rate-limiting
> (`be-billing, sec-byok, sec-rls, sec-supply, fe-design, pm-features, pm-growth, plug-play,
> legal-gdpr, infra-devex`) and are queued for re-run against the post-Phase-0 code.
> Findings below are from the completed dims (`sec-auth, sec-edge, be-engine, be-data,
> fe-arch, fe-a11y, perf, tests`) + adversarial verification + conductor first-hand grounding.

## Overall readiness: **40 / 100**
Sound spine (real per-user Supabase Auth, RLS-by-design, Vault BYOK, per-call chokepoint,
Stripe wired, no stub screens) — dangerous surface. Not chargeable today: the paywall does
not hold and the trust story is broken. None of the holes are architectural rewrites.

---

## SECURITY CRISIS — ship-blockers (no real user until ALL closed)

1. **CRITICAL — SSRF in `evaluate`** · `supabase/functions/evaluate/index.ts:55` `await fetch(input)` on any user URL; body persisted to readable `roles.jd_text` = exfil channel (metadata/RFC1918/loopback). Redirects bypass a host-only allowlist.
2. **CRITICAL — Paywall bypass** · `0001_init.sql:72,75` RLS `for all` on `subscriptions`+`usage_counters` → any user upserts own `plan='studio'` + zeroes usage. Deterministic.
3. **CRITICAL — Gemini BYO key in URL** · `evaluate:65` (+tailor/apply-assist) + `engine/llm/provider.mjs` buildGemini `?key=` → leaks to proxy/CDN/APM logs.
4. **CRITICAL — Zero isolation/BYOK tests** · no test runs an RLS policy or the Vault round-trip against real Postgres.
5. **CRITICAL/HIGH — JWT in localStorage + rendered model markdown** · `web/src/lib/supabase.ts:11` → XSS steals session.
6. **HIGH — Stripe webhook: no idempotency/ordering** · replayed/out-of-order events re-grant paid plans; `checkout.session.completed` nulls `current_period_end`.
7. **HIGH — No audit_log** for BYOK key access / plan changes.
8. **HIGH — No GDPR delete/retention** for CV/JD/report PII.
9. **HIGH — Error/stack leakage** to clients across all edge functions.

---

## P0 — Ship-blockers
- [ ] Close SSRF in `fetchJd` (allowlist + private-IP reject + `redirect:'manual'` + timeout + size cap).
- [ ] Migration 0005: `subscriptions`/`usage_counters` SELECT-only; writes via service-role + RPC.
- [ ] Gemini key → `x-goog-api-key` header (edge fns + `provider.mjs`).
- [ ] Tenant-isolation + BYOK CI proof (`supabase start` + pgTAP/SQL two-user tests; assert authed write to subscriptions/usage_counters REJECTED).
- [ ] Session → httpOnly cookies (`@supabase/ssr`) + strict CSP + sanitize rendered markdown.
- [ ] Atomic quota gate (consume BEFORE provider call, gate on returned count, refund on failure); fix `engine/store/supabase-store.mjs` to use the RPC.
- [ ] Stripe webhook idempotency (`stripe_events` dedup) + recency guard + `payment_status==='paid'` gate.
- [ ] `audit_log` (migration 0005) written by BYOK RPCs + webhook.
- [ ] GDPR `delete_my_account()` + retention purge + UI erase.
- [ ] Stop leaking errors (generic message + request id; details server-side).
- [ ] Frontend root ErrorBoundary + stop swallowing Supabase errors (`db.ts`) + try/catch/finally in Dashboard/RoleDetail (no infinite spinner / false-empty / silent free downgrade).
- [ ] Commit `supabase/config.toml` with `enable_confirmations = true`.
- [ ] Deno test suites for all 5 edge functions (auth-401, quota-402, gating, Stripe sig valid/tampered).
- [ ] Pin entitlement twins (`_shared/entitlement.ts` vs `engine/billing/entitlement.mjs` — already diverged).

## P1 — Required to be sellable
- [ ] Password reset / account recovery (none exists).
- [ ] Split Gmail consent out of login (incremental, post-login).
- [ ] Restrict CORS to `SITE_URL` allowlist (all fns are `*`).
- [ ] Per-user rate limiting on auth + LLM functions.
- [ ] Server-side password policy.
- [ ] CHECK constraints on `plan`/`status`/`provider` (migration 0005).
- [ ] OSS→hosted `import-roles` (convert installed base to tenants).
- [ ] `saveReport` tenant-ownership check (service-role bypasses RLS).
- [ ] Fix `validateKey` for OpenRouter (returns `model:'openrouter'` → always fails).
- [ ] Retry hardening (honor `Retry-After`, jitter, cap elapsed, drain bodies, strip provider error bodies).
- [ ] Accessible Dialog primitive + focus rings + labels + reduced-motion video + keyboard table (EAA/VPAT).
- [ ] SaaS client tests (AuthProvider, invoke 401, billing).
- [ ] Loading/empty/error across all data surfaces.
- [ ] zod validation at the invoke boundary.

## P2 — Polish / scale
- [ ] Code-split SPA (`manualChunks` + `React.lazy`) — single 403KB bundle ships dashboard to logged-out visitors.
- [ ] Font CWV fix (~0.29 CLS): self-host woff2 + preload / metric-matched fallback.
- [ ] Marketing rAF/canvas gating behind IntersectionObserver + reduced-motion.
- [ ] Real og:image JPG (<300KB 1200×630); current points at SVG (rejected by platforms).
- [ ] `web/vercel.json` immutable asset cache headers.
- [ ] Private Storage bucket for reports/PDFs (unbounded Postgres text today).
- [ ] Index Stripe IDs; add timestamps to tailorings/apply_answers/subscriptions/provider_keys.
- [ ] Gmail sync: parallelize + AbortSignal.
- [ ] Validate user-supplied `model` (regex + allowlist).
- [ ] Lighthouse-CI budget; reduce git media bloat (og-image.jpg 5.7MB, demo.gif 8.3MB).

---

## Build order (de-risk security first → fastest path to sellable)
- **Phase 0 — Stop the bleeding:** migration 0005 (paywall lockdown + audit_log + stripe_events + CHECKs + atomic quota) · SSRF fix · Gemini header · atomic quota in fns · webhook idempotency · error sanitization.
- **Phase 1 — Prove it (CI):** `supabase start` in CI · pgTAP RLS isolation + write-rejection tests · Vault BYOK round-trip/denial tests · Deno per-function suites · entitlement-twin equivalence.
- **Phase 2 — Trust surface:** httpOnly cookie session + CSP + markdown sanitize · root ErrorBoundary + un-swallow errors + real states + zod boundary.
- **Phase 3 — Sellable floor:** password reset · `delete_my_account()` + retention · Gmail incremental consent · CORS allowlist + rate limit + password policy · `import-roles` · ownership check · OpenRouter validateKey · retry hardening.
- **Phase 4 — Procurement + polish:** accessible Dialog + focus/labels/reduced-motion/keyboard table · SaaS client tests · perf (code-split, font CWV, rAF gating, og:image, cache) · Storage bucket · indexes · Lighthouse-CI.

**Gate:** no real paying user until Phases 0–2 merged + green in CI. Phase 3 = the line for charging money. Phase 4 = B2B/enterprise unlock.
