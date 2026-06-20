import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvalSystemPrompt, parseScoreSummary, buildReportMarkdown, evaluateOffer } from '../engine/eval/evaluate.mjs';

const SUMMARY = `---SCORE_SUMMARY---
COMPANY: Anthropic
ROLE: Applied AI Engineer
SCORE: 4.6
ARCHETYPE: AI/Automation
LEGITIMACY: High Confidence
---END_SUMMARY---`;

const EVAL_TEXT = `## A) Role summary\nGreat fit.\n\n${SUMMARY}`;

// fake Gemini response (matches the provider chokepoint's gemini parser)
function fakeGeminiFetch(text) {
  const fn = async (url, init) => {
    fn.lastUrl = url; fn.lastBody = init?.body ? JSON.parse(init.body) : undefined;
    return {
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }),
      text: async () => '',
    };
  };
  return fn;
}

test('buildEvalSystemPrompt embeds shared, oferta, cv, brand, and the summary contract', () => {
  const p = buildEvalSystemPrompt({ shared: 'SHARED_X', oferta: 'OFERTA_Y', cv: 'CV_Z', productName: 'Hireloom' });
  assert.match(p, /Hireloom/);
  assert.match(p, /SHARED_X/);
  assert.match(p, /OFERTA_Y/);
  assert.match(p, /CV_Z/);
  assert.match(p, /---SCORE_SUMMARY---/);
  assert.match(p, /A through G/);
});

test('parseScoreSummary extracts all fields from a valid block', () => {
  const s = parseScoreSummary(EVAL_TEXT);
  assert.deepEqual(s, { company: 'Anthropic', role: 'Applied AI Engineer', score: '4.6', archetype: 'AI/Automation', legitimacy: 'High Confidence' });
});

test('parseScoreSummary returns all-unknown when no block present', () => {
  const s = parseScoreSummary('no summary here');
  assert.deepEqual(s, { company: 'unknown', role: 'unknown', score: '?', archetype: 'unknown', legitimacy: 'unknown' });
});

test('buildReportMarkdown writes the canonical header and strips the summary block', () => {
  const summary = parseScoreSummary(EVAL_TEXT);
  const md = buildReportMarkdown({ summary, evaluationText: EVAL_TEXT, toolLabel: 'Gemini (gemini-2.0-flash)', date: '2026-06-20' });
  assert.match(md, /^# Evaluation: Anthropic — Applied AI Engineer/);
  assert.match(md, /\*\*Score:\*\* 4\.6\/5/);
  assert.match(md, /\*\*Legitimacy:\*\* High Confidence/);
  assert.match(md, /\*\*Tool:\*\* Gemini \(gemini-2\.0-flash\)/);
  assert.match(md, /## A\) Role summary/);
  assert.doesNotMatch(md, /SCORE_SUMMARY/); // summary block stripped from the body
});

test('evaluateOffer runs through the chokepoint and returns text + parsed summary', async () => {
  const ff = fakeGeminiFetch(EVAL_TEXT);
  const r = await evaluateOffer({
    jdText: 'Senior Applied AI Engineer at Anthropic...',
    shared: 'S', oferta: 'O', cv: 'C',
    provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'g-key',
    fetchImpl: ff,
  });
  assert.match(ff.lastUrl, /:generateContent\?key=g-key$/);
  assert.match(ff.lastBody.contents[0].parts[0].text, /JOB DESCRIPTION TO EVALUATE/);
  assert.equal(r.summary.company, 'Anthropic');
  assert.equal(r.summary.score, '4.6');
  assert.match(r.evaluationText, /Role summary/);
  assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 50 });
});

test('evaluateOffer rejects empty JD', async () => {
  await assert.rejects(() => evaluateOffer({ jdText: '   ', provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'k', fetchImpl: fakeGeminiFetch(EVAL_TEXT) }), /jdText is required/);
});
