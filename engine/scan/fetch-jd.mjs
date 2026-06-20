// Programmatic JD fetcher — the server-side replacement for Claude Code's browser.
//
// Given a posting URL (or raw pasted text), return clean job-description text the
// evaluator can score. Known ATS hosts (Greenhouse, Lever) are read through their
// JSON APIs for structured, reliable text; everything else falls back to a generic
// HTML→text extraction. Pasted text passes straight through.
//
//   import { fetchJd } from './engine/scan/fetch-jd.mjs';
//   const { text, source, title } = await fetchJd(urlOrText);
//
// Pure helpers (detectPostingHost / htmlToText / extractGreenhouse / extractLever)
// are exported for testing. fetchJd() does the one network call.

const FETCH_TIMEOUT_MS = 12_000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/', '#47': '/' };

/** Decode the common HTML entities that show up in ATS content fields. Pure. */
export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+|#x?[0-9a-fA-F]+);/g, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

/** Strip HTML to readable text: drop script/style, keep line/list structure. Pure. */
export function htmlToText(html = '') {
  const withBreaks = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|section|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withBreaks)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Identify a single-posting ATS host from a URL. Pure. Returns null if unknown. */
export function detectPostingHost(url = '') {
  const u = String(url);
  let m = u.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (m) return { host: 'greenhouse', board: m[1], id: m[2] };
  m = u.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-fA-F-]{8,})/);
  if (m) return { host: 'lever', company: m[1], id: m[2] };
  return null;
}

export function greenhouseApiUrl({ board, id }) {
  return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?content=true`;
}
export function leverApiUrl({ company, id }) {
  return `https://api.lever.co/v0/postings/${company}/${id}`;
}

/** Greenhouse job JSON → clean text. Pure. (content is HTML-entity-encoded HTML.) */
export function extractGreenhouse(json = {}) {
  const title = json.title || '';
  const location = json.location?.name || '';
  const body = htmlToText(decodeEntities(json.content || ''));
  return { title, company: json.company_name || '', text: [title, location, '', body].filter((l) => l !== undefined).join('\n').trim() };
}

/** Lever posting JSON → clean text. Pure. */
export function extractLever(json = {}) {
  const title = json.text || '';
  const location = json.categories?.location || '';
  const intro = json.descriptionPlain || htmlToText(json.description || '');
  const lists = (json.lists || []).map((l) => `\n${l.text || ''}\n${htmlToText(l.content || '')}`).join('\n');
  const closing = json.additionalPlain || htmlToText(json.additional || '');
  return { title, company: '', text: [title, location, '', intro, lists, closing].join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

function looksLikeUrl(s = '') {
  return /^https?:\/\//i.test(String(s).trim());
}

async function fetchWithTimeout(doFetch, url, { timeoutMs, json }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'HireloomBot/1.0 (+https://hireloom.app)' } });
    if (!res.ok) throw new Error(`JD fetch HTTP ${res.status} for ${url}`);
    return json ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and clean a job description.
 * @param {string} input  a posting URL, or raw pasted JD text
 * @param {object} [opts]
 * @returns {Promise<{text:string, source:string, title:string, company:string, url:string|null}>}
 */
export async function fetchJd(input, { fetchImpl, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('fetchJd: input is required');

  // Pasted text → pass through.
  if (!looksLikeUrl(raw)) {
    return { text: raw, source: 'text', title: '', company: '', url: null };
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('fetchJd: no fetch available (pass fetchImpl)');

  const host = detectPostingHost(raw);

  if (host?.host === 'greenhouse') {
    const json = await fetchWithTimeout(doFetch, greenhouseApiUrl(host), { timeoutMs, json: true });
    const { title, company, text } = extractGreenhouse(json);
    return { text, source: 'greenhouse', title, company, url: raw };
  }
  if (host?.host === 'lever') {
    const json = await fetchWithTimeout(doFetch, leverApiUrl(host), { timeoutMs, json: true });
    const { title, text } = extractLever(json);
    return { text, source: 'lever', title, company: '', url: raw };
  }

  // Unknown host (Ashby, Workday, company sites): best-effort HTML extraction.
  const html = await fetchWithTimeout(doFetch, raw, { timeoutMs, json: false });
  const text = htmlToText(html);
  return { text, source: 'html', title: '', company: '', url: raw };
}
