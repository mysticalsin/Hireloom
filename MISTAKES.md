# MISTAKES.md — Career-Ops

### [2026-05-04] PROCESS: Smoke-tested mutating endpoint against live config dir, overwrote profile.yml
- **What went wrong:** While testing the new `/api/onboard/finalize` endpoint, sent a curl POST with `{"basics":{"full_name":"Test User",...}}` to a server bound to PORT=4748 but with `ROOT` still pointing at the real project. The endpoint did exactly what it was designed to do — wrote `config/profile.yml` with the test payload. The user's real profile (target_roles, archetypes, narrative, comp, deal-breakers) was destroyed. `profile.yml` is gitignored so `git checkout` could not restore it. Reconstructed from external notes but post-snapshot updates may have been lost.
- **Root cause:** Smoke-tested write-mutating endpoint against the live data dir. No backup-before-overwrite safeguard existed in the endpoint to make accidents recoverable.
- **Prevention rule:** (a) NEVER smoke-test write-mutating endpoints against the live data dir — point the server at a temp dir (e.g. `DATA_DIR=$(mktemp -d)`, copy `config/` into it). (b) Endpoints that overwrite user config MUST snapshot the existing file to `{path}.bak.{timestamp}` before writing. (c) Any gitignored config file has no git recovery path — treat as one-of-a-kind data.
- **Files affected:** `config/profile.yml` (overwritten, reconstructed); `dashboard-web/server.mjs` — added backup-before-overwrite to `/api/onboard/finalize`.

### [2026-04-10] BUG: Catch-all pattern filled First Name/Last Name/Email with generic text
- **What went wrong:** The Greenhouse form filler had a catch-all pattern `else if (t.includes('*'))` that matched ANY label containing `*` — including `First Name*`, `Last Name*`, `Email*`. These basic fields got filled with "I bring 8+ years of enterprise IT transformation..." instead of the user's first name, last name, and email. Applications were submitted with garbage in name/email fields.
- **Root cause:** The catch-all for required custom questions used `t.includes('*')` without excluding basic field labels that Phase 3 handles separately. The question-matching loop in Phase 1 runs before Phase 3 (basic fields), so the catch-all overwrote them.
- **Prevention rule:** NEVER use a catch-all pattern that can match standard form fields (first_name, last_name, email, phone, country, resume). Always exclude known field labels from catch-all logic. Test with a real form and verify EVERY field value before submitting.
- **Files affected:** `dashboard-web/server.mjs` — `fillGreenhouseForm()` function

### [2026-04-10] BUG: Verification code detection false positive on Greenhouse forms
- **What went wrong:** The auto-apply engine checked `page.textContent('body')` against `/verification|verify|confirm.*code|enter.*code|OTP/i` after form fill. Standard Greenhouse pages contain "verify" in EEOC/compliance text (e.g., "I verify the above information"), triggering a false 3-minute wait for an email OTP that was never sent.
- **Root cause:** The regex was too broad — it matched any occurrence of "verify" or "verification" anywhere on the page, not just OTP UI elements. This added 3 wasteful minutes per job (8 jobs × 3 min = 24 min wasted per batch).
- **Prevention rule:** Only enter verification code wait if BOTH: (1) an actual code input field exists (`input[name*="code"]`, `input[maxlength="6"]`, etc.) AND (2) the page contains specific "sent code" language (`/we sent|sent a code|enter the code|check your email.*code/i`). Neither condition alone is sufficient.
- **Files affected:** `dashboard-web/server.mjs` — verification check block (~line 605)

### [2026-04-10] BUG: CAPTCHA-blocked submission logged as "Validation: First Name is required"
- **What went wrong:** When Greenhouse form has CAPTCHA that blocks submission, the page shows both the CAPTCHA iframe AND field validation errors. The autopilot's waterfall checked `if (hasErrors > 0)` before the final-attempt CAPTCHA guard, so CAPTCHA-related validation errors were logged as "Validation: First Name*; First Name is required." instead of "CAPTCHA required — needs manual apply".
- **Root cause:** The CAPTCHA check was gated as `if (hasCaptcha > 0 && attempt < 2)` — on attempt 2, this condition was false, so CAPTCHA was not re-checked and the error block ran instead.
- **Prevention rule:** Always check for CAPTCHA BEFORE checking for validation errors in every attempt iteration. On attempt 2+, CAPTCHA should immediately exit with "CAPTCHA required — needs manual apply" and session-skip the app.
- **Files affected:** `dashboard-web/server.mjs` — waterfall submit loop (~line 857)

### [2026-04-10] BUG: Infinite retry loop on CAPTCHA/validation-failed apps
- **What went wrong:** `sessionSkipped` Set only added apps that returned "no form found." Apps that failed validation or hit CAPTCHA were marked `failed` in the log but remained in `Evaluated` status in applications.md (only `Applied` updates the tracker). On the next autopilot cycle, they were re-eligible and retried endlessly, wasting ~3.5min per CAPTCHA app per cycle.
- **Root cause:** Only one failure path (no form) was adding to `sessionSkipped`. The three other failure paths (validation recheck failed, post-submit error waterfall, general exception) were not session-skipping the app.
- **Prevention rule:** Every failure exit path in the autopilot loop MUST call `sessionSkipped.add(String(app.num))` immediately before logging. If the app isn't updating its tracker status to something other than `Evaluated`, it will be retried next cycle unless session-skipped.
- **Files affected:** `dashboard-web/server.mjs` — autopilot loop (~lines 819, 909, 930)

### [2026-04-10] BUG: URL extraction missed annotated URL labels in reports
- **What went wrong:** The regex `/\*\*URL:\*\*\s*(https?:\/\/[^\s|]+)/` only matched exact `**URL:**` headers. Report 152 (Glean) used `**URL (Central):**` — the URL was never extracted, causing fallback to a different URL without standard `#first_name`/`#last_name` IDs, which then failed validation with "First Name is required."
- **Root cause:** URL regex was too strict — didn't account for annotated variants like `(Central)`, `(Primary)`, `(Direct)`, etc.
- **Prevention rule:** URL extraction regex should always allow optional text between `URL` and `:` — use `/\*\*URL[^:*]*:\*\*\s*(https?:\/\/[^\s|]+)/` in all 5 extraction points.
- **Files affected:** `dashboard-web/server.mjs` — URL extraction (~lines 735, 745, 4176, 4186, 4335)

### [2026-04-10] PROCESS: No validation gate before form submission
- **What went wrong:** The autopilot filled forms and immediately submitted without verifying that field values were correct. Wrong data in name/email fields went undetected. No supervisor step existed.
- **Root cause:** The fill → submit pipeline had no read-back verification. The code assumed fills were correct without checking.
- **Prevention rule:** ALWAYS validate form fields by reading them back BEFORE clicking submit. Check: (1) First Name is a short name not a paragraph, (2) Email contains @, (3) Phone is digits, (4) No catch-all leak patterns in basic fields, (5) Resume is attached. Block submission if ANY check fails.
- **Files affected:** `dashboard-web/server.mjs` — added `validateFormBeforeSubmit()` supervisor function

## The tracker backup that walked into a public commit (2026-06-11)

A broad `git add -A` metadata commit swept in `data/applications.md.bak` — a
real tracker backup auto-written by `dedup-tracker.mjs`/`normalize-statuses.mjs`
before they mutate `applications.md`. Two defenses failed at once:

1. `.gitignore` listed *specific* data/ filenames (`data/applications.md`, …)
   instead of the directory or the `*.bak` class — the backup wasn't on the list.
2. The pre-commit PII grep checked for the user's name/phone/address — tracker
   rows contain company names, recruiter names, and statuses, none of which
   match those patterns. The scan passed; the personal data shipped anyway.

Remediation took a 13-commit history rewrite (`git filter-branch --index-filter`)
plus a force-push. **Lessons, now enforced:** `*.bak` / `*.bak.*` are ignored
repo-wide; PII scans must ALSO flag any staged path under user-layer dirs
(`data/`, `reports/`, `output/`, `interview-prep/`, `jds/`) — match on
*where it lives*, not just *what it says*.
