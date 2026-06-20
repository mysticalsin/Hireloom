# Hireloom — Hosted Platform Architecture Brief

> Status: **DRAFT — awaiting human approval (Checkpoint: approve brief)**
> Owner: Tony Walteur (sole rightsholder; PolyForm Shield Noncompete binds third parties, not the licensor)
> Scope: convert the single-user, file-based, Claude-Code-dependent desktop tool into a
> multi-tenant, BYOK, hosted web platform.
> Method: software-factory phased program. No Builder writes code until this brief is approved.

---

## 1. Current state (what we're starting from)

| Dimension | Today |
|---|---|
| Tenancy | Single-user per install (`STACK.md → tenancy`) |
| Storage | Local files: `data/`, `reports/`, `output/`, `config/`. No DB. |
| Core AI loop | Executed **by the local Claude Code CLI** reading `modes/*.md` — uses Claude Code's own key |
| Standalone AI | ⚠️ **CORRECTION (Phase-1 grounding):** the clean provider abstraction (`llm-api.mjs`) and the `jobseeker.mjs` autopilot are **untracked/gitignored personal files — NOT in the product.** The dashboard autopilot spawns gitignored `jobseeker.mjs` (`apps/web/server.mjs:10515`) → dead path for any other deploy. The shipped product's tracked AI = four scripts each hardwired to one provider (`engine/gemini-eval.mjs` Gemini SDK; `engine/batch/tailor-engine.mjs`, `engine/apply/kimi-apply.mjs`, `engine/apply/apply-session.mjs` raw Kimi). No unified BYOK chokepoint exists in the product. |
| Server | `apps/web/server.mjs` — raw Node `http`, ~10k lines, no framework |
| Auth | None (localhost-open); Gmail OAuth only; `AUTH_TOKEN` gate for non-loopback |
| Secrets | Plaintext `.env`; no encryption at rest |
| Billing | None |
| Apply automation | Local Playwright/Chromium driving ATS forms |
| Tests | ~242 (`tests/`), CI on PR; 1 perf test failing (CLS 0.29) |
| Language | Plain JS (ESM `.mjs`), no typecheck/lint |

**The load-bearing constraint:** the polished interactive loop depends on Claude Code as the runtime.
There is no per-tenant Claude Code in the cloud. **Every AI call must move to `llm-api.mjs` on the
tenant's BYO key.** This is the keystone of the entire program — Phase 1.

---

## 2. Target architecture

```
                         ┌─────────────────────────────────────────┐
  Browser (tenant) ──────►  Web app (TS, SSR/SPA)                   │
                         │   auth session (httpOnly+secure cookie)  │
                         └───────────────┬─────────────────────────┘
                                         │  REST/RPC, Zod-validated
                         ┌───────────────▼─────────────────────────┐
                         │  API service (Hono/Fastify, TS)          │
                         │  • authz at every entry (tenant_id)      │
                         │  • rate-limit per tenant                 │
                         │  • entitlement gate (Stripe)             │
                         └──┬───────────┬──────────────┬───────────┘
                            │           │              │
            ┌───────────────▼──┐  ┌─────▼───────┐  ┌───▼────────────────┐
            │ Postgres (RLS)   │  │ KMS-backed  │  │ Job queue + workers │
            │ tenant-isolated  │  │ BYOK vault  │  │ (scan, gmail poll,  │
            │ Drizzle + migr.  │  │ envelope enc│  │  PDF render)        │
            └──────────────────┘  └─────────────┘  └───┬─────────────────┘
                            │                          │
                  ┌─────────▼──────┐         ┌─────────▼──────────────┐
                  │ Object storage │         │ engine/* libs (reused) │
                  │ (reports, PDFs)│         │ llm-api, scan, render, │
                  └────────────────┘         │ tracker, fit-score,    │
                                             │ role-index             │
                                             └─────────┬──────────────┘
                                                       │ tenant BYO key
                                             ┌─────────▼──────────────┐
                                             │ LLM providers          │
                                             │ Anthropic / Kimi / OR  │
                                             └────────────────────────┘
```

**Reuse, don't rewrite:** `engine/llm-api.mjs`, `engine/scan/*`, `engine/render/*`,
`engine/tracker/*`, `apps/web/lib/{role-index,fit-score,email-groups,gmail-signals,status-history}.mjs`
are pure-ish, tested logic. They get wrapped by the new service layer, not replaced. The new code is
the **SaaS shell**: API framework, auth, data-access with tenant isolation, key vault, billing, jobs.

---

## 3. Recommended stack (aligned to STACK_CHOICES.md) — needs sign-off

| Concern | Recommendation | Why / alternative |
|---|---|---|
| Language (new shell) | **TypeScript** | House standard; type safety at the money/security boundary. Engine stays JS, wrapped. |
| Server framework | **Hono** (or Fastify) | Edge-capable, light, TS-first. Fastify if we stay long-running Node. |
| DB | **Postgres** (Neon managed) | House standard; RLS for tenant isolation. |
| ORM / migrations | **Drizzle** | Typed, light, forward-only migrations (CLAUDE.md §4). |
| Validation | **Zod** | Every external input validated server-side (security rule). |
| Auth | **Provider — WorkOS / Clerk / Supabase Auth** | Do NOT roll our own. Email + Google OAuth + sessions. |
| BYOK vault | **Envelope encryption via cloud KMS** (AWS KMS / GCP KMS) | Per-tenant DEK wrapped by CMK; keys decrypted in-memory only at call time. Highest-liability component. |
| Billing | **Stripe** | Subscription for the platform; inference paid by tenant (BYOK). Webhooks → entitlement. |
| Jobs/queue | **BullMQ + Redis** (or managed equiv) | Move scans, Gmail polling, PDF render off the request path. |
| Object storage | **Cloudflare R2 / S3** | Reports + generated PDFs. |
| Hosting | **Fly.io or Railway** to start; containerized (Dockerfile exists) | Scale to ECS/K8s later if needed. |
| Email | **Resend / Postmark** | Transactional (verify, receipts, notifications). |
| Observability | **Sentry** + structured logs + healthcheck | Currently flying blind. |
| Test | **Vitest** (new) + keep `node --test` engine suites + **Playwright** E2E | House standard. |

**Open decisions flagged for your call:** server framework (Hono vs Fastify), auth provider
(WorkOS vs Clerk vs Supabase), cloud (AWS vs GCP vs Fly-native + R2), and the **apply-automation model**
(see §5).

---

## 4. Multi-tenancy & data model

- **Isolation:** `tenant_id` on every table; Postgres **Row-Level Security** enforced at the DB, plus
  authz check at every API entry (CLAUDE.md §4: "every query filters by tenant ID, verified at the
  data-access layer, not the handler").
- **Migration of today's file schema → tables:** `users`, `tenants`, `subscriptions`, `provider_keys`
  (encrypted), `profiles`, `roles`, `applications`, `reports`, `signals`, `status_history`, `audit_log`.
- **Object storage** for report markdown + PDFs (keyed by tenant).
- Forward-only migrations; never edit a shipped migration.

---

## 5. The hard problem — apply automation in the cloud

Running Playwright/Chromium per tenant **server-side** against ATS/LinkedIn/Indeed is a captcha +
cost + **ToS-liability** minefield at scale, and puts your servers' IPs in the firing line.

**DECIDED (Tony, this session):**

- **v1 = assisted-apply, no server-side submit.** The platform produces the tailored CV + cover letter
  + pre-filled answers + posting link; the **user submits** from their own browser. Matches the
  human-in-the-loop doctrine; lowest liability. Grounded in `docs/MISTAKES.md` — the apply automation
  is already brittle on one machine (catch-all field leak, CAPTCHA false-positive, infinite retry,
  verification-code false-positive, no validation gate); running it server-side across many tenants
  multiplies that failure surface and puts datacenter IPs in front of LinkedIn/Indeed ToS enforcement.
- **Roadmap (post-v1), all three layers approved:**
  1. **API submission where the ATS sanctions it** (Greenhouse / Lever / Ashby programmatic apply) —
     clean, no captcha.
  2. **Client-side companion** (browser extension / desktop) — auto-fills on the user's own machine /
     IP / session; automation + liability stay with the user.
  3. **Concierge (human) apply** — premium tier; a human submits on the user's behalf. No bot risk.
- **Positioning = sell the outcome.** Lead with "more, better-targeted applications, zero busywork."
  One-click assisted submit + the companion are the automation story. Do **not** market server-run bots.
  The headline softens from "auto-applies" to "everything up to submit, in one click" — accepted.

---

## 6. Security & compliance (non-negotiable)

- **BYOK custody:** you become custodian of other people's API keys. Envelope encryption, KMS, access
  audit, never logged, never returned to client after entry. Breach = their keys. Treat as crown jewels.
- **Sessions:** httpOnly + secure + sameSite cookies (security rule). Rate-limit auth endpoints.
- **PII / GDPR:** CVs are heavy PII. Need DPA, data export, hard delete, region awareness, retention policy.
- **Legal docs:** commercial **ToS + Privacy Policy + AUP + DPA**, written for a vendor (not the OSS
  disclaimer). Keep human-in-the-loop submit as a **contract term**.
- **EU AI Act:** self-assessment; hosted commercial deployment changes the posture vs local OSS.
- **License:** retain Santiago's MIT attribution block (`LICENSE:102`) — condition of that grant.
- **Gates to add:** lint + typecheck + CodeQL **blocking** in CI; fix the failing CLS test.

---

## 7. Phased roadmap (each phase ends in a human checkpoint)

| Phase | Deliverable | Verification | Infra risk |
|---|---|---|---|
| **0** | This brief approved | Your sign-off | none |
| **1 — BYOK unification** | **Build** a tracked provider chokepoint in the product (`engine/llm/`) that takes **provider + model + apiKey as per-call params** (not `process.env` — required for multi-tenant vault keys); route the four tracked AI scripts + a new programmatic evaluator + cover-letter generator through it; convert `modes/*.md` to prompt templates; fix the dashboard's dependency on gitignored `jobseeker.mjs`; **remove Claude Code from the core loop** | Flows produce equivalent outputs with only a passed key; no Claude Code; no gitignored deps | none (local) |
| **2 — Persistence** | Postgres + Drizzle schema + migrations; data-access layer with `tenant_id`; migrate file reads/writes; object storage for reports/PDFs | Single-user UX unchanged, now DB-backed; migration of sample data round-trips | low |
| **3 — Multi-tenant shell** | Auth provider wired; accounts; sessions; RLS + per-entry authz; tenant isolation tests | Two tenants cannot see each other's data (test proves it) | med |
| **4 — BYOK vault** | KMS envelope encryption; key entry → live validation → rotation UI; spend metering (reuse `second-brain/plugin/spend.mjs`) | Keys never persisted plaintext; validation call works; audit log entries | med (KMS) |
| **5 — Billing** | Stripe checkout + webhooks; plan tiers; entitlement gating (open-core split) | Paid feature locked without active sub; webhook flips entitlement | med |
| **6 — Background jobs** | Queue + workers for scan, Gmail poll, PDF render; off request path | Long jobs don't block API; retries on failure | med |
| **7 — Apply model** | Assisted-apply package generation (server); roadmap layers tracked separately: sanctioned-ATS API submit, client companion, concierge (see §5) | Tailored package generated; **no server-side ATS submission in v1** | low |
| **8 — Trust / legal / ops** | Sentry; audit log; ToS/Privacy/AUP/DPA; GDPR export+delete; per-tenant rate limits; status page | Security review pass; GDPR flows work | med |
| **9 — Hardening & launch** | Load test; pen test; SLOs; runbooks; signed sign-up flow | Validator: zero CRITICAL; pen-test clean | high |

Phases 1–2 carry **zero infra risk** and de-risk everything downstream — that's where we start.

---

## 8. Risk register (top 5)

1. **BYOK key breach** — mitigate: KMS envelope enc, no plaintext, audit, scoped IAM.
2. **Apply automation legal exposure** — mitigate: no server-side submit in v1; human-in-the-loop contract term.
3. **Scope blowout** — mitigate: strict phase gates; ship Phase 1 (local) before any cloud spend.
4. **Cost surprise for BYOK tenants** — mitigate: spend meter + model-tier picker + caps in UI.
5. **Engine/shell impedance** (JS engine ↔ TS shell) — mitigate: typed boundary wrappers + Zod at the seam; don't rewrite the engine.

---

## 9. What I need from you to start (Checkpoint)

1. **Approve this brief** (or redline it).
2. **Decide the flagged stack picks:** server framework, auth provider, cloud/KMS, hosting target.
3. **Approve the apply-automation v1 stance** (assisted-apply, no server-side submit).
4. **Confirm the open-core split** for billing (which features are free vs paid).

On approval, I begin **Phase 1 (BYOK unification)** — local, no infra, reversible — and bring it back
for review before we touch any cloud resources.
