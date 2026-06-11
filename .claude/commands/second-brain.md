---
description: Build or extend the Second Brain — live Obsidian dashboards over the user's Hireloom data (interview-driven, phased)
---

# /second-brain — Hireloom's built-in Second Brain

Builds the user a live command-center inside Obsidian (free) over the career
data Hireloom already maintains: pipeline kanban, apply queue, follow-up
radar, upcoming interviews. Zero new data entry.

## How to run it

1. Read `second-brain/BUILD-SPEC.md` FULLY — it is the complete, self-contained
   instruction set (design laws, phase order, tab-binding contract, self-test).
2. Phase 0 derives almost everything from `config/profile.yml` and
   `templates/states.yml` — ask only the four gaps the spec lists, write
   `BUILD-PROFILE.md` (gitignored), estimate, and get a go.
3. Build phase by phase. Every phase gate runs the spec's self-test: real
   rows or the exact empty state, never a blank pane, never invented data.
4. One feature per commit. Keep `BUILD-LOG.md` (gitignored) current.

## Hard rules (from the spec — non-negotiable)

- Every pixel binds to a real Hireloom file; honest empty states otherwise.
- Reuse Hireloom's analyzers (`followup-cadence.mjs`, `analyze-patterns.mjs`);
  never re-implement their logic in the plugin.
- Map the user's existing folders; never restructure them.
- The dashboard itself never sends or submits anything — it drafts (nudges, cover letters) and visualizes; applying happens only through the apply pipeline the user launches.
- User-layer outputs stay gitignored (`BUILD-PROFILE.md`, `BUILD-LOG.md`,
  `_brain_*`, `_agent_state/`, `.obsidian/`).

## Resuming

If `BUILD-PROFILE.md` exists, Phase 0 is done — read it plus `BUILD-LOG.md`
and continue from the first incomplete phase. Never re-ask answered questions.
