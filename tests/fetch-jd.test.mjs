import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchJd, decodeEntities, htmlToText, detectPostingHost,
  extractGreenhouse, extractLever, greenhouseApiUrl, leverApiUrl,
} from '../engine/scan/fetch-jd.mjs';

function fakeFetch({ json, text, status = 200 }) {
  const fn = async (url) => {
    fn.lastUrl = url;
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => text };
  };
  return fn;
}

test('decodeEntities handles named and numeric entities', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x27;f&#x27;&nbsp;g'), 'a & b <c> "d" \'e\' \'f\' g');
});

test('htmlToText strips scripts/styles/tags, keeps bullets and line breaks', () => {
  const html = '<style>x{}</style><script>bad()</script><p>Hello &amp; welcome</p><ul><li>One</li><li>Two</li></ul>';
  const t = htmlToText(html);
  assert.match(t, /Hello & welcome/);
  assert.match(t, /• One/);
  assert.match(t, /• Two/);
  assert.doesNotMatch(t, /bad\(\)/);
  assert.doesNotMatch(t, /<\/?p>/);
});

test('detectPostingHost recognizes Greenhouse and Lever, else null', () => {
  assert.deepEqual(detectPostingHost('https://job-boards.greenhouse.io/acme/jobs/12345'), { host: 'greenhouse', board: 'acme', id: '12345' });
  assert.deepEqual(detectPostingHost('https://boards.eu.greenhouse.io/acme/jobs/9'), { host: 'greenhouse', board: 'acme', id: '9' });
  assert.deepEqual(detectPostingHost('https://jobs.lever.co/acme/0a1b2c3d-4e5f-6789-abcd-ef0123456789'), { host: 'lever', company: 'acme', id: '0a1b2c3d-4e5f-6789-abcd-ef0123456789' });
  assert.equal(detectPostingHost('https://careers.example.com/job/1'), null);
});

test('API url builders', () => {
  assert.equal(greenhouseApiUrl({ board: 'acme', id: '12' }), 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/12?content=true');
  assert.equal(leverApiUrl({ company: 'acme', id: 'xyz' }), 'https://api.lever.co/v0/postings/acme/xyz');
});

test('extractGreenhouse decodes entity-encoded HTML content', () => {
  const json = { title: 'Senior AI Engineer', location: { name: 'Remote' }, content: '&lt;p&gt;Build &amp; ship.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;' };
  const { title, text } = extractGreenhouse(json);
  assert.equal(title, 'Senior AI Engineer');
  assert.match(text, /Senior AI Engineer/);
  assert.match(text, /Remote/);
  assert.match(text, /Build & ship\./);
  assert.match(text, /• Python/);
});

test('extractLever combines descriptionPlain and lists', () => {
  const json = { text: 'Staff Engineer', categories: { location: 'NYC' }, descriptionPlain: 'We need a builder.', lists: [{ text: 'Requirements', content: '<ul><li>Go</li><li>K8s</li></ul>' }] };
  const { title, text } = extractLever(json);
  assert.equal(title, 'Staff Engineer');
  assert.match(text, /NYC/);
  assert.match(text, /We need a builder\./);
  assert.match(text, /Requirements/);
  assert.match(text, /• Go/);
  assert.match(text, /• K8s/);
});

test('fetchJd passes raw pasted text straight through', async () => {
  const r = await fetchJd('We are hiring a Product Manager to lead...');
  assert.equal(r.source, 'text');
  assert.equal(r.url, null);
  assert.match(r.text, /Product Manager/);
});

test('fetchJd uses the Greenhouse API for a Greenhouse posting URL', async () => {
  const ff = fakeFetch({ json: { title: 'ML Eng', location: { name: 'Remote' }, content: '&lt;p&gt;Do ML&lt;/p&gt;' } });
  const r = await fetchJd('https://job-boards.greenhouse.io/acme/jobs/777', { fetchImpl: ff });
  assert.match(ff.lastUrl, /boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs\/777\?content=true/);
  assert.equal(r.source, 'greenhouse');
  assert.equal(r.title, 'ML Eng');
  assert.match(r.text, /Do ML/);
});

test('fetchJd uses the Lever API for a Lever posting URL', async () => {
  const ff = fakeFetch({ json: { text: 'Backend Eng', descriptionPlain: 'Build APIs.', lists: [] } });
  const r = await fetchJd('https://jobs.lever.co/acme/0a1b2c3d-4e5f-6789-abcd-ef0123456789', { fetchImpl: ff });
  assert.match(ff.lastUrl, /api\.lever\.co\/v0\/postings\/acme\//);
  assert.equal(r.source, 'lever');
  assert.match(r.text, /Build APIs\./);
});

test('fetchJd falls back to HTML extraction for unknown hosts', async () => {
  const ff = fakeFetch({ text: '<html><body><h1>Role</h1><p>Join &amp; build</p></body></html>' });
  const r = await fetchJd('https://careers.example.com/job/123', { fetchImpl: ff });
  assert.equal(ff.lastUrl, 'https://careers.example.com/job/123');
  assert.equal(r.source, 'html');
  assert.match(r.text, /Join & build/);
});

test('fetchJd throws on empty input and on non-OK responses', async () => {
  await assert.rejects(() => fetchJd('   '), /input is required/);
  const ff = fakeFetch({ json: {}, status: 404 });
  await assert.rejects(() => fetchJd('https://job-boards.greenhouse.io/acme/jobs/1', { fetchImpl: ff }), /HTTP 404/);
});
