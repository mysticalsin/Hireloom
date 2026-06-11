# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `cv.md` | Your CV in markdown |
| `config/profile.yml` | Your identity, targets, comp range |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `portals.yml` | Your customized company list |
| `data/applications.md` | Your application tracker |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history |
| `data/follow-ups.md` | Your follow-up history |
| `writing-samples/*` | Your personal writing samples for style calibration |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated PDFs |
| `jds/*` | Your saved job descriptions |
| `CLAUDE.local.md` | Your personal memory layer (Current Profile + How to work with me) — auto-loaded each session, gitignored |
| `WORKING.md` | Your live working state (overwritten at each `goodnight` checkpoint) |
| `career-log.md` | Your append-only history of learning and preference changes |
| `TOOLKIT.md` | Your annotated map of local files/tools/methods |
| `BUILD-CHANGELOG.md` | Your contribution change-log instance (submit upstream when you want) |
| `BUILD-PROFILE.md`, `BUILD-LOG.md` | Second-brain build outputs |
| `_brain_api/`, `_brain_index/`, `_agent_state/` | Second-brain machine layer (generated) |
| `.obsidian/*` | Per-machine Obsidian settings + the built second-brain plugin |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/de/*` | German language modes |
| `modes/fr/*` | French language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `CLAUDE.md` | Agent instructions (incl. the generic memory-system + contribution-log machinery) |
| `AGENTS.md` | Codex instructions |
| `*.mjs` | Utility scripts |
| `lib/*` | Shared libraries (`identity.mjs` reads the user's `config/profile.yml` — the library is system, the data it reads is user) |
| `second-brain/*` | Second Brain build spec (what it GENERATES is user layer, above) |
| `.claude/commands/*` | Method commands (`/second-brain`, `/goodnight`, `/morning`, …) |
| `BUILD-CHANGELOG.template.md` | Contribution change-log template (your filled `BUILD-CHANGELOG.md` is user layer) |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**
