# Hireloom — Product & Go-To-Market Strategy

> Owner: Tony Walteur. Decisions made as acting PM + marketing lead, this session.
> Companion to `docs/HOSTED-PLATFORM-BRIEF.md` (the engineering program).
> Prices/numbers are proposed defaults — tunable, but defensible. This file is the
> source of truth for *what we sell and to whom*; the brief is *how we build it*.

---

## 1. The one-line positioning

**Apply to fewer jobs. Get more interviews.**

Hireloom is the anti-spam job-search engine: it scores every role against your real
CV, writes a *truthful* tailored CV + cover letter only for the ones worth it, tracks
the whole pipeline, and reads your inbox so nothing slips. Bring your own AI key —
we never mark up a token.

This deliberately rejects the category's dominant pitch ("auto-apply to 1,000 jobs").
That pitch burns recruiter goodwill and the candidate's reputation. We sell the
**outcome** (interviews from roles that actually fit), not the **activity** (volume).

---

## 2. Ideal customer profile (who pays)

**Primary:** mid-to-senior knowledge workers running a *deliberate* search —
software engineers, PMs, AI/ML, data, design, and adjacent. They have a real CV,
specific targets, and a strong opportunity cost. A better offer is worth
$10k–$50k+ to them, so $29/mo is a rounding error.

**Secondary:** career switchers and ops/strategy/consulting folks (the origin user's
own archetype). Exec/leadership = concierge upsell.

**Not the ICP (v1):** new-grad mass-appliers chasing volume. That's LoopCV/Sonara's
market and it's a race to the bottom we don't want.

**Why they pay monthly:** an active job search is a 1–4 month sprint. The pipeline +
inbox signals create switching cost during the search; the tailoring quality creates
the "I'm not going back to a blank doc" lock-in. Churn-after-hire is fine and expected
— win-back on the next search.

---

## 3. Wedge & moat

- **Wedge:** *truthful* tailoring + fit-scoring. Every other tool either mass-applies
  or keyword-stuffs. Hireloom's doctrine (no invented metrics, real record only) is a
  feature, not a limitation — it's the difference between a CV that survives a human
  read and one that gets the candidate caught.
- **BYOK cost transparency:** "your keys, your data, your cost — we never mark up
  tokens." This is both a trust signal and a structural margin advantage (our COGS on
  inference ≈ $0). It lets us undercut markup-based competitors and still print money.
- **Brand:** "a quiet career atelier." Premium, calm, anti-slop — a deliberate
  counter-position to the loud, spammy category. Defensible on taste.
- **Open-core flywheel:** the self-hosted OSS is the top of funnel and the trust
  proof; the hosted platform is the convenience + premium tier.

---

## 4. Packaging & pricing (monthly subscription, BYOK)

COGS ≈ $0 (user pays inference) → aggressive pricing + fat margin.

| Tier | Price (monthly) | Annual (−20%) | For | Includes |
|---|---|---|---|---|
| **Free** | $0 | — | Try it / light search | Hosted, BYOK. 10 role evaluations/mo, 3 tailored packages/mo, pipeline tracker |
| **Pro** | **$29** | $23/mo | The core job-seeker | Unlimited evaluations + truthful tailored CVs & cover letters, Gmail inbox signals, follow-up radar, full pipeline, one-click assisted apply |
| **Studio** | **$79** | $63/mo | Power users / always-on | Everything in Pro + autopilot scanning, Second Brain (Obsidian), interview prep, priority support, early access to the apply companion |
| **Concierge** | from $199 / search | — | Execs / time-poor | Human-assisted applications on the user's behalf (high-margin service tier) |

- **14-day Pro trial**, no card for Free.
- **Self-hosted OSS stays free forever** (BYOK) — the open-core promise. Hosted =
  convenience + premium features.
- Founder/annual launch discount to seed reviews + testimonials.

**Rationale vs market:** Teal $9–29, Careerflow/Huntr similar, LoopCV/Sonara $20–60
for mass auto-apply. We sit at Pro $29 with a *better* value story (quality + BYOK
transparency) and a premium Studio/Concierge ladder the others don't have.

---

## 5. Messaging pillars (for site, ads, onboarding)

1. **Quality over volume** — "None of them spam." Fewer, sharper applications.
2. **Truthful tailoring** — "Your real record, sharpened. Never invented."
3. **You're always in control** — "We draft everything up to submit. You click send."
   (Backs the assisted-apply v1 decision; honest, no bot promises.)
4. **Bring your own key** — "Your keys, your data, your cost. No token markup."
5. **The whole search in one place** — score, tailor, track, follow up, prep.

Voice: calm, precise, a little contrarian. Opinionated copy, never "empower your
workflow." Atelier, not factory.

---

## 6. Funnel & metrics

- **Top of funnel:** open-source repo + the landing page (`marketing/`) + content
  (the origin story: 740+ offers evaluated, Head of Applied AI landed).
- **Activation (the number that matters):** first *truthful tailored package*
  generated within 24h of signup. That's the aha.
- **North Star:** interviews landed per active user.
- **Conversion:** Free → Pro when the user hits the evaluation/package cap mid-search
  (cap is set to bite exactly when they're getting value).
- **Retention:** pipeline + inbox lock-in during the active search.
- **Pre-launch validation:** waitlist + "reserve founder pricing" on the landing page
  to measure willingness-to-pay *before* the infra is built.

---

## 7. Sellable-MVP scope (what must exist to charge)

Smallest thing people will pay monthly for, mapped to the engineering brief:

1. Account + login (Phase 3 auth).
2. BYOK key entry + validation + encrypted storage (Phase 4 vault) — the `validateKey`
   chokepoint already exists.
3. The core loop on the user's key: **evaluate → truthful tailored package → pipeline**
   (Phase 1 unification + Phase 2 persistence).
4. Stripe subscription + Free/Pro gating (Phase 5).
5. Hosted, with the trust basics: ToS/Privacy, Sentry, GDPR delete/export (Phase 8).

Gmail signals, autopilot, Second Brain, companion apply = fast-follows, not launch
blockers. **Concierge** can launch as a manual/email offer day one (no code).

---

## 8. Launch sequence

1. **Now:** landing page live + waitlist + founder-pricing reservation (validate demand).
2. **Build** the sellable MVP (brief Phases 1–5, 8) against real waitlist feedback.
3. **Private beta** to waitlist at founder pricing → collect testimonials + the
   activation/retention data.
4. **Public launch** (Product Hunt / HN / the OSS audience) with the quality-not-volume
   narrative and real proof points.
5. **Expand** apply automation (companion, sanctioned-ATS API) + Concierge productization.
