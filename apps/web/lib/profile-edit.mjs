/**
 * apps/web/lib/profile-edit.mjs — surgical, NON-DESTRUCTIVE editor for
 * config/profile.yml (Phase A1 Settings → Profile).
 *
 * Why not reuse serializeProfileYaml (the wizard's writer)? Because it RE-EMITS
 * the whole file from a fixed schema and silently drops every hand-added key —
 * `languages`, the extended `eeo_voluntary`, `application_answers`, flat
 * `education`, `cv.contact_location/experience_order` — plus all comments. For
 * an editor that saves a few fields, that's data loss (the autopilot reads
 * those dropped keys). So this module edits IN PLACE: it touches only the
 * specific scalar/list values it manages and leaves every other byte —
 * unmanaged keys, comments, ordering, indentation — exactly as it found them.
 *
 * Managed surface (the most-edited, safely round-trippable fields):
 *   candidate.{full_name,email,phone,location,linkedin}
 *   target_roles.primary[]
 *   narrative.{headline, superpowers[], best_achievement}
 *   compensation.{target_range,currency,minimum,location_flexibility}
 *   work_authorization.{legally_authorized_to_work,require_sponsorship,work_permit_type}
 *
 * Everything else (proof_points, EEO, application_answers, CV identity, …) is
 * left untouched and is edited in its own surface or by hand.
 *
 * Pure: no I/O, no module state — unit-testable.
 */
import { yamlQuote } from './onboard.mjs';

// The fields this editor owns, grouped by parent block. Edited IN PLACE — so
// adding the once-"lossy" blocks (application_answers, eeo_voluntary, languages)
// here is SAFE: the surgical setters touch only the named child line and leave
// sibling fields + comments untouched. (The danger was only the wizard's
// full-rewrite serializer, which this module never calls.)
export const MANAGED = {
  candidate:          { scalars: ['full_name', 'email', 'phone', 'location', 'linkedin'], lists: [] },
  target_roles:       { scalars: [], lists: ['primary'] },
  narrative:          { scalars: ['headline', 'best_achievement'], lists: ['superpowers'] },
  compensation:       { scalars: ['target_range', 'currency', 'minimum', 'location_flexibility'], lists: [] },
  work_authorization: { scalars: ['legally_authorized_to_work', 'require_sponsorship', 'work_permit_type'], lists: [] },
  application_answers:{ scalars: ['over_18', 'willing_to_relocate', 'notice_period', 'earliest_start_date', 'criminal_record', 'background_check_consent', 'current_company', 'drivers_license', 'own_vehicle', 'reliable_transportation', 'citizenship', 'nationality', 'sanctioned_country_national'], lists: [] },
  eeo_voluntary:      { scalars: ['gender', 'race_ethnicity', 'race_ethnicity_fallback', 'hispanic_latino', 'veteran_status', 'disability_status', 'sexual_orientation', 'transgender', 'pronouns'], lists: [] },
  languages:          { scalars: [], lists: ['fluent', 'none'] },
};

// Top-level free-text the user fully OWNS — stored as a YAML literal block,
// saved verbatim, reloaded as-is. We never parse or govern its contents; it is
// the catch-all where answers the autofiller could not find get added.
export const FREE_TEXT_KEY = 'additional_context';
// Top-level custom question→answer pairs the autofiller matches against.
export const CUSTOM_ANSWERS_KEY = 'custom_answers';

const MAX_SCALAR = 5000;
const MAX_LIST = 60;
const MAX_ITEM = 300;

function unquote(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1).replace(/\\(["\\nrt])/g, (_, c) => ({ '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' }[c]));
  }
  return s;
}

// Given the text after `key:`, return the trailing ` # comment` (with its
// leading whitespace) so an in-place value edit preserves hand-written inline
// annotations. Handles a quoted value that itself contains `#`.
function trailingComment(rest) {
  let after = String(rest || '');
  if (after.startsWith('"')) {
    let i = 1;
    while (i < after.length) {
      if (after[i] === '\\') { i += 2; continue; }
      if (after[i] === '"') { i++; break; }
      i++;
    }
    after = after.slice(i);
  }
  const m = after.match(/(\s+#.*)$/);
  return m ? m[1] : '';
}

// Find a top-level block `key:`; returns {start,end} line indices (end
// exclusive) or null. A block runs from its key line until the next line that
// begins a new top-level key (column-0, `word:`), or EOF.
function findBlock(lines, key) {
  const head = new RegExp('^' + key + ':\\s*(.*)$');
  let start = -1;
  for (let i = 0; i < lines.length; i++) { if (head.test(lines[i])) { start = i; break; } }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z_][\w-]*:/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

// Read a direct child scalar (`  child: "value"`) within a block → unquoted
// string, or '' if absent.
function getScalar(lines, block, child) {
  const re = new RegExp('^(\\s+)' + child + ':\\s*(.*)$');
  for (let i = block.start + 1; i < block.end; i++) {
    const m = lines[i].match(re);
    if (m) return unquote(m[2]);
  }
  return '';
}

// Read a direct child list (`  child:` then `    - "item"` lines) → string[].
function getList(lines, block, child) {
  const head = new RegExp('^(\\s+)' + child + ':\\s*(.*)$');
  for (let i = block.start + 1; i < block.end; i++) {
    const m = lines[i].match(head);
    if (!m) continue;
    const inline = m[2].trim();
    if (inline && inline !== '[]') {
      // inline flow list: child: ["a", "b"]
      const body = inline.replace(/^\[/, '').replace(/\]$/, '');
      return body.split(',').map(s => unquote(s)).filter(s => s !== '');
    }
    const items = [];
    const headIndent = m[1].length;
    for (let j = i + 1; j < block.end; j++) {
      const im = lines[j].match(/^(\s*)-\s?(.*)$/);
      if (im && im[1].length > headIndent) { items.push(unquote(im[2])); continue; }
      if (lines[j].trim() === '') continue;            // tolerate blank lines inside
      break;                                            // next sibling key ends the list
    }
    return items;
  }
  return [];
}

// Replace (or insert) a direct child scalar in place, preserving indentation.
function setScalar(lines, key, child, value) {
  const block = findBlock(lines, key);
  if (!block) return lines;
  const re = new RegExp('^(\\s+)' + child + ':\\s*(.*)$');
  for (let i = block.start + 1; i < block.end; i++) {
    const m = lines[i].match(re);
    if (m) { lines[i] = `${m[1]}${child}: ${yamlQuote(value)}${trailingComment(m[2])}`; return lines; } // update in place, keep inline comment
  }
  // Absent: only CREATE a field that has an actual value — never write empty
  // placeholders (a read→write round-trip of a sparse block must be a no-op).
  if (String(value) === '') return lines;
  // Append at the end of THIS block, before any trailing blank/column-0 comment
  // that introduces the next block.
  let insertAt = block.end;
  while (insertAt - 1 > block.start && (lines[insertAt - 1].trim() === '' || /^#/.test(lines[insertAt - 1]))) insertAt--;
  lines.splice(insertAt, 0, `  ${child}: ${yamlQuote(value)}`);
  return lines;
}

// Replace (or insert) a direct child list in place. Drops the old item run and
// any inline `[]`, emits block-style items at the detected (or default) indent.
function setList(lines, key, child, items) {
  const block = findBlock(lines, key);
  if (!block) return lines;
  const head = new RegExp('^(\\s+)' + child + ':\\s*(.*)$');
  for (let i = block.start + 1; i < block.end; i++) {
    const m = lines[i].match(head);
    if (!m) continue;
    const headIndent = m[1];
    // Preserve the original list STYLE: inline flow (`child: [a, b]`) stays
    // inline; block style stays block. Minimal-diff editing.
    if (m[2].trim().startsWith('[')) {
      lines[i] = items.length === 0
        ? `${headIndent}${child}: []`
        : `${headIndent}${child}: [${items.map(it => yamlQuote(it)).join(', ')}]`;
      return lines;
    }
    // figure out the existing item indent, else parent+2
    let itemIndent = headIndent + '  ';
    let j = i + 1;
    const span = [];
    for (; j < block.end; j++) {
      const im = lines[j].match(/^(\s*)-\s?(.*)$/);
      if (im && im[1].length > headIndent.length) { itemIndent = im[1]; span.push(j); continue; }
      if (lines[j].trim() === '' && span.length) { span.push(j); continue; } // swallow trailing blanks inside run
      break;
    }
    const newLines = (items.length === 0)
      ? [`${headIndent}${child}: []`]
      : [`${headIndent}${child}:`, ...items.map(it => `${itemIndent}- ${yamlQuote(it)}`)];
    const removeCount = 1 + span.length;           // header + item lines
    lines.splice(i, removeCount, ...newLines);
    return lines;
  }
  // absent → insert header + items under the parent
  const block2 = findBlock(lines, key);
  const ins = (items.length === 0)
    ? [`  ${child}: []`]
    : [`  ${child}:`, ...items.map(it => `    - ${yamlQuote(it)}`)];
  lines.splice(block2.start + 1, 0, ...ins);
  return lines;
}

// ── Top-level free-text block (YAML literal `key: |`) ──────────────────────
// Read a top-level literal/inline block scalar → string ('' if absent).
function getBlockScalar(lines, key) {
  const block = findBlock(lines, key);
  if (!block) return '';
  const hm = lines[block.start].match(new RegExp('^' + key + ':\\s*(.*)$'));
  const inline = hm ? hm[1].trim() : '';
  if (inline && !/^[|>]/.test(inline)) return unquote(inline);   // inline scalar form
  const body = [];
  let baseIndent = null;
  for (let i = block.start + 1; i < block.end; i++) {
    if (lines[i].trim() === '') { body.push(''); continue; }
    const m = lines[i].match(/^(\s+)(.*)$/);
    if (!m) break;
    if (baseIndent == null) baseIndent = m[1].length;
    body.push(lines[i].slice(baseIndent));
  }
  while (body.length && body[body.length - 1] === '') body.pop();
  return body.join('\n');
}

// Replace/insert a top-level literal block. Empty value removes the key.
// Every body line is indented 2 spaces, so arbitrary user text (even a line
// that looks like `key:`) stays inert inside the block — no YAML injection.
function setBlockScalar(lines, key, value) {
  const block = findBlock(lines, key);
  const v = String(value == null ? '' : value).replace(/\s+$/, '');
  const newLines = v.trim() === '' ? [] : [`${key}: |`, ...v.split('\n').map(l => '  ' + l)];
  if (block) lines.splice(block.start, block.end - block.start, ...newLines);
  else if (newLines.length) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(...newLines);
  }
  return lines;
}

// ── Top-level object list (e.g. custom_answers: [{question, answer}]) ──────
function getObjectList(lines, key, fields) {
  const block = findBlock(lines, key);
  if (!block) return [];
  const items = [];
  let cur = null;
  for (let i = block.start + 1; i < block.end; i++) {
    const dash = lines[i].match(/^(\s*)-\s+(\w+):\s*(.*)$/);
    if (dash) { if (cur) items.push(cur); cur = { [dash[2]]: unquote(dash[3]) }; continue; }
    const cont = lines[i].match(/^(\s+)(\w+):\s*(.*)$/);
    if (cont && cur) { cur[cont[2]] = unquote(cont[3]); continue; }
    if (lines[i].trim() === '') continue;
    break;
  }
  if (cur) items.push(cur);
  return items.map(it => { const o = {}; for (const f of fields) o[f] = it[f] || ''; return o; });
}

function setObjectList(lines, key, items, fields) {
  const block = findBlock(lines, key);
  const clean = (items || []).filter(it => fields.some(f => String(it[f] || '').trim() !== ''));
  let newLines;
  if (clean.length === 0) newLines = [`${key}: []`];
  else {
    newLines = [`${key}:`];
    for (const it of clean) {
      newLines.push(`  - ${fields[0]}: ${yamlQuote(it[fields[0]] || '')}`);
      for (const f of fields.slice(1)) newLines.push(`    ${f}: ${yamlQuote(it[f] || '')}`);
    }
  }
  if (block) lines.splice(block.start, block.end - block.start, ...newLines);
  else { if (lines.length && lines[lines.length - 1].trim() !== '') lines.push(''); lines.push(...newLines); }
  return lines;
}

// Read the managed fields out of a profile.yml string → editor payload shape.
export function readProfileFields(text) {
  const lines = String(text || '').split('\n');
  const out = {};
  for (const [key, spec] of Object.entries(MANAGED)) {
    const block = findBlock(lines, key);
    const obj = {};
    if (block) {
      for (const s of spec.scalars) obj[s] = getScalar(lines, block, s);
      for (const l of spec.lists) obj[l] = getList(lines, block, l);
    } else {
      for (const s of spec.scalars) obj[s] = '';
      for (const l of spec.lists) obj[l] = [];
    }
    out[key] = obj;
  }
  out[FREE_TEXT_KEY] = getBlockScalar(lines, FREE_TEXT_KEY);
  out[CUSTOM_ANSWERS_KEY] = getObjectList(lines, CUSTOM_ANSWERS_KEY, ['question', 'answer']);
  return out;
}

// Validate an incoming edit payload. Returns string[] (empty = ok).
export function validateProfileEdits(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') { errors.push('payload required'); return errors; }
  for (const [key, spec] of Object.entries(MANAGED)) {
    const blk = payload[key];
    if (blk == null) continue;
    if (typeof blk !== 'object') { errors.push(`${key} must be an object`); continue; }
    for (const s of spec.scalars) {
      const v = blk[s];
      if (v != null && (typeof v !== 'string' || v.length > MAX_SCALAR)) errors.push(`${key}.${s} invalid`);
    }
    for (const l of spec.lists) {
      const arr = blk[l];
      if (arr == null) continue;
      if (!Array.isArray(arr)) { errors.push(`${key}.${l} must be an array`); continue; }
      if (arr.length > MAX_LIST) errors.push(`${key}.${l} too many entries`);
      for (const it of arr) if (typeof it !== 'string' || it.length > MAX_ITEM) { errors.push(`${key}.${l} entry invalid`); break; }
    }
  }
  if (payload.candidate && payload.candidate.email != null && payload.candidate.email !== '' &&
      !/.+@.+\..+/.test(payload.candidate.email)) errors.push('candidate.email invalid');
  if (payload.target_roles && Array.isArray(payload.target_roles.primary) &&
      payload.target_roles.primary.filter(s => s && s.trim()).length === 0) errors.push('pick at least one target role');
  if (payload[FREE_TEXT_KEY] != null && (typeof payload[FREE_TEXT_KEY] !== 'string' || payload[FREE_TEXT_KEY].length > 20000)) {
    errors.push('additional_context too long');
  }
  if (payload[CUSTOM_ANSWERS_KEY] != null) {
    const ca = payload[CUSTOM_ANSWERS_KEY];
    if (!Array.isArray(ca)) errors.push('custom_answers must be an array');
    else if (ca.length > 100) errors.push('too many custom_answers');
    else for (const it of ca) {
      if (!it || typeof it !== 'object') { errors.push('custom_answers entry invalid'); break; }
      if (typeof (it.question || '') !== 'string' || typeof (it.answer || '') !== 'string' ||
          (it.question || '').length > 500 || (it.answer || '').length > 2000) { errors.push('custom_answers entry too long'); break; }
    }
  }
  return errors;
}

// Apply only the managed fields present in `payload` to the existing YAML text,
// leaving everything else byte-identical. Returns the new text.
export function applyProfileEdits(text, payload) {
  let lines = String(text || '').split('\n');
  for (const [key, spec] of Object.entries(MANAGED)) {
    const blk = payload && payload[key];
    if (!blk || typeof blk !== 'object') continue;
    for (const s of spec.scalars) {
      if (blk[s] != null) lines = setScalar(lines, key, s, String(blk[s]));
    }
    for (const l of spec.lists) {
      if (Array.isArray(blk[l])) lines = setList(lines, key, l, blk[l].map(x => String(x)).filter(x => x.trim() !== ''));
    }
  }
  if (payload && payload[FREE_TEXT_KEY] != null) lines = setBlockScalar(lines, FREE_TEXT_KEY, payload[FREE_TEXT_KEY]);
  if (payload && Array.isArray(payload[CUSTOM_ANSWERS_KEY])) {
    lines = setObjectList(lines, CUSTOM_ANSWERS_KEY, payload[CUSTOM_ANSWERS_KEY], ['question', 'answer']);
  }
  return lines.join('\n');
}
