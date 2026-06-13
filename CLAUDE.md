# Hireloom -- Career Atelier

> *heir + loom · a quiet career atelier*

This is **Hireloom** end-to-end — the brand, the npm package (`hireloom`),
the CLI bin (`hireloom` with `career-ops` retained as a backwards-compat
alias), the EXE, and the dashboard. The slash commands (`/career-ops scan`,
etc.) keep their legacy names for muscle-memory and so existing automations
don't break, but everything human-facing reads as Hireloom.

## Origin

The engine was battle-tested in a real career search: 740+ job offers evaluated, 100+ tailored CVs generated, and a Head of Applied AI role landed. The archetypes, scoring logic, negotiation scripts, and proof point structure all reflect that original search in AI/automation roles.

**It will work out of the box, but it's designed to be made yours.** If the archetypes don't match your career, the modes are in the wrong language, or the scoring doesn't fit your priorities -- just ask. You (AI Agent) can edit the user's files. The user says "change the archetypes to data engineering roles" and you do it. That's the whole point.

## Data Contract (CRITICAL)

There are two layers. Read `docs/DATA_CONTRACT.md` for the full list.

**User Layer (NEVER auto-updated, personalization goes HERE):**
- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `article-digest.md`, `portals.yml`
- `data/*`, `reports/*`, `output/*`, `interview-prep/*`
- Memory layer: `CLAUDE.local.md`, `WORKING.md`, `career-log.md`, `TOOLKIT.md`, `BUILD-CHANGELOG.md`
- Second-brain outputs: `BUILD-PROFILE.md`, `BUILD-LOG.md`, `_brain_*`, `_agent_state/`, `.obsidian/*`

**System Layer (auto-updatable, DON'T put user data here):**
- `modes/_shared.md`, `modes/oferta.md`, all other modes
- `CLAUDE.md`, `*.mjs` scripts, `apps/tui/*`, `templates/*`, `engine/batch/*`

**THE RULE: When the user asks to customize anything (archetypes, narrative, negotiation scripts, proof points, location policy, comp targets), ALWAYS write to `modes/_profile.md` or `config/profile.yml`. NEVER edit `modes/_shared.md` for user-specific content.** This ensures system updates don't overwrite their customizations.

## Update Check

On the first message of each session, run the update checker silently:

```bash
node engine/update-system.mjs check
```

Parse the JSON output:
- `{"status": "update-available", "local": "1.0.0", "remote": "1.1.0", "changelog": "..."}` → tell the user:
  > "career-ops update available (v{local} → v{remote}). Your data (CV, profile, tracker, reports) will NOT be touched. Want me to update?"
  If yes → run `node engine/update-system.mjs apply`. If no → run `node engine/update-system.mjs dismiss`.
- `{"status": "up-to-date"}` → say nothing
- `{"status": "dismissed"}` → say nothing
- `{"status": "offline"}` → say nothing

The user can also say "check for updates" or "update career-ops" at any time to force a check.
To rollback: `node engine/update-system.mjs rollback`

## What is career-ops

AI-powered job search automation built on Claude Code: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing.

### Main Files

| File | Function |
|------|----------|
| `data/applications.md` | Application tracker |
| `data/pipeline.md` | Inbox of pending URLs |
| `data/scan-history.tsv` | Scanner dedup history |
| `portals.yml` | Query and company config |
| `templates/cv-template.html` | HTML template for CVs |
| `engine/render/generate-pdf.mjs` | Playwright: HTML to PDF |
| `article-digest.md` | Compact proof points from portfolio (optional) |
| `interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations |
| `interview-prep/{company}-{role}.md` | Company-specific interview intel reports |
| `engine/tracker/analyze-patterns.mjs` | Pattern analysis script (JSON output) |
| `engine/tracker/followup-cadence.mjs` | Follow-up cadence calculator (JSON output) |
| `data/follow-ups.md` | Follow-up history tracker |
| `engine/scan/scan.mjs` | Zero-token portal scanner — hits Greenhouse/Ashby/Lever APIs directly, zero LLM cost |
| `engine/scan/check-liveness.mjs` | Job posting liveness checker |
| `engine/scan/liveness-core.mjs` | Shared liveness logic (expired signals win over generic Apply text) |
| `engine/doctor.mjs` | Setup validation — JSON output for CI/scripts |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`). Blocks A-F + G (Posting Legitimacy). Header includes `**Legitimacy:** {tier}`. |

### Unified Role Directory — ONE registry, no orphan queues (CRITICAL)

Every role the user has ever touched — applied, evaluated, ranked, or merely
scanned — lives in **one** unified directory, built by
`apps/web/lib/role-index.mjs` and surfaced as **All Roles** in the dashboard
(a gapless `1→N` catalog where every row clicks through to an all-in-one role
page). The registry ingests **six lanes** and de-duplicates across them by
normalized company + title (key prefix in parens):

- **tracker** (`t`) — `data/applications.md`
- **pool** (`p`) — `output/pool-apply-order.json` (the ranked 350)
- **aviation** (`v`) — `output/applications-aviation/`
- **aecom** (`a`) — `output/aecom/applications/`
- **indeed** (`i`) — `output/indeed-apply-order.json` (the old 50)
- **loose** (`x`) — any other `output/applications/*` folder

`loadLanes(rootDir)` reads them; `buildRoleIndex(...)` joins duplicates (a role
in two pipelines collapses to one entry, every original key still resolves).
User edits live in `data/role-overrides.json` (applied last; tracker status
stays canonical in `applications.md`).

**THE RULE (going forward, for every user):** never spin up a new parallel
queue/folder convention that the directory can't see. When you add a role —
from a pasted URL, a pasted JD, a scan, an apply run, or the dashboard's
**Create Role** form — it MUST end up in one of the six lanes above so it
appears in the one directory, deduped, JD-paired, with a complete role page.
If a genuinely new pipeline shape is unavoidable, **register it as a lane in
`loadLanes` (and add its key prefix to `ROLE_KEY_RE`)** in the same change — do
not let it become an orphan the directory misses. Gather everything a complete
role page needs at add-time: company, role, status, the local JD, comp, and the
application folder/CV/cover paths.

### Other CLIs (OpenCode, Codex, Gemini, Qwen)

`AGENTS.md` is the canonical cross-CLI rulebook, and the career-ops skill ships in the open agent skill standard format (`.agents/skills/`, `.qwen/skills/`, mirroring `.claude/skills/`). The `modes/*` files are shared by every platform — on any CLI, invoke a mode by asking for it by name (`scan`, `oferta`, `pdf`, `apply`, …).

### First Run — Onboarding (IMPORTANT)

**Before doing ANYTHING else, check if the system is set up.** Run these checks silently every time a session starts:

1. Does `cv.md` exist?
2. Does `config/profile.yml` exist (not just profile.example.yml)?
3. Does `modes/_profile.md` exist (not just _profile.template.md)?
4. Does `portals.yml` exist (not just templates/portals.example.yml)?

If `modes/_profile.md` is missing, copy from `modes/_profile.template.md` silently. This is the user's customization file — it will never be overwritten by updates.

**If ANY of these is missing, enter onboarding mode.** Do NOT proceed with evaluations, scans, or any other mode until the basics are in place. Guide the user step by step:

#### Step 0: Read the README (fresh install)
On a fresh install (any of the four files above missing), **read `README.md` in full BEFORE saying anything to the user** — it is the product tour: what Hireloom does, the modes, the dashboard, the data contract. You cannot onboard someone into a product you haven't read the front door of. Then greet the user with a one-paragraph "here's what this is and here's what I need from you" grounded in it. (On an already-set-up install, skip this — the rulebooks and the user's own files are the context.)

#### Step 1: CV (required)
If `cv.md` is missing, ask:
> "I don't have your CV yet. You can either:
> 1. Paste your CV here and I'll convert it to markdown
> 2. Paste your LinkedIn URL and I'll extract the key info
> 3. Tell me about your experience and I'll draft a CV for you
>
> Which do you prefer?"

Create `cv.md` from whatever they provide. Make it clean markdown with standard sections (Summary, Experience, Projects, Education, Skills).

#### Step 2: Profile (required)
If `config/profile.yml` is missing, copy from `config/profile.example.yml` and then ask:
> "I need a few details to personalize the system:
> - Your full name and email
> - Your location and timezone
> - What roles are you targeting? (e.g., 'Senior Backend Engineer', 'AI Product Manager')
> - Your salary target range
>
> I'll set everything up for you."

Fill in `config/profile.yml` with their answers. For archetypes and targeting narrative, store the user-specific mapping in `modes/_profile.md` or `config/profile.yml` rather than editing `modes/_shared.md`.

#### Step 3: Portals (recommended)
If `portals.yml` is missing:
> "I'll set up the job scanner with 45+ pre-configured companies. Want me to customize the search keywords for your target roles?"

Copy `templates/portals.example.yml` → `portals.yml`. If they gave target roles in Step 2, update `title_filter.positive` to match.

#### Step 4: Tracker
If `data/applications.md` doesn't exist, create it:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

#### Step 5: Get to know the user (important for quality)

After the basics are set up, proactively ask for more context. The more you know, the better your evaluations will be:

> "The basics are ready. But the system works much better when it knows you well. Can you tell me more about:
> - What makes you unique? What's your 'superpower' that other candidates don't have?
> - What kind of work excites you? What drains you?
> - Any deal-breakers? (e.g., no on-site, no startups under 20 people, no Java shops)
> - Your best professional achievement — the one you'd lead with in an interview
> - Any projects, articles, or case studies you've published?
>
> The more context you give me, the better I filter. Think of it as onboarding a recruiter — the first week I need to learn about you, then I become invaluable."

Store any insights the user shares in `config/profile.yml` (under narrative), `modes/_profile.md`, or in `article-digest.md` if they share proof points. Do not put user-specific archetypes or framing into `modes/_shared.md`.

**After every evaluation, learn.** If the user says "this score is too high, I wouldn't apply here" or "you missed that I have experience in X", update your understanding in `modes/_profile.md`, `config/profile.yml`, or `article-digest.md`. The system should get smarter with every interaction without putting personalization into system-layer files.

#### Step 6: Ready
Once all files exist, confirm:
> "You're all set! You can now:
> - Paste a job URL to evaluate it
> - Run `/career-ops scan` to search portals
> - Run `/career-ops` to see all commands
>
> Everything is customizable — just ask me to change anything.
>
> Tip: Having a personal portfolio dramatically improves your job search. If you don't have one yet, consider building a simple portfolio site and linking it in your profile."

Then suggest automation:
> "Want me to scan for new offers automatically? I can set up a recurring scan every few days so you don't miss anything. Just say 'scan every 3 days' and I'll configure it."

If the user accepts, use the `/loop` or `/schedule` skill (if available) to set up a recurring `/career-ops scan`. If those aren't available, suggest adding a cron job or remind them to run `/career-ops scan` periodically.

### Personalization

This system is designed to be customized by YOU (AI Agent). When the user asks you to change archetypes, translate modes, adjust scoring, add companies, or modify negotiation scripts -- do it directly. You read the same files you use, so you know exactly what to edit.

**Common customization requests:**
- "Change the archetypes to [backend/frontend/data/devops] roles" → edit `modes/_profile.md` or `config/profile.yml`
- "Translate the modes to English" → edit all files in `modes/`
- "Add these companies to my portals" → edit `portals.yml`
- "Update my profile" → edit `config/profile.yml`
- "Change the CV template design" → edit `templates/cv-template.html`
- "Adjust the scoring weights" → edit `modes/_profile.md` for user-specific weighting, or edit `modes/_shared.md` and `engine/batch/batch-prompt.md` only when changing the shared system defaults for everyone

### Language Modes

Default modes are in `modes/` (English). Additional language-specific modes are available:

- **German (DACH market):** `modes/de/` — native German translations with DACH-specific vocabulary (13. Monatsgehalt, Probezeit, Kündigungsfrist, AGG, Tarifvertrag, etc.). Includes `_shared.md`, `angebot.md` (evaluation), `bewerben.md` (apply), `pipeline.md`.
- **French (Francophone market):** `modes/fr/` — native French translations with France/Belgium/Switzerland/Luxembourg-specific vocabulary (CDI/CDD, convention collective SYNTEC, RTT, mutuelle, prévoyance, 13e mois, intéressement/participation, titres-restaurant, CSE, portage salarial, etc.). Includes `_shared.md`, `offre.md` (evaluation), `postuler.md` (apply), `pipeline.md`.
- **Japanese (Japan market):** `modes/ja/` — native Japanese translations with Japan-specific vocabulary (正社員, 業務委託, 賞与, 退職金, みなし残業, 年俸制, 36協定, 通勤手当, 住宅手当, etc.). Includes `_shared.md`, `kyujin.md` (evaluation), `oubo.md` (apply), `pipeline.md`.

**When to use German modes:** If the user is targeting German-language job postings, lives in DACH, or asks for German output. Either:
1. User says "use German modes" → read from `modes/de/` instead of `modes/`
2. User sets `language.modes_dir: modes/de` in `config/profile.yml` → always use German modes
3. You detect a German JD → suggest switching to German modes

**When to use French modes:** If the user is targeting French-language job postings, lives in France/Belgium/Switzerland/Luxembourg/Quebec, or asks for French output. Either:
1. User says "use French modes" → read from `modes/fr/` instead of `modes/`
2. User sets `language.modes_dir: modes/fr` in `config/profile.yml` → always use French modes
3. You detect a French JD → suggest switching to French modes

**When to use Japanese modes:** If the user is targeting Japanese-language job postings, lives in Japan, or asks for Japanese output. Either:
1. User says "use Japanese modes" → read from `modes/ja/` instead of `modes/`
2. User sets `language.modes_dir: modes/ja` in `config/profile.yml` → always use Japanese modes
3. You detect a Japanese JD → suggest switching to Japanese modes

**When NOT to:** If the user applies to English-language roles, even at French, German, or Japanese companies, use the default English modes.

### Skill Modes

| If the user... | Mode |
|----------------|------|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) |
| Asks to evaluate offer | `oferta` |
| Asks to compare offers | `ofertas` |
| Wants LinkedIn outreach | `contacto` |
| Asks for company research | `deep` |
| Preps for interview at specific company | `interview-prep` |
| Wants to generate CV/PDF | `pdf` |
| Evaluates a course/cert | `training` |
| Evaluates portfolio project | `project` |
| Asks about application status | `tracker` |
| Fills out application form | `apply` |
| Searches for new offers | `scan` |
| Processes pending URLs | `pipeline` |
| Batch processes offers | `batch` |
| Asks about rejection patterns or wants to improve targeting | `patterns` |
| Asks about follow-ups or application cadence | `followup` |

### CV Source of Truth

- `cv.md` in project root is the canonical CV
- `article-digest.md` has detailed proof points (optional)
- **NEVER hardcode metrics** -- read them from these files at evaluation time

---

## Ethical Use -- CRITICAL

**Hireloom automates applying -- it must never automate carelessness.** Auto-application is the product's headline feature; what we prevent is rushed or inaccurate applying, not volume. Volume is legitimate exactly when every package going out is truthful and properly aimed.

- **Automation runs only when the user launches it.** The auto-applier covers roles the user selected (by hand or by score floor), after dry runs they watched and approved. Outside that approved flow -- assisted apply, outreach, follow-ups -- fill forms, draft answers, generate PDFs, but always STOP before Submit/Send. The user makes the final call.
- **Truthful tailoring, always.** Every CV, cover letter, and form answer comes from the user's real record. No invented metrics, no skills they don't have, no guessed work-authorization answers.
- **Never force a flow.** If an application can't be completed cleanly (captcha, broken form, unfamiliar ATS), pause and hand it to the user rather than bulldozing it or silently marking it done. The user may ask to defer stuck roles to the end of a run and let the fully-autonomous ones go first.
- **Respect the score.** Below 4.0/5, recommend against applying and say why -- recruiter attention is real, and low-fit volume helps no one. The user can override with a reason.

---

## Offer Verification -- MANDATORY

**NEVER trust WebSearch/WebFetch to verify if an offer is still active.** ALWAYS use Playwright:
1. `browser_navigate` to the URL
2. `browser_snapshot` to read content
3. Only footer/navbar without JD = closed. Title + description + Apply = active.

**Exception for batch workers (`claude -p`):** Playwright is not available in headless pipe mode. Use WebFetch as fallback and mark the report header with `**Verification:** unconfirmed (batch mode)`. The user can verify manually later.

---

## CI/CD and Quality

- **GitHub Actions** run on every PR: `engine/test-all.mjs` (63+ checks), auto-labeler (risk-based: 🔴 core-architecture, ⚠️ agent-behavior, 📄 docs), welcome bot for first-time contributors
- **Branch protection** on `main`: status checks must pass before merge. No direct pushes to main (except admin bypass).
- **Dependabot** monitors npm, Go modules, and GitHub Actions for security updates
- **Contributing process**: issue first → discussion → PR with linked issue → CI passes → maintainer review → merge

## Community and Governance

- **Code of Conduct**: Contributor Covenant 2.1 with enforcement actions (see `.github/CODE_OF_CONDUCT.md`)
- **Governance**: BDFL model with contributor ladder — Participant → Contributor → Triager → Reviewer → Maintainer (see `.github/GOVERNANCE.md`)
- **Security**: private vulnerability reporting via email (see `.github/SECURITY.md`)
- **Support**: help questions go to Discord/Discussions, not issues (see `.github/SUPPORT.md`)
- **Discord**: https://discord.gg/3jEjwygjNG

## Stack and Conventions

- Node.js (mjs modules), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data), Canva MCP (optional visual CV)
- Scripts in `.mjs`, configuration in YAML
- Output in `output/` (gitignored), Reports in `reports/`
- JDs in `jds/` (referenced as `local:jds/{file}` in pipeline.md)
- Batch in `engine/batch/` (gitignored except scripts and prompt)
- Report numbering: sequential 3-digit zero-padded, max existing + 1
- **RULE: After each batch of evaluations, run `node engine/tracker/merge-tracker.mjs`** to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.

### TSV Format for Tracker Additions

Write one TSV file per evaluation to `engine/batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT -- status BEFORE score):**
1. `num` -- sequential number (integer)
2. `date` -- YYYY-MM-DD
3. `company` -- short company name
4. `role` -- job title
5. `status` -- canonical status (e.g., `Evaluated`)
6. `score` -- format `X.X/5` (e.g., `4.2/5`)
7. `pdf` -- `✅` or `❌`
8. `report` -- markdown link `[num](reports/...)`
9. `notes` -- one-line summary

**Note:** In applications.md, score comes BEFORE status. The merge script handles this column swap automatically.

### Pipeline Integrity

1. **NEVER edit applications.md to ADD new entries** -- Write TSV in `engine/batch/tracker-additions/` and `engine/tracker/merge-tracker.mjs` handles the merge.
2. **YES you can edit applications.md to UPDATE status/notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF). Include `**Legitimacy:** {tier}` (see Block G in `modes/oferta.md`).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `node engine/tracker/verify-pipeline.mjs`
6. Normalize statuses: `node engine/tracker/normalize-statuses.mjs`
7. Dedup: `node engine/tracker/dedup-tracker.mjs`

### Canonical States (applications.md)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company responded |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Discarded by candidate or offer closed |
| `SKIP` | Doesn't fit, don't apply |

**RULES:**
- No markdown bold (`**`) in status field
- No dates in status field (use the date column)
- No extra text (use the notes column)

## Testing

```bash
npm test                                # 222 unit tests across tests/
node --test tests/onboard.test.mjs      # run a single suite
```

Tests cover the pure helpers in `apps/web/lib/` and `lib/`:
- `onboard.mjs` — `yamlQuote`, `validateOnboardPayload`, `serializeProfileYaml`, `extractProfileFromResume`, `kebabCase`
- `path-safety.mjs` — `makeSafeResolver` (path-traversal defense for `/reports/*` and `getCompForReport`)
- `engine/lib/identity.mjs` — candidate identity for the renderers (`tests/identity.test.mjs`)
- `engine/lib/profile-check.mjs` — doctor's profile.yml content validation (`tests/profile-check.test.mjs`)
- plus http-utils, gmail-status, error-log, backup/restore, and rate-limit/CSRF e2e suites

When you change any of these, run the suite. Smoke-tests of mutating endpoints MUST point at a tmp config dir, not the real one — see [docs/MISTAKES.md](docs/MISTAKES.md) for the cautionary tale:

```bash
TEST_CFG=$(mktemp -d)
PORT=4749 HOST=127.0.0.1 CONFIG_DIR="$TEST_CFG" node apps/web/server.mjs
```

## Onboarding wizard

The `⊕ Profile` button opens a 6-step wizard (`apps/web/server.mjs` → `openOnboard()` → `wizGoTo(1..6)`):

1. **Resume** — drop `.txt`/`.md` or paste; PDFs trigger a "Open in tab → ⌘+A → ⌘+C" assist with auto-paste detection.
2. **Confirm basics** — name/email/phone/location/linkedin/headline pre-filled from extraction; user edits.
3. **Roles + comp** — chip multi-select (16 presets) + free-text additions + comp range/min/currency/location-pref.
4. **Deal-breakers + work authorization** — chip multi-select (9 presets) + free-text additions; plus the two questions every application asks ("Are you legally authorized to work?", "Do you require sponsorship?") and an optional permit/visa-type field. The autopilot uses these directly; leave any of them blank to make the autopilot skip the corresponding form field rather than guess.
5. **Narrative** — 3 superpower bullets, one best-achievement, repeatable proof-points (name + URL + hero-metric).
6. **Review** — structured summary, one CTA writes `config/profile.yml` (snapshot to `.bak.{timestamp}` first; rotation keeps newest 10) and kicks off CV PDF generation in the background.

Detect-existing-profile: `/api/onboard/profile-summary` is fetched on open; if a substantive profile exists, a banner warns the user that re-running will overwrite (with backup). Empty-state banner appears when extraction yields < 3 fields. A11y: `role=dialog`, `aria-modal`, `aria-labelledby`, focus trap, Escape closes, Enter advances, chips carry `aria-pressed` and activate on Enter/Space.

---

# Second Brain (optional built-in feature)

Hireloom includes an agent-built **Second Brain**: live Obsidian dashboards
over the user's real pipeline — applications kanban, apply queue, follow-up
radar, upcoming interviews — with zero new data entry. The complete build
instruction set is `second-brain/BUILD-SPEC.md`.

**Trigger:** the user says "set up my second brain", "build the dashboard",
mentions Obsidian dashboards, or invokes `/second-brain` → follow
`.claude/commands/second-brain.md`, which reads `second-brain/BUILD-SPEC.md`
(self-contained: design laws, phases, the tab-binding contract, self-test).
Phase 0 derives the user's profile from `config/profile.yml` and
`templates/states.yml` — only four taste/hardware questions get asked.

The spec is system layer; everything the build GENERATES for the user
(`BUILD-PROFILE.md`, `BUILD-LOG.md`, `_brain_*`, `_agent_state/`, the built
plugin, `.obsidian/`) is user layer and gitignored.

---

# Personal Memory System (per-user, local — NEVER committed)

*Ships with Hireloom as machinery; each user's content stays on their machine. All memory files are plain, Obsidian-friendly markdown (dated entries `YYYY-MM-DD`, `[[wiki-links]]` for skills/roles, tags `#skill` `#role` `#milestone` `#preference-change`) — the project folder doubles as an Obsidian vault if the user wants it.*

## The files (all gitignored — personal data never enters the repo)

| File | Role |
|------|------|
| `CLAUDE.local.md` | **The user's personal layer** (auto-loaded by Claude Code every session): a **Current Profile** section (who they are — identity, experience, skills with honest internal depth, targets, preferences, rules) and a **How to work with me** section (voice, what frustrates them, what they respond well to). The Current Profile is the source of truth and is **overwritten in place** when facts change — never keep old versions. |
| `WORKING.md` | **The one live state file** — overwritten at every checkpoint, never appended. What's done, what's mid-flight, exact next steps, open problems. |
| `career-log.md` | **Append-only** dated history of learning and preference changes — narrative material, never current fact. |
| `TOOLKIT.md` | Curated, annotated map of the local files/tools/methods. Before inferring or web-searching how something works, read the actual local file it points to. |

**Wiring:** `CLAUDE.local.md` Current Profile is authoritative; `career-log.md` is history only; `WORKING.md` is the only live-state file. The user may edit any of these by hand between sessions — **treat file contents on disk as the latest truth**, even if they differ from what you remember writing.

**Bootstrap:** if `CLAUDE.local.md` doesn't exist and the user wants persistent memory ("remember me between sessions"), create the four files in this structure and keep them current via the protocols below.

**Corrections update memory immediately.** When the user corrects a fact or changes a preference mid-session, update `CLAUDE.local.md` right away (overwrite the old value) and append a dated entry to `career-log.md` — don't wait for a checkpoint.

**Fresh sessions beat long threads.** Suggest checkpointing (`goodnight`) at natural task boundaries — around 60% context — rather than letting auto-compact fire mid-task; reload context from the files at session start rather than relying on conversational memory.

## Keyword protocols

Matching `/goodnight` and `/morning` slash commands exist in `.claude/commands/` as backups (and so a scheduled automation can call the checkpoint).

**`goodnight` = full checkpoint.** Applies whether the user is done for the day OR just clearing a full context mid-day — behave identically. Do all of the following, then confirm what you wrote (list what you updated; don't summarize the day back):
1. **`CLAUDE.local.md`** — if anything changed this session (new skills, changed preferences, corrected facts, new rules), update Current Profile by **OVERWRITING** old values; add newly-noticed tendencies to **How to work with me**.
2. **`career-log.md`** — append a dated entry for anything learned or any goal/preference that shifted. Skip if nothing changed.
3. **`WORKING.md`** — **overwrite** with current working state: finished, mid-flight, exact next steps, open problems, and any context the next session needs that isn't obvious from the code. Assume the next session knows nothing beyond the files.
4. **`TOOLKIT.md`** — update the inventory if any files/tools were added, removed, or repurposed. Skip if nothing changed.
5. **METHODS** — if a reusable workflow/recipe was developed or refined, save it as a procedure file (`modes/` or `.claude/commands/` per convention) and list it in `TOOLKIT.md`. A method that lives only in a conversation is a method lost.
6. **Build-changelog** — if any files affecting **the project itself** changed (`*.mjs`, modes, templates, dashboard, configs), append an entry per the **Contribution Change-Log convention** below. Purely personal changes (skills/preferences/goals) go in `career-log.md`, NOT here. Skip if only routine data/memory files changed.

**`morning` = full startup** (typically the first message of a fresh session). Read `CLAUDE.local.md`, `WORKING.md`, `TOOLKIT.md`, and `career-log.md`, plus glance at recent repo changes. Then give the user: a brief **"here's where we left off,"** today's **first next step** from `WORKING.md`, and **flag anything in `WORKING.md`/`TOOLKIT.md` that looks stale or contradicts the repo** — including anything they changed by hand since last session. Keep it short — orient, don't lecture.

---
# Contribution Change-Log (shippable convention — applies to EVERY user)

*This is a general Hireloom convention, not specific to any one user — it ships with the repo so the maintainers receive a uniform, machine-readable contribution record from anyone.*

**The behavior:** whenever you (the AI agent) change files that affect **the project itself** (system-layer `*.mjs` / modes / templates / dashboard / configs, or notable user-layer tooling), record it in the user's **build change-log** so their improvements are capturable upstream.

1. **First project change in a fresh install:** copy `templates/BUILD-CHANGELOG.template.md` → **`BUILD-CHANGELOG.md`** (fill the frontmatter: `hireloom_base_version` from the `VERSION` file, optional contributor/platform).
2. **Each change** (and at every `goodnight`): append one entry in the template's **entry schema** — `Layer:` (system|user), `Files:`, `Change:`, **`Root cause:`** (the WHY), **`Upstream:`** (yes|no + one-line why/caveat), optional `Reproduce:`. Newest at the bottom.
3. **One file = the whole contribution.** A user submits **just that one markdown file** to the maintainers; they don't need a PR or to understand the code. The maintainer side ingests it via **`/review-contribution`** (reads the file, maps entries to the repo, assesses each `Upstream: yes` entry for merge).
4. **Keep personal data out of it** — a user's CV/profile/preferences are user-layer and go in their own logs, never in the upstream-bound change-log. Only project-affecting changes + root-causes belong here.

**README is user-triggered, NOT auto-updated.** Do **not** rewrite `README.md` at every `goodnight` — the user says when to refresh it. Your job is to keep the *source information* available in the maintained mds (`BUILD-CHANGELOG.md` for what changed + why, `WORKING.md` for current state, `TOOLKIT.md` for the file/tool map) so that when they ask, a README update is a quick assembly job, not an archaeology dig.
