/**
 * tests/portals-edit.test.mjs — surgical, comment-preserving portals.yml edits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readPortals, toggleEnabled, addQuery, addCompany, addFilterTerm, removeFilterTerm,
  validatePortalsAction, applyPortalsAction,
} from '../apps/web/lib/portals-edit.mjs';

const FIXTURE = `# Portal Scanner Configuration
# Customize by setting enabled: false on companies you don't care about

title_filter:
  positive:
    # -- Core PM --
    - "Project Manager"
    - "Program Manager"
    # -- IT / Delivery --
    - "Delivery Manager"
  negative:
    - "Intern"

location_filter:
  positive:
    - "Canada"
  negative:
    - "Bangalore"

search_queries:
  # NOTE: only WebFetch-readable boards
  - name: PM — Project/Program Canada
    query: 'site:greenhouse.io "Project Manager" Canada'
    enabled: true

  - name: Ops stream
    query: 'site:lever.co Operations'
    enabled: false

tracked_companies:

  # -- Canadian Tech --

  - name: Cohere
    careers_url: https://jobs.ashbyhq.com/cohere
    api_provider: ashby
    notes: "Toronto AI co."
    enabled: true

  - name: Klue
    careers_url: https://jobs.ashbyhq.com/klue
    api_provider: ashby
    enabled: true
`;

function blockText(text, key) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => new RegExp('^' + key + ':').test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^[A-Za-z_]/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

test('readPortals parses filters + queries + companies', () => {
  const p = readPortals(FIXTURE);
  assert.deepEqual(p.title_filter.positive, ['Project Manager', 'Program Manager', 'Delivery Manager']);
  assert.deepEqual(p.location_filter.negative, ['Bangalore']);
  assert.equal(p.search_queries.length, 2);
  assert.equal(p.search_queries[0].name, 'PM — Project/Program Canada');
  assert.equal(p.search_queries[1].enabled, false);
  assert.equal(p.tracked_companies.length, 2);
  assert.equal(p.tracked_companies[0].name, 'Cohere');
  assert.equal(p.tracked_companies[0].api_provider, 'ashby');
});

test('toggleEnabled flips a company in place, keeps section comments + siblings', () => {
  const out = toggleEnabled(FIXTURE, 'tracked_companies', 'Cohere', false);
  const p = readPortals(out);
  assert.equal(p.tracked_companies.find(c => c.name === 'Cohere').enabled, false);
  assert.equal(p.tracked_companies.find(c => c.name === 'Klue').enabled, true, 'sibling untouched');
  assert.ok(out.includes('# -- Canadian Tech --'), 'section comment survives');
  assert.ok(out.includes('notes: "Toronto AI co."'), 'notes survive');
});

test('toggleEnabled inserts enabled: when the item has none', () => {
  // remove Klue's enabled line first to simulate an item without it
  const noEnabled = FIXTURE.replace('  - name: Klue\n    careers_url: https://jobs.ashbyhq.com/klue\n    api_provider: ashby\n    enabled: true',
    '  - name: Klue\n    careers_url: https://jobs.ashbyhq.com/klue\n    api_provider: ashby');
  const out = toggleEnabled(noEnabled, 'tracked_companies', 'Klue', false);
  assert.match(out, /- name: Klue\n {4}enabled: false/);
});

test('toggleEnabled flips a search query, not the wrong one', () => {
  const out = toggleEnabled(FIXTURE, 'search_queries', 'Ops stream', true);
  const p = readPortals(out);
  assert.equal(p.search_queries.find(q => q.name === 'Ops stream').enabled, true);
  assert.equal(p.search_queries.find(q => q.name === 'PM — Project/Program Canada').enabled, true);
});

test('addFilterTerm appends without touching section comments; dedups', () => {
  const out = addFilterTerm(FIXTURE, 'title_filter', 'positive', 'Scrum Master');
  assert.deepEqual(readPortals(out).title_filter.positive, ['Project Manager', 'Program Manager', 'Delivery Manager', 'Scrum Master']);
  assert.ok(out.includes('# -- Core PM --') && out.includes('# -- IT / Delivery --'), 'both section comments survive');
  // dedup: adding an existing term is a no-op
  assert.equal(addFilterTerm(out, 'title_filter', 'positive', 'Scrum Master'), out);
});

test('removeFilterTerm deletes one term, keeps the rest + comments', () => {
  const out = removeFilterTerm(FIXTURE, 'title_filter', 'positive', 'Program Manager');
  assert.deepEqual(readPortals(out).title_filter.positive, ['Project Manager', 'Delivery Manager']);
  assert.ok(out.includes('# -- Core PM --'));
});

test('addQuery + addCompany append valid items', () => {
  let out = addQuery(FIXTURE, { name: 'New Stream', query: "site:x.io PM", enabled: true });
  const q = readPortals(out).search_queries;
  assert.equal(q.length, 3);
  assert.equal(q[2].name, 'New Stream');
  out = addCompany(out, { name: 'Shopify', careers_url: 'https://shopify.com', api_provider: 'greenhouse', notes: 'big', enabled: false });
  const c = readPortals(out).tracked_companies;
  assert.equal(c.length, 3);
  assert.equal(c[2].name, 'Shopify');
  assert.equal(c[2].enabled, false);
});

test('a company name with a colon is quoted so YAML stays valid', () => {
  const out = addCompany(FIXTURE, { name: 'Acme: Inc', enabled: true });
  assert.match(out, /- name: "Acme: Inc"/);
});

test('editing one section leaves the OTHER top-level blocks byte-identical', () => {
  const out = toggleEnabled(FIXTURE, 'tracked_companies', 'Cohere', false);
  assert.equal(blockText(out, 'title_filter'), blockText(FIXTURE, 'title_filter'));
  assert.equal(blockText(out, 'location_filter'), blockText(FIXTURE, 'location_filter'));
  assert.equal(blockText(out, 'search_queries'), blockText(FIXTURE, 'search_queries'));
});

test('validatePortalsAction guards the inputs', () => {
  assert.deepEqual(validatePortalsAction({ action: 'toggle', list: 'tracked_companies', name: 'Cohere', enabled: false }), []);
  assert.ok(validatePortalsAction({ action: 'nope' }).length);
  assert.ok(validatePortalsAction({ action: 'toggle', list: 'bad', name: 'x' }).length);
  assert.ok(validatePortalsAction({ action: 'add-term', group: 'title_filter', kind: 'bad', value: 'x' }).length);
});

test('applyPortalsAction dispatches', () => {
  const out = applyPortalsAction(FIXTURE, { action: 'toggle', list: 'tracked_companies', name: 'Klue', enabled: false });
  assert.equal(readPortals(out).tracked_companies.find(c => c.name === 'Klue').enabled, false);
});
