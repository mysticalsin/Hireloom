// Pure validation of a parsed config/profile.yml document — used by
// doctor.mjs and unit-tested directly (tests/profile-check.test.mjs).
// Validates the candidate: block the renderers hard-require and the
// optional cv: block contract documented in lib/identity.mjs.
//
// Returns an array of findings, never throws:
//   { level: 'fail' | 'warn', label, fix? }
// An empty array means the document is fully valid.

const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function checkProfileDoc(doc) {
  if (!isMapping(doc)) {
    return [{
      level: 'fail',
      label: 'config/profile.yml is empty or not a YAML mapping',
      fix: 'Restore from config/profile.example.yml or re-run onboarding (⊕ Profile in the dashboard)',
    }];
  }

  const findings = [];

  const cand = doc.candidate;
  if (!isMapping(cand) || !cand.full_name) {
    findings.push({
      level: 'fail',
      label: 'candidate.full_name missing — every CV renderer requires it (lib/identity.mjs throws without it)',
      fix: 'Set candidate.full_name in config/profile.yml (the ⊕ Profile wizard fills it)',
    });
  }

  const cv = doc.cv;
  if (cv === undefined) {
    findings.push({
      level: 'warn',
      label: 'cv: block missing — generated CVs will have no Education or Certifications sections',
      fix: 'Add a cv: block (see config/profile.example.yml) or re-run the ⊕ Profile wizard',
    });
    return findings;
  }
  if (!isMapping(cv)) {
    findings.push({
      level: 'fail',
      label: 'cv: must be a YAML mapping (check indentation)',
      fix: 'Compare against the cv: block in config/profile.example.yml',
    });
    return findings;
  }

  for (const key of ['contact_email', 'contact_phone', 'contact_location', 'contact_linkedin']) {
    if (cv[key] !== undefined && (typeof cv[key] !== 'string' || !cv[key].trim())) {
      findings.push({
        level: 'fail',
        label: `cv.${key} must be a non-empty string`,
        fix: 'Quote the value or remove the key to fall back to the candidate: block',
      });
    }
  }

  if (cv.education === undefined || (Array.isArray(cv.education) && cv.education.length === 0)) {
    findings.push({
      level: 'warn',
      label: 'cv.education is empty — generated CVs will have no Education section',
      fix: 'Add entries ({degree, org, date}) or re-run the ⊕ Profile wizard',
    });
  } else if (!Array.isArray(cv.education)) {
    findings.push({
      level: 'fail',
      label: 'cv.education must be a list of {degree, org, date} entries',
      fix: 'Compare against the cv: block in config/profile.example.yml',
    });
  } else {
    cv.education.forEach((e, i) => {
      if (!isMapping(e) || !e.degree) {
        findings.push({
          level: 'fail',
          label: `cv.education[${i}] malformed — each entry needs at least a degree (got ${JSON.stringify(e)})`,
          fix: 'Each list item is a mapping: - degree: "..." / org: "..." / date: "..."',
        });
      }
    });
  }

  if (cv.certifications !== undefined) {
    if (!Array.isArray(cv.certifications)) {
      findings.push({
        level: 'fail',
        label: 'cv.certifications must be a list of {title, org} entries',
        fix: 'Compare against the cv: block in config/profile.example.yml',
      });
    } else {
      cv.certifications.forEach((c, i) => {
        if (!isMapping(c) || !c.title) {
          findings.push({
            level: 'fail',
            label: `cv.certifications[${i}] malformed — each entry needs at least a title (got ${JSON.stringify(c)})`,
            fix: 'Each list item is a mapping: - title: "..." / org: "..."',
          });
        }
      });
    }
  }

  if (cv.experience_order !== undefined) {
    if (!Array.isArray(cv.experience_order) || cv.experience_order.some((h) => typeof h !== 'string' || !h.trim())) {
      findings.push({
        level: 'fail',
        label: 'cv.experience_order must be a list of non-empty strings (job-title substrings, "+" = AND)',
        fix: 'See the experience_order comment in config/profile.example.yml',
      });
    }
  }

  return findings;
}

// Files the Second Brain build (second-brain/BUILD-SPEC.md) reads or shells
// out to. Doctor reports these as a single optional check — the feature is
// opt-in, so missing pieces warn rather than fail.
export const SECOND_BRAIN_PREREQS = [
  'second-brain/BUILD-SPEC.md',
  '.claude/commands/second-brain.md',
  'templates/states.yml',
  'engine/tracker/followup-cadence.mjs',
  'engine/tracker/analyze-patterns.mjs',
];
