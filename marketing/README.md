# Hireloom — Marketing Landing

Self-contained static landing page (no build step). Brand-on, SEO + CRO tuned.
See `../docs/SEO-CRO-PLAN.md` for the KPI'd backlog and `../docs/PRODUCT-GTM-STRATEGY.md`
for positioning and pricing.

## Files

- `index.html` — the page (HTML + inline CSS/JS, Google Fonts, generative bg)
- `favicon.svg`, `og-image.svg` — brand assets
- `robots.txt`, `sitemap.xml` — crawl files
- `vercel.json` — static hosting config (security headers, caching, clean URLs)

## Deploy (Vercel — recommended)

Root directory = `marketing/`. No framework, no build command.

```bash
# from repo root, one-time
npm i -g vercel
vercel --cwd marketing            # preview
vercel --cwd marketing --prod     # production
```

Or import the repo in the Vercel dashboard and set **Root Directory = `marketing`**,
**Framework Preset = Other**, build command empty, output dir `.`.

Netlify equivalent: publish directory `marketing`, no build command.

## Go-live checklist (only these need you)

1. **Domain** — point your domain at the host. Then replace `https://hireloom.app/`
   in `index.html` (`canonical`, `og:url`, JSON-LD `@id`s) and `sitemap.xml`/`robots.txt`.
2. **Waitlist endpoint** — create a form (Formspree / ConvertKit / Buttondown / own
   `/api/waitlist`) and paste its URL into `WAITLIST_ENDPOINT` in `index.html`
   (search the `<script>`). Without it, submissions fall back to `localStorage`.
3. **OG image PNG** — render a 1200×630 PNG from `og-image.svg` (LinkedIn/Facebook
   don't render SVG OG cards) and point `og:image`/`twitter:image` at it.
4. **Search Console** — add the property, submit `sitemap.xml`, request indexing.
5. **Analytics** — add a privacy-friendly tag (Plausible/PostHog) and track:
   hero CTA click, waitlist submit, pricing-toggle, scroll-depth.

## Hardening backlog (post-launch)

- Move inline `<script>`/`<style>` to external files + add a strict CSP header in
  `vercel.json` (omitted now because inline assets need `unsafe-inline`).
- Validate structured data (Google Rich Results Test) and CWV (PageSpeed Insights);
  self-host fonts + gate the canvas if CWV is not all "Good". See `../docs/SEO-CRO-PLAN.md`.
