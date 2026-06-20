# Hireloom Landing — SEO + CRO Action Plan

> Acting CMO / CRO / SEO. Built with the SEO Commander discipline:
> **every recommendation has a KPI, a timeline, and an owner.** No drawer reports.
> Companion to `docs/PRODUCT-GTM-STRATEGY.md`. Dates are absolute from 2026-06-20.
> Owners: **Tony** (solo) wearing the role hat named.

---

## Shipped this pass (on-page, in `marketing/`)

**Technical SEO**
- Keyword-weighted `<title>` + meta description (targets "AI job-search engine", "tailored CVs", "get hired").
- `canonical`, `robots` (index,follow,max-image-preview:large), full Open Graph + Twitter `summary_large_image`.
- **JSON-LD `@graph`**: `Organization`, `WebSite`, `SoftwareApplication` (with Free/Pro/Studio `Offer`s), and **`FAQPage`** (the 5 FAQs → eligible for FAQ rich results / CTR lift).
- `robots.txt` + `sitemap.xml`.
- Semantic structure: single `<h1>` (hero), logical `<h2>` order, landmark `<nav>/<section>/<footer>`, `aria-label`ed icons, no emoji-as-icon.

**CRO**
- Persistent **"Get early access"** CTA in nav (conversion always one click away).
- Risk reversal at every decision point: "No credit card · Cancel anytime · Your data stays yours."
- Founder **scarcity**: "first 500 members lock a lifetime discount."
- Single conversion goal (waitlist) reinforced across hero, nav, pricing, final CTA.
- Tagline "Open your horizons. Get hired." (brand ↔ outcome echo).

---

## Open tickets (KPI · timeline · owner)

| # | Ticket | KPI | Deadline | Owner |
|---|---|---|---|---|
| 1 | **Confirm production domain**; update `canonical`, `og:url`, sitemap, JSON-LD `@id`s | All absolute URLs resolve 200 on prod domain | 2026-06-23 | Eng |
| 2 | **Render a real 1200×630 PNG/JPG OG image** (LinkedIn/Facebook don't render SVG OG) and swap `og:image`/`twitter:image` | OG preview renders in LinkedIn Post Inspector + Twitter Card Validator | 2026-06-25 | Design |
| 3 | **Deploy `marketing/` to Vercel/Netlify/Pages**; submit `sitemap.xml` to Google Search Console + Bing | Page live on HTTPS; sitemap submitted; first crawl logged | 2026-06-25 | Eng |
| 4 | **Wire the waitlist endpoint** (Formspree/ConvertKit/own `/api/waitlist`) + double opt-in | Test submission lands in list; conversion event fires | 2026-06-25 | Eng |
| 5 | **Analytics + events**: privacy-friendly analytics (Plausible/PostHog), track hero CTA click, waitlist submit, pricing-toggle, scroll-depth | Funnel visible: visit → CTA → submit | 2026-06-26 | Growth |
| 6 | **Validate structured data** (Google Rich Results Test) | Organization + FAQPage + SoftwareApplication pass, 0 errors | 2026-06-26 | Eng |
| 7 | **Measure Core Web Vitals** (PageSpeed Insights, field + lab) — the canvas bg + Google Fonts are the risk | LCP <2.5s, INP <200ms, CLS <0.1 on mobile | 2026-06-30 | Eng |
| 8 | If CWV fail: self-host fonts (`fonts/` already present, `font-display:swap`), gate particles/canvas on `requestIdleCallback`, cap DPR, lazy-init bg below the fold | All three CWV "Good" in CrUX | 2026-07-14 | Eng |
| 9 | **A/B test the headline**: "Apply to fewer jobs. Get more interviews." vs "Open your horizons. Get hired." | ≥95% confidence on waitlist-submit rate | 2026-07-21 | Growth |

---

## Keyword strategy (intent-classified)

| Cluster | Primary keywords | Intent | Surface |
|---|---|---|---|
| AI job search | "ai job search", "ai job search tool", "ai job application assistant" | Commercial | Title, H1/H2, FAQ |
| Résumé/CV tailoring | "ai resume tailoring", "tailor cv to job description", "ats resume optimizer" | Commercial | Features, FAQ |
| Cover letters | "ai cover letter generator", "truthful cover letter" | Commercial | Features |
| Application tracking | "job application tracker", "job search pipeline" | Commercial | Features |
| BYOK / privacy | "bring your own api key", "private ai job tool", "self-host job search" | Commercial/Info | BYOK band, FAQ |
| Anti-spam angle | "stop mass applying", "quality over quantity job search" | Informational | Problem section, blog (future) |

**Content roadmap (post-launch, compounding channel):** pillar + cluster blog under `/blog` — e.g. pillar "The deliberate job search" with clusters mapping the table above. Target: **publish 2 articles/month, each ranking top-20 within 90 days.** (Owner: Content. Start 2026-07.)

---

## Measurement plan

- **Pre-launch North Star:** waitlist signups (validates willingness-to-pay).
- **Weekly:** signups, visit→signup conversion %, traffic source, top-exit section.
- **Monthly (post-launch):** organic sessions, indexed pages, keyword positions (top-10 count), CWV field data.
- **Conversion baseline to beat:** a cold landing page typically converts 1–3% to waitlist; with founder scarcity + risk reversal, **target ≥5%.**

---

## Next composition (per SEO Commander)

`mantu-copywriting-forge` (SEO-optimised long-form for the blog clusters) →
`mantu-thought-leadership` (POV content on the anti-spam thesis) →
`mantu-growth-engine` (post-launch conversion optimisation on pages receiving organic traffic) →
`mantu-seo-commander` (next quarterly re-audit).
