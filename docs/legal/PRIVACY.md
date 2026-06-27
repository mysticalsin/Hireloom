# Privacy Policy — Hireloom

> **DRAFT — review with counsel before launch.** Effective date: _TBD_.
> This describes how the hosted Hireloom service ("Hireloom", "we") handles your data.

## Who we are
Hireloom is a bring-your-own-key (BYOK) career tool. The data controller is the Hireloom
operator (contact: _privacy@hireloom.app — TBD_). Our processors are listed below.

## What we collect
- **Account data:** email, name, authentication metadata (via Supabase Auth).
- **Career data you provide (PII):** your CV/résumé text, job descriptions you paste,
  generated evaluations, tailored CVs/cover letters, and application drafts.
- **Provider API keys (BYOK):** the keys you add for Anthropic/OpenAI/Gemini/OpenRouter/Kimi.
- **Usage data:** monthly evaluation/package counts, plan/subscription status.
- **Billing data:** handled by Stripe — we store only a customer/subscription reference,
  never your card number.
- **Cookies:** a session cookie/token for authentication. No third-party advertising cookies.

## How your BYOK keys are handled (the important part)
Your provider keys are stored **encrypted in Supabase Vault**. They are **never** written to
application tables, **never** logged, and **never** returned to your browser after you save
them. They are decrypted in memory only at the moment we make an AI call **on your behalf,
with your key, to the provider you chose**. We never sell, share, or use your keys for any
other purpose. You can delete a key at any time in Settings.

## How we use your data
- To run evaluations/tailoring/assisted-apply **on your chosen AI provider using your key**.
- To maintain your account, pipeline, and subscription/quota.
- To secure the service and investigate abuse (see the append-only audit log of sensitive
  actions: key set/get, plan changes, account deletion).
We do **not** train any model on your data, and we do not sell your personal data.

## AI processing & sub-processors
When you run an evaluation, your CV + the job description are sent to the AI provider **you
select**, authenticated with **your** key, subject to **that provider's** terms and privacy
policy. Our processors: **Supabase** (auth, database, vault, storage, edge functions),
**Stripe** (billing), and **your chosen AI provider(s)**. Email is sent via our transactional
email provider (_Resend/Postmark — TBD_).

## Retention & deletion
We keep your data while your account is active. You can erase everything yourself: Settings →
delete account triggers `delete_my_account()`, which removes your auth identity, all your
tenant rows (CVs, roles, reports, tailorings, application drafts), and your Vault key secrets.
Stale job-description/report rows are subject to a retention purge (_policy window TBD_).

## Your rights (GDPR/CCPA)
Access, rectification, erasure, portability (data export), restriction, and objection. EU/UK
users may lodge a complaint with their supervisory authority. Exercise rights in-product or by
contacting us; we respond within applicable statutory timeframes.

## Security
Per-tenant isolation enforced by Postgres Row-Level Security; keys in Vault (encrypted at
rest); TLS in transit; strict Content-Security-Policy; rate-limited auth; append-only audit
log. No system is perfectly secure; we will notify affected users of a qualifying breach as
required by law.

## International transfers
Data may be processed in the regions of our processors (Supabase/Stripe/your AI provider).
Where required, transfers rely on Standard Contractual Clauses or equivalent safeguards.

## Children
Not directed to anyone under 16. We do not knowingly collect their data.

## Changes & contact
We will post changes here and update the effective date. Questions: _privacy@hireloom.app (TBD)_.
