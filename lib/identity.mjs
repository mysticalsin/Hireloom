// Candidate identity for CV/cover rendering — single source of truth.
// Reads config/profile.yml (user layer, gitignored): the `candidate:` block
// for name/contact, plus an optional `cv:` block for display overrides,
// education, certifications, and experience ordering. No personal data may
// be hardcoded in any renderer — it all flows from here.
//
// cv: block (all optional):
//   contact_email:    display email          (default: candidate.email)
//   contact_phone:    display phone          (default: candidate.phone)
//   contact_location: display location, e.g. "City, ST (open to relocation)"
//                                            (default: candidate.location)
//   contact_linkedin: display handle, e.g. "linkedin.com/in/you"
//                                            (default: cleaned candidate.linkedin)
//   education:        [{degree, org, date}]
//   certifications:   [{title, org}]
//   experience_order: ["newest employer", "title keyword+employer keyword", ...]
//     Reverse-chronological job-order hints for normalizeContent. Each entry
//     is one or more lowercase substrings joined by "+" that must ALL appear
//     in the job title. Jobs are sorted by first matching hint; unmatched
//     jobs keep their relative order at the end. Omit to keep input order.
import { readFileSync } from 'fs';
import { load } from 'js-yaml';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SEP = '<span class="sep">|</span>';

function cleanLinkedin(url) {
  return String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

const cache = new Map();
export function loadIdentity(profilePath = 'config/profile.yml') {
  if (cache.has(profilePath)) return cache.get(profilePath);
  let doc;
  try {
    doc = load(readFileSync(profilePath, 'utf8')) || {};
  } catch (e) {
    throw new Error(`identity: cannot read ${profilePath} (${e.message}). Run onboarding first — the renderers take the candidate's name, contact line, education, and certifications from config/profile.yml.`);
  }
  const cand = doc.candidate || {};
  const cv = doc.cv || {};
  const name = cand.full_name || '';
  if (!name) throw new Error(`identity: candidate.full_name missing in ${profilePath}`);

  const email = cv.contact_email || cand.email || '';
  const phone = cv.contact_phone || cand.phone || '';
  const location = cv.contact_location || cand.location || '';
  const linkedin = cv.contact_linkedin || cleanLinkedin(cand.linkedin);

  const parts = [email, phone, location, linkedin].filter(Boolean);
  const contactHtml = parts.map(esc).join(` ${SEP} `);
  const contactText = parts.join(' | ');

  const eduHtml = (cv.education || []).map(e =>
    `<div class="edu-item"><div class="edu-degree">${esc(e.degree || '')}</div><div class="edu-org">${esc(e.org || '')}</div><div class="edu-date">${esc(e.date || '')}</div></div>`).join('');
  const certsHtml = (cv.certifications || []).map(c =>
    `<div class="cert-item"><div class="cert-title">${esc(c.title || '')}</div><div class="cert-org">${esc(c.org || '')}</div></div>`).join('');

  const hints = (cv.experience_order || []).map(h => String(h).toLowerCase().split('+').map(s => s.trim()).filter(Boolean));
  const experienceOrder = title => {
    const t = (title || '').toLowerCase();
    const i = hints.findIndex(parts => parts.every(p => t.includes(p)));
    return i === -1 ? hints.length : i;
  };

  const id = { name, email, phone, location, linkedin, contactHtml, contactText, eduHtml, certsHtml, experienceOrder };
  cache.set(profilePath, id);
  return id;
}
