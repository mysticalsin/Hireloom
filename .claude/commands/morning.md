---
description: Full startup — reload context and orient the user (mirror of the "morning" keyword)
---

# /morning — Full startup

Backup for the bare `morning` keyword (see the Personal Memory System protocols in `CLAUDE.md`). Typically the first message of a fresh session.

1. Read **`CLAUDE.local.md`** (Current Profile, How to work with me), **`WORKING.md`** (live state), **`TOOLKIT.md`** (file/tool map), and **`career-log.md`** (history). Glance at recent repo changes.
2. Give the user, **short**:
   - a brief **"here's where we left off,"**
   - today's **first next step** from `WORKING.md`,
   - and **flag anything in `WORKING.md`/`TOOLKIT.md` that looks stale or contradicts the repo** — including anything they changed by hand since last session.
3. Orient, don't lecture. Be ready to flip into whatever mode the next step calls for (apply queue, interview prep, etc.).

**Reads `WORKING.md`, NOT any archived handoff file.**

## Second Brain hook (when built)

If `second-brain/plugin/refresh.mjs` exists, run `node second-brain/plugin/refresh.mjs`
silently, then include `_brain_api/digest.md` as the "today" section of the
orientation — interviews live, follow-ups due, queue head. The user's morning
digest rides this protocol by design (no clock-time push).
