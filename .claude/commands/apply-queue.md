# /apply-queue — drive the pool apply queue through the apply-session window

Work the head of `output/pool-apply-order.json` role by role: the agent navigates
and fills, the user reviews and submits. Consent-gated — the session physically
cannot click Submit/Apply-grade buttons.

## Preflight (once per sitting)

1. Heartbeat: `.apply-session/status.json` `ts` fresh (<10s) and `state: ready/idle`?
   If stale, relaunch **in the background** and wait for a fresh heartbeat:
   ```bash
   PW_CHROMIUM_PATH="$(ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/'Google Chrome for Testing.app'/Contents/MacOS/'Google Chrome for Testing' | tail -1)" node engine/apply/apply-session.mjs
   ```
2. Pick the next pending rows: `rows[]` where `status` is empty/`pending`, lowest
   rank first. Each row carries `url`, `cv`, `cover`, `folder`, `n` (pool number).
3. JDs live in `output/pool-jds/{RANK}.json` — **keyed by rank, not pool number**
   (`071.json` = rank 71). Never WebFetch a JD that's already on disk.

## Per role

1. `node engine/apply/apply-cmd.mjs goto "<row.url>"`
   - Direct-ATS URLs get a fresh ephemeral window automatically; Indeed/LinkedIn
     reuse the persistent logged-in window. For Lever, append `/apply` to land on
     the form. For Indeed, `read` the page first — check for "This job has expired".
2. Write the JD text to a temp file, then:
   `node engine/apply/apply-cmd.mjs fill --cv "<row.cv>" --cover "<row.cover>" --jd "<jdfile>" --role "<Company — Role>"`
   - Run fills in the background; they can exceed apply-cmd's 180s wait. The
     session upgrades cv/cover to "(Technical)" siblings automatically.
3. The session stops at the submit step (or hands over when it can't proceed).
   Tell the user what was left blank/flagged in the log (`⚠` lines) — they review,
   correct, attach anything missing, and submit.
4. **After the user confirms submission**, stamp the row in
   `output/pool-apply-order.json`: `status: "applied"` + dated note. Dead postings
   get `status: "expired"`. **Pool applies are logged HERE — do NOT add
   applications.md rows for them.**

## Hard rules

- Never relaunch or quit the session while a form the user hasn't submitted is open.
- Never stamp `applied` before the user says they submitted.
- A `⚠ no option matched` line means the field is intentionally blank — surface it.
- If the fill loops, errors, or the page repeats: stop, read the session log, fix
  or hand over — never re-fire `fill` blind.
