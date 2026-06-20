// Server-side, provider-agnostic job-offer evaluator.
//
// The heart of the BYOK loop: assemble the evaluation prompt from the mode files
// + the user's CV, run it through the unified provider chokepoint on the caller's
// key, and return the evaluation text + a parsed score summary. No Claude Code,
// no provider SDKs — works for any tenant with any provider key.
//
// Pure helpers (buildEvalSystemPrompt / parseScoreSummary / buildReportMarkdown)
// are exported for testing and reuse; evaluateOffer() does the one I/O call.

import { callLLM, resolveModel } from '../llm/provider.mjs';

const SUMMARY_RE = /---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/;

/** Assemble the evaluation system prompt from the mode files + CV. Pure. */
export function buildEvalSystemPrompt({ shared = '', oferta = '', cv = '', productName = 'Hireloom' } = {}) {
  return `You are ${productName}, an AI-powered job search assistant.
You evaluate job offers against the user's CV using a structured A-G scoring system.

Your evaluation methodology is defined below. Follow it exactly.

═══════════════════════════════════════════════════════
SYSTEM CONTEXT (_shared.md)
═══════════════════════════════════════════════════════
${shared}

═══════════════════════════════════════════════════════
EVALUATION MODE (oferta.md)
═══════════════════════════════════════════════════════
${oferta}

═══════════════════════════════════════════════════════
CANDIDATE RESUME (cv.md)
═══════════════════════════════════════════════════════
${cv}

═══════════════════════════════════════════════════════
IMPORTANT OPERATING RULES FOR THIS SESSION
═══════════════════════════════════════════════════════
1. You do NOT have access to WebSearch, Playwright, or file writing tools.
   - For Block D (Comp research): provide salary estimates based on your training data, clearly noted as estimates.
   - For Block G (Legitimacy): analyze the JD text only; skip URL/page freshness checks.
   - Post-evaluation file saving is handled by the caller, not by you.
2. Generate Blocks A through G in full, in English, unless the JD is in another language.
3. At the very end, output a machine-readable summary block in this exact format:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---
`;
}

/** Extract the machine-readable summary block. Pure. Always returns all keys. */
export function parseScoreSummary(text = '') {
  const out = { company: 'unknown', role: 'unknown', score: '?', archetype: 'unknown', legitimacy: 'unknown' };
  const m = text.match(SUMMARY_RE);
  if (!m) return out;
  const block = m[1];
  const pick = (key) => {
    const mm = block.match(new RegExp(`${key}:\\s*(.+)`));
    return mm ? mm[1].trim() : out[key.toLowerCase()] ?? 'unknown';
  };
  out.company = pick('COMPANY');
  out.role = pick('ROLE');
  out.score = pick('SCORE');
  out.archetype = pick('ARCHETYPE');
  out.legitimacy = pick('LEGITIMACY');
  return out;
}

/** Strip the summary block and wrap the evaluation in the canonical report. Pure. */
export function buildReportMarkdown({ summary, evaluationText, toolLabel = 'Hireloom', date }) {
  const body = (evaluationText || '').replace(SUMMARY_RE, '').trim();
  return `# Evaluation: ${summary.company} — ${summary.role}

**Date:** ${date}
**Archetype:** ${summary.archetype}
**Score:** ${summary.score}/5
**Legitimacy:** ${summary.legitimacy}
**PDF:** pending
**Tool:** ${toolLabel}

---

${body}
`;
}

/**
 * Evaluate one job offer through the BYOK chokepoint.
 * @param {object} o
 * @param {string} o.jdText   the job description to evaluate
 * @param {string} o.shared   modes/_shared.md content
 * @param {string} o.oferta   modes/oferta.md content
 * @param {string} o.cv       cv.md content
 * @param {string} [o.provider="anthropic"]  llm provider
 * @param {string} [o.model]  model id (defaults to the provider's alias)
 * @param {string} [o.apiKey] per-call key (falls back to the provider env var)
 * @returns {Promise<{evaluationText, summary, usage, model}>}
 */
export async function evaluateOffer({
  jdText, shared, oferta, cv,
  provider = 'anthropic', model, apiKey,
  maxTokens = 8192, temperature = 0.4, fetchImpl, productName,
} = {}) {
  if (!jdText || !jdText.trim()) throw new Error('evaluateOffer: jdText is required');
  const resolvedModel = model || resolveModel(provider).model;
  const system = buildEvalSystemPrompt({ shared, oferta, cv, productName });
  const out = await callLLM({
    provider,
    model: resolvedModel,
    apiKey,
    system,
    prompt: `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${jdText}`,
    maxTokens,
    temperature,
    fetchImpl,
  });
  return { evaluationText: out.text, summary: parseScoreSummary(out.text), usage: out.usage, model: out.model };
}
