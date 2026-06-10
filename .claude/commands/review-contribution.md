---
description: Maintainer-side — ingest a user-submitted BUILD-CHANGELOG.md, assess each change, flag what's safe to upstream
---

# /review-contribution — Assess a submitted contribution change-log

For the **maintainer side**. A user ran Hireloom, their agent auto-kept a `BUILD-CHANGELOG.md` (schema `build-changelog/v1`), and they sent you that single file. This turns it into an assessment + a merge plan — no PR or back-and-forth needed from them.

**Input:** path to the submitted file (default: a `BUILD-CHANGELOG.md` / `*Change Log*` md the user dropped into the repo or attached).

## Steps
1. **Read the file + its frontmatter.** Note `hireloom_base_version` — compare to the current `VERSION`. Flag entries that may have drifted if the base is old.
2. **Parse entries** (each `###` block). For each, pull: title, `Layer`, `Files`, `Change`, `Root cause`, `Upstream`, optional `Reproduce`.
3. **Filter to `Upstream: yes`** (system-layer / generalizable). Ignore `user`-layer/personal entries — those are the contributor's own data.
4. **Assess each upstream candidate** against the current repo:
   - Does the named file/area still exist? Has it changed since `hireloom_base_version`?
   - Is the change genuinely general (helps any user) or coupled to that user's personal setup?
   - Conflicts with current code? Honesty/ethics/data-contract violations? (Reject anything that auto-submits applications or overclaims.)
   - Risk tier: 🟢 safe drop-in · 🟡 needs adaptation · 🔴 don't merge (with reason).
5. **Produce a merge plan** — a table: entry · files · what it adds · root-cause · risk tier · recommended action (merge as-is / adapt / skip). For 🟢/🟡 you may draft the actual edit against the current repo on request.
6. **Never auto-apply** — present the plan; the maintainer decides what lands. Keep the contributor's framing/credit.

## Notes
- The schema is defined in `BUILD-CHANGELOG.template.md`. If a submitted file doesn't follow it, still do your best to parse, and note the format drift.
- Multiple submissions: dedupe overlapping changes across files before planning.
