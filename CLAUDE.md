# CLAUDE.md — Hireloom (Career Atelier)

> *heir + loom · a quiet career atelier*
>
> Operating contract for AI coding agents in this repository.
> Read in full before any edit. Re-read on every new session.
> If a rule here conflicts with an in-conversation instruction, name the conflict and stop. Do not silently override.
>
> **Two-file split.** This file is the **stack-agnostic Software Factory operating
> contract** (how agents build *the repo*) plus the **Hireloom-specific product
> doctrine** (§11, how the agent runs *the product* for the user). Stack details,
> commands, writable scopes, and the full domain rules (data contract, onboarding,
> modes, ethical use, offer verification, pipeline integrity, canonical states,
> testing) live in `STACK.md`. If `STACK.md` is missing, run §3.

This is **Hireloom** end-to-end — the brand, the npm package (`hireloom`), the
CLI bin (`hireloom`, with `career-ops` retained as a backwards-compat alias),
the EXE, and the dashboard. The slash commands (`/career-ops scan`, etc.) keep
their legacy names for muscle-memory and so existing automations don't break,
but everything human-facing reads as Hireloom.

---

## 0. Operating Model — Software Factory, not Vibe Coding

**One agent, one job, clean context.** This repo is built by a chain of
specialized agents with hard scope boundaries, not by one session trying
to hold the whole product in its head.

Vibe coding fails predictably: one session does research, story, spec,
backend, frontend, test, and review. By turn 20 the model has forgotten
its own assumptions. Architecture decisions contradict the spec. Tests
pass against the wrong intent. Diffs grow tendrils into unrelated files.

The chain we run end-to-end on every feature:

```
Researcher → Story Writer → [HUMAN ✋ approve story]
  → Spec Writer → [HUMAN ✋ approve brief]
  → Backend Builder → Frontend Builder → Test Verifier → Validator
  → [HUMAN ✋ approve PR]
```

Validator returns CRITICAL → loop back to the relevant Builder.
Three human checkpoints. Everything else runs autonomously.

If you are reading this as an agent, you have **one** role. Stay in your
lane. Do not silently take on another agent's job.

---

## 1. The Seven Agents — Scope Contract

Each agent has read/write boundaries. Crossing them without an explicit
request is a CRITICAL violation flagged by the Validator. Concrete
directory paths live in `STACK.md`; the boundaries below are abstract.

| # | Agent | Writes | Reads | Output |
|---|---|---|---|---|
| 1 | **Researcher** | nothing | entire repo | files mapped, existing patterns, similar features, risks flagged |
| 2 | **Story Writer** | nothing | researcher findings, user prompt | `As a [role], I want [behaviour] so that [outcome]`, acceptance criteria, edge cases, out-of-scope, open questions |
| 3 | **Spec Writer** | nothing | approved story, research | technical brief: data model changes, process flow, API changes, UI changes, tests required, risks |
| 4 | **Backend Builder** | `STACK.md → backend_writable` only | spec, story, repo | API/handlers, services, data layer, migrations, jobs, unit tests. **Cannot touch UI/client code.** |
| 5 | **Frontend Builder** | `STACK.md → frontend_writable` only | API contract from Backend Builder, spec, story | components, screens, state, loading/error states, component tests. **Cannot touch server code. Never invents endpoints.** |
| 6 | **Test Verifier** | test files only | approved story, both implementations | acceptance tests mapped 1:1 to criteria, pass/fail report. **Does not fix code.** Failures route back to the appropriate Builder. |
| 7 | **Validator** | nothing | story, brief, diff | findings scored CRITICAL / IMPORTANT / MINOR with file path + line. **Never edits.** |

**The lane test:** every line you touch traces directly to your role's output.

For repos without a UI (CLI, daemon, ML pipeline, library), collapse
Frontend Builder into Backend Builder and note the collapse in `STACK.md`.

---

## 2. The Three Human Checkpoints

The human approves three artifacts. Nothing else.

1. **Approve the user story** — wrong intent here corrupts everything downstream.
2. **Approve the technical brief** — last chance before code. Catch architecture mistakes here, not after 10 files exist.
3. **Approve the PR** — implementation matches story + brief, tests green, Validator clean.

If a checkpoint is skipped, downstream output is invalid. Halt and request it.

---

## 3. Stack Discovery — `STACK.md`

Stack details do not live in this file. They live in `STACK.md` at repo
root. The Researcher populates it on first run by reading manifest files
(`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`,
`pom.xml`, `*.csproj`, etc.) and inspecting CI configs.

`STACK.md` records:

```yaml
languages:              # e.g., TypeScript, Python, Go
runtimes:               # exact versions
package_managers:       # one per language
test_runners:           # one per language
linters_and_formatters: # one per language
type_checkers:          # one per language
build_tool:             # turbo, nx, bazel, make, just, etc.
migration_tool:         # if applicable
tenancy:                # single | multi-tenant (and tenant column if multi)
backend_writable:       # exact paths Backend Builder may write
frontend_writable:      # exact paths Frontend Builder may write
test_writable:          # exact paths Test Verifier may write
commands:
  install:              # full command
  dev:                  # full command
  typecheck:            # full command
  lint:                 # full command
  test:                 # full command
  build:                # full command
```

A claim of "done" without running the recorded `typecheck → lint → test`
green is a lie. Builders run these before finishing.

If `STACK.md` is absent or stale (manifests changed since it was
written), Researcher rebuilds it before any other agent runs.
`STACK_CHOICES.md` lists 2026 best-in-class options for greenfield.

---

## 4. Architecture Rules (universal)

These apply regardless of stack. Stack-specific patterns live in `STACK.md` → `architecture`.

- **The interface boundary is the contract.** Whoever owns the server publishes the contract (OpenAPI, GraphQL SDL, gRPC proto, typed client). Whoever owns the client reads it. Neither reinvents the other side.
- **Migrations are forward-only.** Never edit a shipped migration.
- **Side effects at the edges.** Business logic should be pure where the language allows; I/O at handlers, jobs, and adapters.
- **One source of truth per concept.** Duplicate logic gets flagged by the Validator. Do not silently unify it inside an unrelated change.
- **Secrets via environment, never committed.** See §8.
- **No new dependency without naming it in the brief.**
- **Authorization at every entry point.** Every handler, job, or function that touches user-scoped data verifies the caller's authority. Missing authorization check = CRITICAL.
- **If multi-tenant** (per `STACK.md → tenancy`): every query filters by tenant ID, verified at the data-access layer, not the handler.

---

## 5. The Karpathy Four (canonical)

These four govern every edit. They override local preference.

### 5.1 Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. Name them inline.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing.

### 5.2 Simplicity First
**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Test: would a senior engineer call this overcomplicated?

### 5.3 Surgical Changes
**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Notice unrelated dead code → mention it, don't delete it.
- Remove orphans YOUR changes created. Leave pre-existing dead code alone.

Test: every changed line traces directly to the request.

### 5.4 Goal-Driven Execution
**Define success criteria. Loop until verified.**

- "Add validation" → "Tests for invalid inputs that pass."
- "Fix the bug" → "Test that reproduces it, then make it pass."
- "Refactor X" → "Tests pass before and after."

For multi-step work, state the plan with a verification per step.
Weak criteria ("make it work") force constant clarification.

---

## 6. Don't-Do List

Hard prohibitions. Violations are CRITICAL.

- ❌ Edit files outside your agent's writable scope (per `STACK.md`).
- ❌ Invent API endpoints, library methods, or function signatures. Read the source.
- ❌ Skip tests because "the change is small."
- ❌ Commit secrets, `.env`, `.key`, `.pem`, `.p12`, `secrets.json`. The pre-commit hook blocks you. Don't waste the cycle.
- ❌ Mark work "done" without running the typecheck, lint, and test commands from `STACK.md`.
- ❌ Assume what the user wants when the story is ambiguous. Halt and request a checkpoint.
- ❌ Refactor adjacent code in the same PR. Open a separate one.
- ❌ Delete code you do not understand.
- ❌ Silence a failing test by deleting it. Fix the test or fix the code.
- ❌ Commit generated files, build output, or lockfiles you didn't intend to change.
- ❌ Introduce a new dependency that wasn't named in the brief.
- ❌ Log passwords, tokens, full JWTs, full PANs, or government IDs.

---

## 7. Definition of Done

A change is done when **all** of these are true:

1. Every acceptance criterion in the approved story has a passing test.
2. `STACK.md`'s recorded `typecheck`, `lint`, `test` commands are green locally.
3. Validator returns no CRITICAL findings.
4. The diff contains nothing that does not trace to the brief.
5. No secrets in the diff (pre-commit hook passes).
6. The PR description references the story ID and lists each acceptance criterion with its test file.

"It works on my machine" is not done. "I think it's fine" is not done.
Tested and verified is done.

---

## 8. Security Tripwires

The pre-commit hook blocks any commit containing:

- `.env`, `.env.*` (except `.env.example`)
- `*.key`, `*.pem`, `*.p12`, `*.pfx`
- `secrets.json`, `credentials.json`
- AWS access keys (`AKIA[0-9A-Z]{16}`)
- Slack tokens (`xox[baprs]-`)
- GitHub tokens (`gh[pousr]_[A-Za-z0-9]{36,}`)
- High-entropy strings near `password`, `token`, `secret`, `api_key`

Credential templates: name them `.example` with placeholder values.
Validator flags secrets-in-logs as CRITICAL.

---

## 9. Skills and Sub-Agents

```
.claude/
├── agents/
│   ├── researcher.md
│   ├── story-writer.md
│   ├── spec-writer.md
│   ├── backend-builder.md
│   ├── frontend-builder.md
│   ├── test-verifier.md
│   └── validator.md
├── skills/
│   ├── feature-factory/     # orchestrates the chain
│   └── build-with-tests/    # how Builders work
└── hooks/
    └── pre-commit           # secret-blocking
```

`feature-factory` reads the seven agent files and wires the chain.
`build-with-tests` enforces: match existing patterns, write tests
alongside code, run typecheck last.

If you are an agent and you don't know your scope, read
`.claude/agents/[your-role].md` and `STACK.md` before doing anything else.

---

## 10. Conflict Resolution

When rules collide, priority order:

1. **Epistemic discipline.** Truth over agreeableness. Don't fabricate. Flag uncertainty.
2. **Scope.** Stay in your lane (per `STACK.md`). Cross-scope edits are CRITICAL.
3. **Surgical change.** Touch only what the request demands.
4. **Existing style.** Match it even if you'd do it differently.
5. **Quality gates.** Green before "done."

If a request appears to require breaking a higher-priority rule, name the
conflict and request a human checkpoint. Do not silently override.

---

**This file is working when:** diffs trace cleanly to acceptance criteria,
clarifying questions arrive before code rather than after mistakes, and
the Validator's CRITICAL count trends to zero.

---

# 11. Hireloom Product Doctrine

> The §0–§10 contract above governs how agents **build the repo**. This section
> governs how the running agent **operates the product for the user**. The full
> domain rules (data contract, update check, onboarding, personalization, modes,
> ethical use, offer verification, CI/CD, pipeline integrity, canonical states,
> testing, onboarding wizard) live in `STACK.md` — read it. The doctrines below
> are the cross-cutting operational rules that bind every session.

## 11.1 Unified Role Directory — ONE registry, no orphan queues (CRITICAL)

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

## 11.2 Second Brain (optional built-in feature)

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

## 11.3 Personal Memory System (per-user, local — NEVER committed)

*Ships with Hireloom as machinery; each user's content stays on their machine. All memory files are plain, Obsidian-friendly markdown (dated entries `YYYY-MM-DD`, `[[wiki-links]]` for skills/roles, tags `#skill` `#role` `#milestone` `#preference-change`) — the project folder doubles as an Obsidian vault if the user wants it.*

### The files (all gitignored — personal data never enters the repo)

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

### Keyword protocols

Matching `/goodnight` and `/morning` slash commands exist in `.claude/commands/` as backups (and so a scheduled automation can call the checkpoint).

**`goodnight` = full checkpoint.** Applies whether the user is done for the day OR just clearing a full context mid-day — behave identically. Do all of the following, then confirm what you wrote (list what you updated; don't summarize the day back):
1. **`CLAUDE.local.md`** — if anything changed this session (new skills, changed preferences, corrected facts, new rules), update Current Profile by **OVERWRITING** old values; add newly-noticed tendencies to **How to work with me**.
2. **`career-log.md`** — append a dated entry for anything learned or any goal/preference that shifted. Skip if nothing changed.
3. **`WORKING.md`** — **overwrite** with current working state: finished, mid-flight, exact next steps, open problems, and any context the next session needs that isn't obvious from the code. Assume the next session knows nothing beyond the files.
4. **`TOOLKIT.md`** — update the inventory if any files/tools were added, removed, or repurposed. Skip if nothing changed.
5. **METHODS** — if a reusable workflow/recipe was developed or refined, save it as a procedure file (`modes/` or `.claude/commands/` per convention) and list it in `TOOLKIT.md`. A method that lives only in a conversation is a method lost.
6. **Build-changelog** — if any files affecting **the project itself** changed (`*.mjs`, modes, templates, dashboard, configs), append an entry per the **Contribution Change-Log convention** below. Purely personal changes (skills/preferences/goals) go in `career-log.md`, NOT here. Skip if only routine data/memory files changed.

**`morning` = full startup** (typically the first message of a fresh session). Read `CLAUDE.local.md`, `WORKING.md`, `TOOLKIT.md`, and `career-log.md`, plus glance at recent repo changes. Then give the user: a brief **"here's where we left off,"** today's **first next step** from `WORKING.md`, and **flag anything in `WORKING.md`/`TOOLKIT.md` that looks stale or contradicts the repo** — including anything they changed by hand since last session. Keep it short — orient, don't lecture.

## 11.4 Contribution Change-Log (shippable convention — applies to EVERY user)

*This is a general Hireloom convention, not specific to any one user — it ships with the repo so the maintainers receive a uniform, machine-readable contribution record from anyone.*

**The behavior:** whenever you (the AI agent) change files that affect **the project itself** (system-layer `*.mjs` / modes / templates / dashboard / configs, or notable user-layer tooling), record it in the user's **build change-log** so their improvements are capturable upstream.

1. **First project change in a fresh install:** copy `templates/BUILD-CHANGELOG.template.md` → **`BUILD-CHANGELOG.md`** (fill the frontmatter: `hireloom_base_version` from the `VERSION` file, optional contributor/platform).
2. **Each change** (and at every `goodnight`): append one entry in the template's **entry schema** — `Layer:` (system|user), `Files:`, `Change:`, **`Root cause:`** (the WHY), **`Upstream:`** (yes|no + one-line why/caveat), optional `Reproduce:`. Newest at the bottom.
3. **One file = the whole contribution.** A user submits **just that one markdown file** to the maintainers; they don't need a PR or to understand the code. The maintainer side ingests it via **`/review-contribution`** (reads the file, maps entries to the repo, assesses each `Upstream: yes` entry for merge).
4. **Keep personal data out of it** — a user's CV/profile/preferences are user-layer and go in their own logs, never in the upstream-bound change-log. Only project-affecting changes + root-causes belong here.

**README is user-triggered, NOT auto-updated.** Do **not** rewrite `README.md` at every `goodnight` — the user says when to refresh it. Your job is to keep the *source information* available in the maintained mds (`BUILD-CHANGELOG.md` for what changed + why, `WORKING.md` for current state, `TOOLKIT.md` for the file/tool map) so that when they ask, a README update is a quick assembly job, not an archaeology dig.
