---
description: Bulk referral-application pipeline — scan → fit-score → build → organize (the AECOM end-to-end)
---

# /referral-pipeline — Bulk referral applications

Reusable for any company where a contact supplies referral links or you can scan postings. Read Current Profile in `CLAUDE.md` (fit rule, honesty) first.

1. **Collect** the role links + recruiter name beside each. Resolve a short-link (e.g. smrtr.io) to the real posting id: `node -e 'const r=await fetch("<link>"); console.log(r.url)'` → extract `/<COMPANY>/(\d+)`.
2. **Pull each JD** via the SmartRecruiters detail API (see `/smartrecruiters-scan`); save to `output/<co>/jds/<slug>.md`. Record the recruiter per role in `output/<co>/recruiters.md` — **recruiter names go in the map, NEVER in a cover letter.**
3. **(Optional) Scan the whole catalog** for more fits — `/smartrecruiters-scan`.
4. **Fit-score every candidate** against the user's REAL profile (use `/fanout-score` for many). Rubric:
   - **Strong** — generalist program/project mgmt, controls, scheduling, PMO; skills map directly; PMP accepted; no credential gate.
   - **Moderate** — PM/controls in a new domain that's *learnable context* (not a licensure gate).
   - **Stretch** — needs real domain experience he lacks but NO absolute licensure/degree gate; referral may earn a look.
   - **HardGate** — requires P.Eng / a specific professional-engineering degree / deep domain-engineering that IS the job → skip.
   - Read **required-vs-preferred** carefully: a "Preferred" line that says "is a must" is effectively required. Required **>10yr min** = hard bar; required unrelated domain = skip; 10–12yr "preferred" is fine.
5. **Build CV+CL packages** (`/tailor-package`) only for fits worth pursuing.
6. **Balance by recruiter — don't overload one.** Many roles (esp. a wide $ spread) to one recruiter reads as spray-and-pray and dilutes the referral; trim to a focused ~3–4 each; cut junior/under-valuing and effectively-gated roles.
7. **Organize:** `output/<co>/applications/<N> - <Recruiter> - <Role>/`, numbered & sorted by recruiter. Move cuts to `applications/_excluded/` (don't delete).
8. **Write `output/<co>/APPLY-INDEX.md`** — table (# · recruiter · role · fit · comp · mode · referral link) + recruiter-balance line + excluded list with reasons. (Worked example: `output/aecom/APPLY-INDEX.md` + `FIT-SCAN.md`.)
9. **Tracker:** add entries via TSV → `engine/tracker/merge-tracker.mjs`, never by editing `applications.md`.
