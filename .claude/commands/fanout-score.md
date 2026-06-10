---
description: Parallel fan-out scoring/review via the Workflow tool (opt-in only)
---

# /fanout-score — Parallel fan-out scoring via the Workflow tool

Pattern for "score/review N independent items in parallel" (fit-scored 43 AECOM roles this way). **ONLY use the Workflow tool when the user has opted in** — ultracode on, or they ask for orchestration. For 1–3 items do it inline.

- **⚠ `args` gotcha:** Workflow may pass `args` as a JSON **string**. Parse defensively at the top: `const items = Array.isArray(args) ? args : JSON.parse(args)` — OR hardcode the array in the script. (Runs died on `roles.map is not a function` before this.)
- **Shape:**
  ```js
  phase('Score')
  const results = (await parallel(items.map((it,i)=>()=>
    agent(`<task + the user's real profile + the /referral-pipeline honesty rubric, using it.field>`,
          {label:`…`, phase:'Score', schema: SCHEMA})))).filter(Boolean)
  return { count: results.length, results }  // sort + tally first
  ```
- Give each agent a JSON **`schema`** → validated structured output, no parsing. **Embed the user's profile + the rubric in the prompt** so scoring is consistent and honest.
- Agents have WebFetch + Write — they can fetch a JD (SmartRecruiters API) and/or save files directly.
- Runs in background → a `task-notification` fires on completion. **The result may be truncated — read the `output-file` path it gives you** for everything. Concurrency ~10–16; up to ~4096 items per call.
