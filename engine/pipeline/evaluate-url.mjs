// Orchestrator: a URL (or pasted text) → clean JD → A-G evaluation → report,
// end to end on the caller's key. The tracked, in-product replacement for the
// gitignored jobseeker.mjs eval path. No Claude Code, no provider SDKs.
//
//   import { evaluateUrl } from './engine/pipeline/evaluate-url.mjs';
//   const r = await evaluateUrl({ input: url, provider: 'anthropic', apiKey });
//   // r = { jd, evaluationText, summary, usage, model, reportMarkdown }
//
// Evaluation context (modes/_shared.md, modes/oferta.md, cv.md) is passed
// explicitly in the hosted product (per-tenant data); when omitted it loads from
// disk for local/CLI use.

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchJd } from '../scan/fetch-jd.mjs';
import { evaluateOffer, buildReportMarkdown } from '../eval/evaluate.mjs';

// engine/pipeline/evaluate-url.mjs → repo root
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function readIf(path, fallback = '') {
  try { return existsSync(path) ? readFileSync(path, 'utf8').trim() : fallback; } catch { return fallback; }
}

/** Load evaluation context (mode files + CV) from disk. Local/CLI use. */
export function loadEvalContext(root = ROOT) {
  return {
    shared: readIf(join(root, 'modes', '_shared.md')),
    oferta: readIf(join(root, 'modes', 'oferta.md')),
    cv: readIf(join(root, 'cv.md')),
  };
}

/**
 * Evaluate one posting from a URL or pasted text.
 * @param {object} o
 * @param {string} o.input    posting URL or raw JD text
 * @param {string} [o.shared] modes/_shared.md content (falls back to disk)
 * @param {string} [o.oferta] modes/oferta.md content (falls back to disk)
 * @param {string} [o.cv]     cv.md content (falls back to disk)
 * @param {string} [o.provider="anthropic"]
 * @param {string} [o.model]
 * @param {string} [o.apiKey] per-call key (falls back to the provider env var)
 * @param {string} [o.date]   report date (YYYY-MM-DD); defaults to today
 * @param {object} [o.store]  tenant-scoped store; if given with tenantId, the role
 *                            + report are persisted (engine/store/store.mjs interface)
 * @param {string} [o.tenantId] tenant to persist under
 * @returns {Promise<{jd, evaluationText, summary, usage, model, reportMarkdown, persisted}>}
 */
export async function evaluateUrl({
  input, shared, oferta, cv,
  provider = 'anthropic', model, apiKey, date, fetchImpl, productName,
  store, tenantId,
} = {}) {
  if (!input) throw new Error('evaluateUrl: input (URL or JD text) is required');

  const needDisk = shared === undefined || oferta === undefined || cv === undefined;
  const disk = needDisk ? loadEvalContext() : { shared: '', oferta: '', cv: '' };
  const ctx = {
    shared: shared ?? disk.shared,
    oferta: oferta ?? disk.oferta,
    cv: cv ?? disk.cv,
  };

  const jd = await fetchJd(input, { fetchImpl });
  const result = await evaluateOffer({
    jdText: jd.text, ...ctx, provider, model, apiKey, fetchImpl, productName,
  });
  const reportDate = date || new Date().toISOString().slice(0, 10);
  const reportMarkdown = buildReportMarkdown({
    summary: result.summary,
    evaluationText: result.evaluationText,
    toolLabel: `${provider}${result.model ? ` (${result.model})` : ''}`,
    date: reportDate,
  });

  // Persist into the tenant-scoped store when one is provided (hosted path).
  let persisted = null;
  if (store && tenantId) {
    const scoreNum = Number.parseFloat(result.summary.score);
    const role = store.saveRole(tenantId, {
      company: result.summary.company || 'Unknown',
      title: result.summary.role || 'Unknown',
      status: 'Evaluated',
      score: Number.isFinite(scoreNum) ? scoreNum : null,
      url: jd.url,
      source: jd.source,
      jdText: jd.text,
    });
    const report = store.saveReport(tenantId, { roleId: role.id, markdown: reportMarkdown, score: role.score });
    persisted = { role, report };
  }

  return { jd, ...result, reportMarkdown, persisted };
}
