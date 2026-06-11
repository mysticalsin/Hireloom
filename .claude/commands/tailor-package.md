---
description: Produce a one-role tailored CV + cover letter — the user's content at "Kimi density," rendered through the Kimi engine
---

# /tailor-package — Tailored CV + Cover Letter (user's content, Kimi layout)

Assumes only `cv.md` + the JD. Read the user's Current Profile in `CLAUDE.local.md` (honesty limits, claiming rules) first, if it exists.

## 1. Write a content JSON in the exact shape `engine/batch/tailor-engine.mjs` consumes
```json
{
  "title": "<exact role title — headline beside the candidate's name>",
  "summary": "<3–4 sentences; lead with the role-relevant throughline, NOT credentials; end with the candidate's degree line exactly as it appears in cv.md>",
  "experience": [
    {"title":"<Title — Employer>","period":"<dates only>","location":"<City, ST>","bullets":["…most recent role: 5 bullets, ~2 full lines each…"]},
    {"title":"<Title — Employer>","period":"…","location":"…","bullets":["…3…"]}
  ],
  "competencies":"role-tilted, ' · '-separated, all real",
  "tools":"' · '-separated; surface the tools THIS JD values (every one already in cv.md)",
  "coverLetter":["para1 — role + genuine company hook","para2 — 2–3 real achievements mapped to JD priorities","para3 — location/work-mode fit + close"]
}
```
- **Density = 5/3/3/2-3 bullets, ~2 lines each** (this is what makes it "Kimi-length"). Reverse-chron auto-enforced via `cv.experience_order` in `config/profile.yml`.
- **Do NOT include Education or Certifications** — the engine renders them from the `cv:` block in `config/profile.yml` (see `engine/lib/identity.mjs`).

## 2. HONESTY RULES (non-negotiable)
- Only facts/employers/dates/metrics/tools in `cv.md`. For a skill/domain the candidate lacks: omit OR connect with explicit transferable framing ("transferable to…"); never lift the JD phrase as owned experience.
- Mark analogies as analogies: "X-style", "X-grounded *thinking*", "transferable to X" — never present the analogous thing as the thing itself.
- **NEVER claim** anything the user's Current Profile lists as a hard honesty limit (credentials not earned, tools never used hands-on, work not actually done).
- **No "ramping"/"still learning" hedge language** in the document — include a skill as genuine competence or leave it out.
- **Cover letter:** never a recruiter's name; no work-auth/availability sentence unless the user asks. For a paste-in "Message to hiring team": prepend `Dear Hiring Team,`, end `Sincerely,` / the candidate's name.

## 3. Render
```bash
CHROME=$(ls -d "$HOME/Library/Caches/ms-playwright"/chromium*/chrome-mac-arm64/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" 2>/dev/null | head -1)
PW_CHROMIUM_PATH="$CHROME" node engine/render/render-breaktail.mjs "<content.json>" "<outDir>" "<Candidate Name>" breaktail
```
→ `<outDir>/<Candidate Name> - Resume.pdf` + `… - Cover Letter.pdf`. `PW_CHROMIUM_PATH` REQUIRED. `breaktail` forces Edu+Certs+Competencies onto p2 together (omit only if the whole CV already fits one page cleanly).

## 4. Verify
Read the resume PDF (the Read tool renders pages): check the 2-page layout and that every line is honest.
