# Hireloom — Gemini CLI entry point

**This project keeps ONE canonical agent rulebook: [`AGENTS.md`](AGENTS.md). Read it in full before acting** — the data contract (user layer vs system layer), the consent-gated automation ethics, pipeline integrity rules, onboarding flow, and every mode all live there and apply identically to Gemini sessions.

Gemini-specific notes:

- `gemini-eval.mjs` — standalone Gemini API evaluator (no CLI required); reads the same `modes/oferta.md` scoring rubric.
- The career-ops skill ships in the open agent skill standard format (`.agents/skills/career-ops/SKILL.md`) — invoke any mode by asking for it (`scan`, `oferta`, `pdf`, `apply`, …).
