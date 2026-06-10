---
description: Company-wide role scan via the SmartRecruiters public API (for JS-rendered careers sites)
---

# /smartrecruiters-scan — Company-wide role scan via the SmartRecruiters API

Use when a careers site is JS-rendered (a plain WebFetch returns empty — e.g. aecom.jobs). The shell has network access (curl / node fetch work).

- **Company id** = the slug in `jobs.smartrecruiters.com/<ID>/…` (AECOM = `AECOM2`).
- **List** (paginate; max 100/page; stop at `totalFound`):
  `https://api.smartrecruiters.com/v1/companies/<ID>/postings?limit=100&offset=<N>&country=ca`
  Each posting: `id`, `name`, `location.{city,region,country,hybrid,remote,fullLocation}`, `function.label`, `experienceLevel.label`.
- **Detail JD** (JSON): `https://api.smartrecruiters.com/v1/companies/<ID>/postings/<id>`
  → `jobAd.sections.{jobDescription,qualifications,additionalInformation}.text` (HTML — strip tags).
- **Public URL** (apply/referral): `https://jobs.smartrecruiters.com/<ID>/<id>`.
- **Template script:** `output/aecom/_scan-gta-pm.mjs` — paginates all CA postings, filters to a city set + a title/function regex, writes `_scan-gta-pm-roles.json`, prints a list. Copy it, adjust the city set / regex, `node` it.
