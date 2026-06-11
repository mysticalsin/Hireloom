---
hireloom_base_version: "<paste from VERSION file>"
contributor: "<your name or handle — optional>"
platform: "<your OS / specs — optional>"
generated_by: Claude Code
schema: build-changelog/v1
---

# Build Change-Log — <Your Name>'s Build

> **What this is:** an auto-maintained record of every change you (through your AI agent) make to your copy of Hireloom, each with its **root cause**. Your agent appends to it automatically at each `goodnight` checkpoint — you don't have to write it by hand.
>
> **Why it matters:** to contribute your improvements back, just **send THIS ONE FILE to the maintainers.** Their Claude Code reads it, maps each entry to the repo, and assesses it for merge. You don't need to open a pull request, understand the code, or reproduce the engineering — one markdown file is enough. (See the `/review-contribution` flow on the maintainer side.)

## How to read / parse this
- Newest entries at the **bottom**. One `###` block per change. **Keep the field schema below consistent** — that's what makes the file machine-readable.
- `Layer:` and `Upstream:` tell a maintainer at a glance whether an entry is a general improvement (act on it) or personal data (skip it).

## Entry schema (copy this block per change)
```
### YYYY-MM-DD — <short imperative title>
- **Layer:** system (code / engine / modes / templates / config — potentially upstream-able)  |  user (personal data: cv, profile, output/*, reports/*, interview-prep/* — not upstream)
- **Files:** `path/one.mjs`, `path/two.md`
- **Change:** <what changed, concretely>
- **Root cause:** <the problem or reason it was needed — the WHY, not just the what>
- **Upstream:** yes | no — <one line: why it generalizes, or why it's personal-only / any caveat>
- **Reproduce (optional):** <how to apply it, if non-obvious>
```

---

## Changes

<!-- Your agent appends entries below this line, oldest-to-newest. -->
