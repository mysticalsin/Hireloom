---
description: Full checkpoint — write the memory files and list what changed (mirror of the "goodnight" keyword)
---

# /goodnight — Full checkpoint

Backup for the bare `goodnight` keyword (see the Personal Memory System protocols in `CLAUDE.md`). Applies whether the user is done for the day OR just clearing a full context mid-day — **behave identically.** Do all of the following, then **confirm what you wrote** (don't summarize the day back — write the files and list what you updated):

1. **`CLAUDE.local.md`** — if anything changed this session (new skills, changed preferences, corrected facts, new rules), update **Current Profile** by **OVERWRITING** old values. If you noticed a new subtle preference/tendency, add it to **How to work with me**.
2. **`career-log.md`** — append a dated entry (`YYYY-MM-DD`, `[[wiki-links]]`, tags `#skill`/`#role`/`#milestone`/`#preference-change`) for anything the user learned or any goal/preference that shifted. Skip if nothing changed.
3. **`WORKING.md`** — **overwrite** with current working state: what we finished, what's mid-flight, exact next steps, open problems, and any context the next session needs that isn't obvious from the code. Be detailed — assume the next session knows nothing beyond the files.
4. **`TOOLKIT.md`** — if we added/removed/repurposed any files or tools, update the inventory. Skip if nothing changed.
5. **METHODS** — if we developed or refined a reusable workflow/recipe, save or update it as a procedure file (`modes/` or `.claude/commands/`) and list it in `TOOLKIT.md`. A method that lives only in the conversation is a method we lose.
6. **Build-changelog** — if we changed any files that affect **the project itself** (`*.mjs`, modes, templates, dashboard, configs — system-layer + notable user-layer tooling), append an entry to the build change-log per the **Contribution Change-Log convention** in `CLAUDE.md` (entry schema with **root-cause** + **Upstream:** flag; copy `BUILD-CHANGELOG.template.md` → `BUILD-CHANGELOG.md` on first change). **Purely personal changes go in `career-log.md`, NOT here.** Skip if only routine data/memory files changed.
