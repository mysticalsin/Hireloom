/**
 * apps/web/lib/portals-edit.mjs — surgical, comment-preserving editor for
 * portals.yml (Phase A1 Settings → Scan & Portals).
 *
 * portals.yml is a heavily-curated file: the title/location filter lists are
 * broken up by `# -- section --` comments, and each company/query carries
 * notes. So — exactly like profile-edit — we never re-emit a whole list. We
 * edit ITEM BY ITEM: toggle a single `enabled:` line, append one item, or
 * delete one filter term. Everything else (comments, ordering, the other
 * items) is left byte-for-byte intact.
 *
 * Pure: no I/O, no module state — unit-testable.
 */

function unq(s) {
  s = String(s == null ? '' : s).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s;
}

// Top-level block `key:` → {start, end} (end exclusive), or null.
function findTop(lines, key) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) { if (new RegExp('^' + key + ':').test(lines[i])) { start = i; break; } }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^[A-Za-z_]/.test(lines[i])) { end = i; break; } }
  return { start, end };
}

// A child key (`  child:`) inside a top-level block → {start, end} of the child
// sub-block (end = next sibling child at the same indent, or parent end).
function findChild(lines, parent, child) {
  const p = findTop(lines, parent);
  if (!p) return null;
  let start = -1, indent = '';
  for (let i = p.start + 1; i < p.end; i++) {
    const m = lines[i].match(new RegExp('^(\\s+)' + child + ':\\s*$'));
    if (m) { start = i; indent = m[1]; break; }
  }
  if (start === -1) return null;
  let end = p.end;
  for (let i = start + 1; i < p.end; i++) {
    const m = lines[i].match(/^(\s*)\S/);
    if (m && m[1].length <= indent.length && !/^\s*-/.test(lines[i])) { end = i; break; }
  }
  return { start, end, indent };
}

// Read a `- "value"` item list under parent.child (comments/blanks ignored).
function readTermList(lines, parent, child) {
  const blk = findChild(lines, parent, child);
  if (!blk) return [];
  const out = [];
  for (let i = blk.start + 1; i < blk.end; i++) {
    const m = lines[i].match(/^\s+-\s+(.*)$/);
    if (m) out.push(unq(m[1]));
  }
  return out;
}

// Walk a top-level object list (search_queries / tracked_companies) into items.
function readObjectList(lines, key, fields) {
  const blk = findTop(lines, key);
  if (!blk) return [];
  const items = [];
  let cur = null;
  for (let i = blk.start + 1; i < blk.end; i++) {
    const dash = lines[i].match(/^(\s*)-\s+(\w+):\s*(.*)$/);
    if (dash) { if (cur) items.push(cur); cur = { [dash[2]]: unq(dash[3]) }; continue; }
    const cont = lines[i].match(/^\s+(\w+):\s*(.*)$/);
    if (cont && cur) { cur[cont[1]] = unq(cont[2]); continue; }
  }
  if (cur) items.push(cur);
  return items.map(it => { const o = {}; for (const f of fields) o[f] = it[f] != null ? it[f] : ''; return o; });
}

export function readPortals(text) {
  const lines = String(text || '').split('\n');
  return {
    title_filter: {
      positive: readTermList(lines, 'title_filter', 'positive'),
      negative: readTermList(lines, 'title_filter', 'negative'),
      seniority_boost: readTermList(lines, 'title_filter', 'seniority_boost'),
    },
    location_filter: {
      positive: readTermList(lines, 'location_filter', 'positive'),
      negative: readTermList(lines, 'location_filter', 'negative'),
    },
    search_queries: readObjectList(lines, 'search_queries', ['name', 'query', 'enabled'])
      .map(q => ({ name: q.name, query: q.query, enabled: q.enabled !== 'false' && q.enabled !== false })),
    tracked_companies: readObjectList(lines, 'tracked_companies', ['name', 'careers_url', 'api_provider', 'notes', 'enabled'])
      .map(c => ({ name: c.name, careers_url: c.careers_url, api_provider: c.api_provider, notes: c.notes,
        enabled: c.enabled !== 'false' && c.enabled !== false })),
  };
}

// Flip (or insert) the `enabled:` line of the item named `name` in a top-level
// object list. Returns the new text. Matches name quoted or unquoted.
export function toggleEnabled(text, listKey, name, enabled) {
  const lines = String(text || '').split('\n');
  const blk = findTop(lines, listKey);
  if (!blk) return text;
  const want = String(name).trim();
  let i = blk.start + 1;
  while (i < blk.end) {
    const dash = lines[i].match(/^(\s*)-\s+name:\s*(.*)$/);
    if (!dash) { i++; continue; }
    if (unq(dash[2]) !== want) { i++; continue; }
    const itemIndent = dash[1].length;
    // scan this item's fields (until the next `- ` at the same indent or block end)
    let enabledLine = -1, j = i + 1;
    for (; j < blk.end; j++) {
      const d2 = lines[j].match(/^(\s*)-\s/);
      if (d2 && d2[1].length === itemIndent) break;        // next item
      if (/^\s+enabled:/.test(lines[j])) { enabledLine = j; break; }
    }
    const val = enabled ? 'true' : 'false';
    if (enabledLine >= 0) {
      lines[enabledLine] = lines[enabledLine].replace(/enabled:\s*\S+/, `enabled: ${val}`);
    } else {
      // insert enabled: right under the - name: line, at field indent (+2)
      lines.splice(i + 1, 0, `${' '.repeat(itemIndent + 2)}enabled: ${val}`);
    }
    return lines.join('\n');
  }
  return text;
}

// Append a search query item to search_queries.
export function addQuery(text, { name, query, enabled = true }) {
  const lines = String(text || '').split('\n');
  const blk = findTop(lines, 'search_queries');
  const item = [
    `  - name: ${yq(name)}`,
    `    query: ${sq(query)}`,
    `    enabled: ${enabled ? 'true' : 'false'}`,
  ];
  return insertIntoList(lines, blk, item).join('\n');
}

// Append a tracked company item.
export function addCompany(text, { name, careers_url = '', api_provider = '', notes = '', enabled = true }) {
  const lines = String(text || '').split('\n');
  const blk = findTop(lines, 'tracked_companies');
  const item = [`  - name: ${yq(name)}`];
  if (careers_url) item.push(`    careers_url: ${careers_url}`);
  if (api_provider) item.push(`    api_provider: ${api_provider}`);
  if (notes) item.push(`    notes: ${dq(notes)}`);
  item.push(`    enabled: ${enabled ? 'true' : 'false'}`);
  return insertIntoList(lines, blk, item).join('\n');
}

// Add / remove a single filter term (preserves all section comments).
export function addFilterTerm(text, group, kind, value) {
  const lines = String(text || '').split('\n');
  const blk = findChild(lines, group, kind);
  if (!blk) return text;
  const v = String(value).trim();
  if (!v || readTermList(lines, group, kind).includes(v)) return text;   // no dup
  // find indent of existing items, default child+2
  let itemIndent = '    ';
  for (let i = blk.start + 1; i < blk.end; i++) {
    const m = lines[i].match(/^(\s+)-\s/);
    if (m) { itemIndent = m[1]; break; }
  }
  // append after the last item line in the sub-block
  let insertAt = blk.start + 1;
  for (let i = blk.start + 1; i < blk.end; i++) if (/^\s+-\s/.test(lines[i])) insertAt = i + 1;
  lines.splice(insertAt, 0, `${itemIndent}- ${dq(v)}`);
  return lines.join('\n');
}

export function removeFilterTerm(text, group, kind, value) {
  const lines = String(text || '').split('\n');
  const blk = findChild(lines, group, kind);
  if (!blk) return text;
  const v = String(value).trim();
  for (let i = blk.start + 1; i < blk.end; i++) {
    const m = lines[i].match(/^\s+-\s+(.*)$/);
    if (m && unq(m[1]) === v) { lines.splice(i, 1); break; }
  }
  return lines.join('\n');
}

function insertIntoList(lines, blk, itemLines) {
  if (!blk) return lines;                       // list key missing — bail safely
  // append after the last line of the list block (before any trailing blanks)
  let insertAt = blk.end;
  while (insertAt - 1 > blk.start && lines[insertAt - 1].trim() === '') insertAt--;
  lines.splice(insertAt, 0, '', ...itemLines);
  return lines;
}

// double-quote (notes/terms); preserve single-quote style for queries.
function dq(s) { return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function sq(s) { const v = String(s == null ? '' : s); return v.includes("'") ? dq(v) : `'${v}'`; }
// names: quote only if they contain a colon/# (YAML-sensitive), else bare.
function yq(s) { const v = String(s == null ? '' : s).trim(); return /[:#]/.test(v) ? dq(v) : v; }

// Validate an incoming portals action. Returns string[] (empty = ok).
export function validatePortalsAction(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['payload required'];
  const A = ['toggle', 'add-query', 'add-company', 'add-term', 'remove-term'];
  if (!A.includes(p.action)) errors.push('unknown action');
  if (p.action === 'toggle') {
    if (!['search_queries', 'tracked_companies'].includes(p.list)) errors.push('bad list');
    if (!p.name || String(p.name).length > 200) errors.push('bad name');
  }
  if (p.action === 'add-query') {
    if (!p.name || String(p.name).length > 200) errors.push('query name required');
    if (!p.query || String(p.query).length > 1000) errors.push('query text required');
  }
  if (p.action === 'add-company') {
    if (!p.name || String(p.name).length > 200) errors.push('company name required');
    for (const k of ['careers_url', 'api_provider', 'notes']) if (p[k] != null && String(p[k]).length > 600) errors.push(`${k} too long`);
  }
  if (p.action === 'add-term' || p.action === 'remove-term') {
    if (!['title_filter', 'location_filter'].includes(p.group)) errors.push('bad group');
    if (!['positive', 'negative', 'seniority_boost'].includes(p.kind)) errors.push('bad kind');
    if (!p.value || String(p.value).length > 200) errors.push('term required');
  }
  return errors;
}

export function applyPortalsAction(text, p) {
  switch (p.action) {
    case 'toggle': return toggleEnabled(text, p.list, p.name, !!p.enabled);
    case 'add-query': return addQuery(text, { name: p.name, query: p.query, enabled: p.enabled !== false });
    case 'add-company': return addCompany(text, { name: p.name, careers_url: p.careers_url, api_provider: p.api_provider, notes: p.notes, enabled: p.enabled !== false });
    case 'add-term': return addFilterTerm(text, p.group, p.kind, p.value);
    case 'remove-term': return removeFilterTerm(text, p.group, p.kind, p.value);
    default: return text;
  }
}
