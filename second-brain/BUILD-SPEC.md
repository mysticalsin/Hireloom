# Hireloom Second Brain — build spec (agent-executed)

> This is an instruction set, not code. When the user asks for their second
> brain (`/second-brain`, "set up my second brain", "build the dashboard"),
> the agent reads this file top to bottom and builds the feature for THIS
> user, on THIS install. Hireloom's data files are the only data source.

## What it is

A live command-center inside [Obsidian](https://obsidian.md) (free notes app
that reads plain markdown folders — including this very project folder): a
custom Obsidian plugin whose dashboard shows the user's job search at a
glance — pipeline kanban, apply queue, follow-up radar, upcoming interviews —
rendered from the files Hireloom already maintains. **Zero new data entry.**

## Design laws (every phase obeys these)

1. **No fake data, ever.** Every visual element binds to a real Hireloom file.
   If the data doesn't exist yet, render the honest empty state from the
   bindings table below — each one tells the user exactly which Hireloom
   command fills the gap. One invented number destroys trust in all the real ones.
2. **The folder is the source of truth.** Plain markdown + JSON only. No
   databases, no servers. The plugin READS Hireloom's files; it never becomes
   a second place to maintain state.
3. **The dashboard never sends.** It may draft (follow-up nudges, cover
   letters) and visualize, but nothing leaves the machine from a dashboard
   tile — submission happens only through the apply pipeline the user
   launches (auto-applier after approved dry runs, or assisted apply).
4. **Verify behavior, not load.** A plugin that "loads without errors" can
   still have dead features. At every phase gate, drive the feature and
   observe the effect (see Self-test). Stamp a build-string constant in the
   plugin and bump it on every change so you can prove which code is live.
5. **Map, never restructure.** The user's existing Hireloom folders ARE the
   vault. Don't create parallel trees; don't move their files.
6. **One feature per commit** when the install is a git repo.

## Phase 0 — Profile (mostly pre-answered)

Hireloom already knows the user. Derive, don't interrogate:

| Needed | Source |
|---|---|
| Who they are / target roles | `config/profile.yml` → `candidate:`, `target_roles:`, `narrative:` |
| Pipeline stages | `templates/states.yml` (canonical states) |
| What "done" looks like | an application package: tailored Resume PDF + Cover Letter + evaluation report + tracker row |
| Runtime | Node 20+ guaranteed (Hireloom requirement); agentic CLI = the one running this |

Ask ONLY: (a) OS / always-on machine? — default-assume YES and gently guide
the user toward keeping the machine on (that's what makes the refresh loop
and morning digest live); fall back to manual refresh only if they decline,
(b) accent colors + dark/light — default: dark theme, Hireloom oxblood
accent, if they have no preference, (c) daily rhythm (morning digest time,
quiet hours) — always ask this at setup, (d) optional extras (voice ask-bar,
spend tracking, morning digest) — ON by default; the user can drop any.
When explaining the feature, note the hosting model: **local by default** —
free Obsidian reading the project folder, nothing leaves the machine. If the
user *explicitly asks* for multi-device access AND has an Obsidian **Sync**
subscription, wire Sync for them; never suggest paid hosting unprompted.
Write everything to `BUILD-PROFILE.md` (gitignored). Then give a
phase-by-phase time estimate and get a go before building.

## Phase 1 — Machine layer

Create (all gitignored — see "What ships vs what stays local"):
- `_brain_api/` — pre-computed JSON the plugin reads (regenerated, disposable)
- `_agent_state/` — per-agent memory/stats if the user wants it
- `second-brain/plugin/` — the plugin source (committable workspace; the
  build step copies/symlinks it into `.obsidian/plugins/hireloom-brain/`)

The refresh script (`second-brain/plugin/refresh.mjs`) shells out to the
analyzers Hireloom already has — `node engine/tracker/followup-cadence.mjs` and
`node engine/tracker/analyze-patterns.mjs` both emit JSON — and parses the tracker table
into `_brain_api/pipeline.json`. **Reuse them; never re-implement their
logic inside the plugin.** Schedule it per OS (launchd/cron/Task Scheduler)
if the machine is always-on; otherwise document the manual command.

## Phase 2 — Plugin core + dashboard tabs

**First-open ordering (user-test finding):** never auto-launch with an
`obsidian://open?path=...` deep-link before the folder is a registered
vault — Obsidian throws "Vault not found." The user does the one-time
manual step first (Obsidian → "Open folder as vault" → the Hireloom
folder, then "Trust author and enable plugins"); deep-links work forever
after that registration.

Standard Obsidian community plugin: `manifest.json` + `main.js` (esbuild from
`src/` — Node is guaranteed). A dashboard view with tabs, a memoized data
layer over `_brain_api/` + direct file reads, debounced re-render on vault
file changes (skip-prefix the generated dirs), and a hot-reload dev loop.

**Tab bindings (the contract — every tab, its source, its empty state):**

| Tab | Source of truth | Empty state |
|---|---|---|
| **Pipeline** (kanban by state) | `data/applications.md` per `templates/states.yml` | "No applications tracked — paste a job URL or run /career-ops scan" |
| **Apply Queue** (next up) | `output/pool-apply-order.json` when present | "No ranked pool — run the batch pipeline or paste URLs into data/pipeline.md" |
| **Follow-up Radar** (going cold) | `node engine/tracker/followup-cadence.mjs` JSON + `data/follow-ups.md` | "No applied roles awaiting response" |
| **Interviews** (upcoming + prep state) | tracker rows with status `Interview` + `interview-prep/` contents | "Nothing in interview stage yet" |
| **Scan Feed** (fresh postings) | `data/scan-history.tsv` + last-scan timestamp | "Scanner hasn't run — node engine/scan/scan.mjs" |
| **Patterns** (rejection analytics) | `node engine/tracker/analyze-patterns.mjs` JSON | "Too few outcomes to analyze yet" |
| **Inbox** (pending URLs) | `data/pipeline.md` | "Inbox empty" |

Gate: the tabs show the user's actual tracker rows, and the build stamp in
the plugin settings matches the code you just wrote.

## Phase 3 — Optional extras (each gated on the Phase-0 answers)

- **Agent spend card** — parse the agentic CLI's local transcripts with a
  per-model pricing table. **Dedupe by message id** — transcript replays
  inflate totals 2–3× without it. Gate: card matches a hand-computed day.
- **Ask-bar / voice** — a text ask-bar wired to the user's agentic CLI,
  answering only from vault facts (no invention). Voice STT/TTS only if the
  user asked and their hardware supports it; never clone a voice without
  explicit consent.
- **Morning digest** — at the user's chosen time, compose "today: interviews,
  follow-ups due, queue head" from the same JSON. Quiet hours respected.

## Self-test (run at every phase gate, keep as a plugin command)

1. Build stamp in settings == the constant in the code you just shipped.
2. Each tab renders either real rows or its exact empty-state string — never
   a blank pane, never invented data.
3. Edit a tracker row → dashboard reflects it after refresh (prove the
   read path is live, not cached stale).
4. `_brain_api/*.json` regenerate idempotently (run refresh twice → no diff).
5. Nothing in the plugin writes to user-layer files except its own
   `_brain_api/` + `BUILD-LOG.md`.

Keep a running `BUILD-LOG.md` (gitignored): phase, what shipped, what's
deferred, known limitations. Honesty over polish.

## What ships vs what stays local

- **Ships (system layer):** this spec + `.claude/commands/second-brain.md`.
- **Stays local (user layer, gitignored):** `BUILD-PROFILE.md`, `BUILD-LOG.md`,
  `_brain_api/`, `_brain_index/`, `_agent_state/`, `.obsidian/`, and the
  user's built plugin instance. The plugin source the agent writes lives in
  `second-brain/plugin/` and MAY be committed once genericized (no personal
  data baked in) — same rule as every other Hireloom engine.
