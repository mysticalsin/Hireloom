/**
 * apps/web/lib/profile-diagnostics.mjs — "what's missing in your profile so the
 * autofiller has to guess?" analysis.
 *
 * Takes the field surface from profile-edit.readProfileFields() and reports
 * which common application answers are absent, in plain English, with the exact
 * place to add each one. This is the brain behind the "Run diagnostics" button:
 * every gap here is a question a real ATS form will ask that we currently can't
 * answer from profile.yml — so the autofiller would guess or leave it blank.
 *
 * Pure: no I/O, no module state — unit-testable.
 */

// severity: 'high' = forms require it, a guess is risky; 'medium' = common;
// 'low' = nice-to-have; 'optional' = voluntary self-ID ("decline" is valid).
export const GAP_CATALOG = [
  { id: 'email',            label: 'Email',                 sev: 'high',   path: ['candidate', 'email'],
    why: 'Every application needs it.',                              fix: 'Profile → Identity → Email' },
  { id: 'phone',            label: 'Phone',                 sev: 'medium', path: ['candidate', 'phone'],
    why: 'Most forms ask for a phone number.',                      fix: 'Profile → Identity → Phone' },
  { id: 'location',         label: 'Location',              sev: 'medium', path: ['candidate', 'location'],
    why: 'Used for location-match and "where are you based?".',     fix: 'Profile → Identity → Location' },
  { id: 'work_eligibility', label: 'Work eligibility',      sev: 'high',   path: ['work_authorization', 'legally_authorized_to_work'],
    why: 'Asked on nearly every posting; a wrong guess is a red flag.', fix: 'Profile → Work authorization → Legally authorized to work' },
  { id: 'sponsorship',      label: 'Sponsorship needed',    sev: 'high',   path: ['work_authorization', 'require_sponsorship'],
    why: 'The companion question to work eligibility.',             fix: 'Profile → Work authorization → Require sponsorship' },
  { id: 'comp_target',      label: 'Salary expectation',    sev: 'high',   path: ['compensation', 'target_range'],
    why: 'Forms with a required salary field block submission without it.', fix: 'Profile → Compensation → Target' },
  { id: 'notice_period',    label: 'Notice period',         sev: 'medium', path: ['application_answers', 'notice_period'],
    why: '"How much notice do you need?" is common.',               fix: 'Profile → Application answers → Notice period' },
  { id: 'start_date',       label: 'Earliest start date',   sev: 'medium', path: ['application_answers', 'earliest_start_date'],
    why: '"When can you start?" is common.',                        fix: 'Profile → Application answers → Earliest start date' },
  { id: 'relocate',         label: 'Willing to relocate',   sev: 'medium', path: ['application_answers', 'willing_to_relocate'],
    why: 'Asked for on-site / hybrid roles.',                       fix: 'Profile → Application answers → Willing to relocate' },
  { id: 'over_18',          label: 'Over 18',               sev: 'medium', path: ['application_answers', 'over_18'],
    why: 'A near-universal yes/no gate.',                           fix: 'Profile → Application answers → Over 18' },
  { id: 'criminal_record',  label: 'Criminal record',       sev: 'medium', path: ['application_answers', 'criminal_record'],
    why: 'Common compliance question; guessing is risky.',          fix: 'Profile → Application answers → Criminal record' },
  { id: 'bg_check',         label: 'Background-check consent', sev: 'medium', path: ['application_answers', 'background_check_consent'],
    why: '"Will you consent to a background check?"',               fix: 'Profile → Application answers → Background-check consent' },
  { id: 'citizenship',      label: 'Citizenship',           sev: 'medium', path: ['application_answers', 'citizenship'],
    why: 'Citizenship / nationality questions are frequent.',       fix: 'Profile → Application answers → Citizenship' },
  { id: 'drivers_license',  label: "Driver's license",      sev: 'low',    path: ['application_answers', 'drivers_license'],
    why: 'Asked for field / on-site roles.',                        fix: 'Profile → Application answers → Driver’s license' },
  { id: 'headline',         label: 'Headline',              sev: 'medium', path: ['narrative', 'headline'],
    why: 'Used to frame cover letters + "tell us about yourself".', fix: 'Profile → Narrative → Headline' },
  { id: 'best_achievement', label: 'Best achievement',      sev: 'low',    path: ['narrative', 'best_achievement'],
    why: 'Seeds the strongest cover-letter / essay answers.',       fix: 'Profile → Narrative → Best achievement' },
  // Voluntary self-ID — never required to answer truthfully; "decline" is valid.
  { id: 'gender',     label: 'Gender (self-ID)',        sev: 'optional', path: ['eeo_voluntary', 'gender'],
    why: 'EEO forms render it; "decline to self-identify" is fine.', fix: 'Profile → Voluntary self-ID → Gender' },
  { id: 'race',       label: 'Race / ethnicity (self-ID)', sev: 'optional', path: ['eeo_voluntary', 'race_ethnicity'],
    why: 'EEO forms render it; declining is always valid.',         fix: 'Profile → Voluntary self-ID → Race / ethnicity' },
  { id: 'veteran',    label: 'Veteran status (self-ID)', sev: 'optional', path: ['eeo_voluntary', 'veteran_status'],
    why: 'US EEO forms ask it.',                                    fix: 'Profile → Voluntary self-ID → Veteran status' },
  { id: 'disability', label: 'Disability status (self-ID)', sev: 'optional', path: ['eeo_voluntary', 'disability_status'],
    why: 'US EEO forms ask it.',                                    fix: 'Profile → Voluntary self-ID → Disability status' },
];

function valueAt(fields, path) {
  let v = fields;
  for (const seg of path) { if (v == null) return ''; v = v[seg]; }
  if (Array.isArray(v)) return v.filter(x => String(x).trim() !== '').length ? v : '';
  return typeof v === 'string' ? v.trim() : (v == null ? '' : v);
}

function isFilled(fields, entry) {
  const v = valueAt(fields, entry.path);
  return Array.isArray(v) ? v.length > 0 : String(v) !== '';
}

// Analyze the field surface → completeness + the gap lists the UI renders.
export function analyzeProfile(fields) {
  const f = fields || {};
  const required = GAP_CATALOG.filter(e => e.sev !== 'optional');
  const optionalCat = GAP_CATALOG.filter(e => e.sev === 'optional');
  const gaps = [];
  let filled = 0;
  for (const e of required) {
    if (isFilled(f, e)) filled++;
    else gaps.push({ id: e.id, label: e.label, why: e.why, fix: e.fix, severity: e.sev });
  }
  const optional = optionalCat.filter(e => !isFilled(f, e))
    .map(e => ({ id: e.id, label: e.label, why: e.why, fix: e.fix, severity: e.sev }));
  // sort gaps high → medium → low
  const rank = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
  const total = required.length;
  return {
    completeness: { filled, total, pct: total ? Math.round((filled / total) * 100) : 100 },
    gaps,
    optional,
    customAnswerCount: Array.isArray(f.custom_answers) ? f.custom_answers.length : 0,
    hasFreeText: !!(f.additional_context && String(f.additional_context).trim()),
  };
}
