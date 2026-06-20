import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUrl } from '../engine/pipeline/evaluate-url.mjs';

const EVAL_TEXT = `## A) Role\nStrong fit.\n\n---SCORE_SUMMARY---
COMPANY: Anthropic
ROLE: Applied AI Engineer
SCORE: 4.6
ARCHETYPE: AI/Automation
LEGITIMACY: High Confidence
---END_SUMMARY---`;

// One fake fetch that routes by URL: Greenhouse JD API vs Anthropic eval API.
function routedFetch() {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (/greenhouse/.test(url)) {
      return resp({ title: 'ML Eng', location: { name: 'Remote' }, content: '&lt;p&gt;Do ML&lt;/p&gt;' });
    }
    if (/api\.anthropic\.com/.test(url)) {
      return resp({ content: [{ type: 'text', text: EVAL_TEXT }], usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-sonnet-4-0', stop_reason: 'end_turn' });
    }
    throw new Error('unexpected url ' + url);
  };
  fn.calls = calls;
  return fn;
}
function resp(json) { return { ok: true, status: 200, json: async () => json, text: async () => '' }; }

test('evaluateUrl: Greenhouse URL → JD fetch → evaluation → report', async () => {
  const ff = routedFetch();
  const r = await evaluateUrl({
    input: 'https://job-boards.greenhouse.io/acme/jobs/1',
    shared: 'S', oferta: 'O', cv: 'C',
    provider: 'anthropic', model: 'claude-sonnet-4-0', apiKey: 'k',
    date: '2026-06-20', fetchImpl: ff,
  });
  // JD came through the Greenhouse path
  assert.equal(r.jd.source, 'greenhouse');
  assert.match(r.jd.text, /Do ML/);
  // evaluation parsed
  assert.equal(r.summary.company, 'Anthropic');
  assert.equal(r.summary.score, '4.6');
  // report assembled
  assert.match(r.reportMarkdown, /^# Evaluation: Anthropic — Applied AI Engineer/);
  assert.match(r.reportMarkdown, /\*\*Date:\*\* 2026-06-20/);
  // both endpoints were hit, JD first
  assert.match(ff.calls[0], /greenhouse/);
  assert.match(ff.calls[1], /anthropic\.com/);
});

test('evaluateUrl: pasted text skips JD fetch, evaluates directly', async () => {
  const ff = routedFetch();
  const r = await evaluateUrl({
    input: 'We are hiring a Staff AI Engineer to own evals...',
    shared: 'S', oferta: 'O', cv: 'C',
    provider: 'anthropic', model: 'claude-sonnet-4-0', apiKey: 'k',
    fetchImpl: ff,
  });
  assert.equal(r.jd.source, 'text');
  assert.equal(ff.calls.length, 1);            // only the eval call, no JD fetch
  assert.match(ff.calls[0], /anthropic\.com/);
  assert.equal(r.summary.company, 'Anthropic');
});

test('evaluateUrl requires input', async () => {
  await assert.rejects(() => evaluateUrl({ provider: 'anthropic', apiKey: 'k' }), /input .* is required/);
});
