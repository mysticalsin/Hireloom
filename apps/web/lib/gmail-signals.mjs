// gmail-signals.mjs — pure email-signal classification for the Gmail auto-sort.
// Extracted from server.mjs so the classifier and the application matcher are
// unit-testable (tests/gmail-signals.test.mjs). No I/O here.

// Bare "interview" / "next step" / "schedule" are deliberately IN, and this
// list is checked BEFORE the ack-subject short-circuit in detectSignal.
export const INTERVIEW_SIGNALS = ['interview','next step','schedule','screening','assessment',
  'coding challenge','take-home','availability','calendly','book a time','find a time',
  'phone screen','speak with you','meet with','chat with','hiring manager','next round',
  'set up a call','set up a time','like to connect','like to set up'];
// Strict scheduling language = high confidence. A loose-only match inside an
// ack-subject email still FLAGS as a possible next step (never filed as a
// confirmation) but doesn't auto-write the tracker — that guard is what keeps
// "thanks for applying, here's our interview process" auto-acks from minting
// phantom Interview rows.
export const INTERVIEW_SIGNALS_STRICT = ['schedule an interview','schedule a call','schedule a time','schedule some time',
  'set up a call','set up a time','set up an interview','book a time','find a time','phone screen','phone interview',
  'video interview','technical assessment','coding challenge','take-home','availability for a call',
  'availability to chat','your availability','invite you to interview','invitation to interview','interview invitation',
  'like to interview you','like to speak with you','like to set up','next round','meet with the team','calendly'];
// Unambiguous rejection language — always wins (even over an ack subject).
export const STRONG_REJECTION_SIGNALS = ['not moving forward','not be moving forward','won\'t be moving',
  'will not be moving forward','not be progressing','decided not to proceed','decided not to move forward',
  'were not selected','not been selected','not selected to move','position has been filled','position has been closed',
  'decided to move in a different direction','pursue other candidates','moving forward with other candidates',
  'move forward with other candidates','proceed with other candidates','move forward with another candidate',
  'no longer considering','no longer under consideration','unable to move forward','not be advancing your application',
  'will not be advancing','regret to inform','not to move forward with your application',
  // "going in a direction that better fits our needs" — a real Stripe rejection
  // (classified as received on 2026-06-04): its subject is an ack ("Your
  // application for … role at Stripe") and none of the phrases above matched,
  // so the ack short-circuit won. These live in the STRONG list precisely so
  // they beat ack subjects.
  'direction that better fits','better fits our needs','better aligns with our needs'];
// ATS templates vary the middle of "the position ... has been filled" ("has
// now been filled", "has since been filled") — exact substrings miss them. A
// real Lever rejection ("position you have applied to has now been filled")
// slipped through to the ack short-circuit and was auto-filed as a
// confirmation (PointClickCare, 2026-06-11). Negative lookahead keeps "has
// not (yet) been filled" from reading as a rejection.
export const STRONG_REJECTION_REGEXES = [
  /position[^.!?]{0,80}\b(?:has|have|had)\b(?![^.!?]{0,40}\bnot\b)[^.!?]{0,40}\bfilled\b/,
  // "we have been successful in filling our role" — a real Hootsuite rejection
  // (2026-06-12) carried no "position ... filled" sentence; its only rejection
  // language was the filling-success phrasing, while a body mention of "our
  // interview process" matched the loose interview list and auto-flipped the
  // row to Interview. Cover filled/filling phrased around the role noun.
  /\bsuccess(?:ful(?:ly)?)?\s+in\s+filling\b/,
  /\bfill(?:ed|ing)\s+(?:our|the|this)\s+(?:role|position|opening|vacancy)\b/,
];
// Soft words that ALSO appear in auto-ack disclaimers ("unfortunately we can't reply
// to everyone"); only treated as a rejection when the subject isn't an acknowledgment.
export const WEAK_REJECTION_SIGNALS = ['unfortunately','other candidates','doesn\'t meet','does not meet'];
export const RECEIVED_SIGNALS  = ['received your application','thank you for applying','thanks for applying',
  'we\'ll be in touch','application has been received','successfully received your application',
  'we have received your application','we received your application','what happens next',
  'application was sent','keep your application','thanks for your application','thank you for your application'];
// Subject-line markers of an auto-acknowledgment. When the SUBJECT matches one of
// these, it's a "received" confirmation — even if the body describes the interview
// process — so it never gets mis-flagged as an interview invite.
export const ACK_SUBJECT_SIGNALS = ['thank you for applying','thanks for applying','thank you for your application',
  'thanks for your application','application received','received your application','we received your application',
  'we\'ve received your application','got your application','we\'ve got your application','what happens next',
  'what to expect','application confirmation','application submitted','your application to','your application for',
  'thanks for your interest','thank you for your interest'];
// Job-alert newsletters / talent-community blasts are about NEW postings, not
// the user's existing application — never classify them as signals. (A "New
// jobs posted from Capgemini Group" digest auto-flipped a tracker row to
// Interview before this guard existed: it matched company + "schedule".)
export const JOB_ALERT_SIGNALS = ['new jobs posted','jobs posted from','new jobs from','job alert',
  'recommended jobs','jobs you may be interested','jobs for you','talent community',
  'job recommendations','new opportunities at','daily job digest','weekly job digest'];
export const VERIFICATION_SIGNALS = ['verification code','verify your email','confirm your email',
  'one-time password','security code','your code is','enter this code',
  'otp','confirmation link','click to verify','verify your account','passcode'];
// Automated-mailbox senders. A response from a HUMAN address that fits none of
// the categories above is still a response — it becomes type 'unknown'
// ("response — reasoning unknown") for the user to read and classify, instead
// of being dropped on the floor as 'other'.
export const AUTOMATED_SENDER_RE = /no-?reply|do-?not-?reply|notification|mailer|automated|updates?@|jobs@|careers?@|talent[-.]?(?:acquisition|team)?@|recruiting@|hello@|info@|news(?:letter)?@|digest@|alerts?@/i;

export function extractVerificationCodes(bodyText, subject) {
  const text = (bodyText || '') + ' ' + (subject || '');
  const codes = [];
  const patterns = [
    { re: /(?:code|verification|OTP|confirm|pin|passcode)[\s:is]*(\d{4,8})/i, type: 'numeric' },
    { re: /(\d{4,8})[\s]*(?:is your|verification|code|OTP|passcode)/i, type: 'numeric' },
    { re: /(?:enter|use)[\s:]*(\d{4,8})/i, type: 'numeric' },
  ];
  for (const { re, type } of patterns) {
    const m = text.match(re);
    if (m) { codes.push({ type, value: m[1] }); break; }
  }
  if (!codes.length && /verif|confirm|code/i.test(subject)) {
    const m = text.match(/\b(\d{6})\b/);
    if (m) codes.push({ type: 'numeric', value: m[1] });
  }
  const linkRe = /https?:\/\/[^\s"'<>]+(?:verify|confirm|activate|validate)[^\s"'<>]*/i;
  const linkM = text.match(linkRe);
  if (linkM) codes.push({ type: 'link', value: linkM[0] });
  return codes;
}

export function detectSignal(subject, snippet, bodyText, from) {
  const text = (subject + ' ' + snippet + ' ' + (bodyText || '')).toLowerCase();
  const subj = (subject || '').toLowerCase();
  if (VERIFICATION_SIGNALS.some(s => text.includes(s))) {
    const codes = extractVerificationCodes(bodyText || snippet, subject);
    if (codes.length > 0) return { type: 'verification', codes };
  }
  // 0. Job-alert newsletters are never application signals.
  if (JOB_ALERT_SIGNALS.some(s => text.includes(s))) return { type: 'other' };
  // 1. Strong, unambiguous rejection wins outright.
  if (STRONG_REJECTION_SIGNALS.some(s => text.includes(s)) ||
      STRONG_REJECTION_REGEXES.some(re => re.test(text))) return { type: 'rejected' };
  // 2. Interview/next-step language BEFORE the ack short-circuit — recall over
  //    precision by design: yes, some auto-acks describe the interview process
  //    and will land here, but the user would rather review a false next-step
  //    than have a real invite silently filed as a confirmation.
  //    Confidence ladder (tightened 2026-06-12 after the Hootsuite rejection
  //    auto-flipped a row to Interview on loose language alone):
  //      strict scheduling language        → interview, confident (auto-writes)
  //      loose language inside an ack      → interview, not confident (flag)
  //      loose language, NOT an ack        → 'unknown' — a real response whose
  //        meaning the classifier can't pin down. Never auto-written; the user
  //        reads the email and says what it was.
  if (INTERVIEW_SIGNALS.some(s => text.includes(s))) {
    const strict = INTERVIEW_SIGNALS_STRICT.some(s => text.includes(s));
    const ackSubj = ACK_SUBJECT_SIGNALS.some(s => subj.includes(s));
    if (strict) return { type: 'interview', confident: true };
    if (ackSubj) return { type: 'interview', confident: false };
    return { type: 'unknown' };
  }
  // 3. Acknowledgment by SUBJECT → "received" (auto-acks carry "unfortunately
  //    we can't reply to everyone" disclaimers that would mis-flag below).
  const isAck = ACK_SUBJECT_SIGNALS.some(s => subj.includes(s));
  if (isAck) return { type: 'received' };
  // 4. Soft rejection words only count when it's NOT an acknowledgment email.
  if (WEAK_REJECTION_SIGNALS.some(s => text.includes(s))) return { type: 'rejected' };
  // 5. Received (body-level acks) as the fallback.
  if (RECEIVED_SIGNALS.some(s => text.includes(s))) return { type: 'received' };
  // 6. A human (non-automated mailbox) wrote about a tracked application and
  //    nothing above matched → still a response, reasoning unknown.
  if (from && !AUTOMATED_SENDER_RE.test(from)) return { type: 'unknown' };
  return { type: 'other' };
}

// Pick the tracker row an email belongs to. Company name (in sender or
// subject) narrows the candidates; when the user has several applications at
// the same company, the row whose role title the email actually names wins —
// a PointClickCare rejection for row #45 was filed against row #10 (first
// company match in file order) before this existed. Falls back to rows still
// in play over closed ones.
export function matchApplication(apps, { from = '', subject = '', text = '' } = {}) {
  const f = from.toLowerCase(), s = subject.toLowerCase();
  const candidates = apps.filter(a => {
    const name = (a.company || '').toLowerCase();
    return name && (f.includes(name) || s.includes(name));
  });
  if (candidates.length <= 1) return candidates[0] || null;

  const norm = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const haystack = norm(subject + ' ' + text);
  const byTitle = candidates.filter(a => {
    const role = norm(a.role);
    return role && haystack.includes(role);
  });
  const pool = byTitle.length ? byTitle : candidates;
  const open = pool.filter(a => !['rejected', 'discarded', 'skip', 'offer'].includes(a.status));
  return open[0] || pool[0];
}

// ── Role extraction from email subjects ─────────────────────────────────────
// ATS subject templates carry the job title (and sometimes the company) in a
// handful of rigid shapes; pulling them out lets an unmatched signal name its
// own tracker row instead of relying on company-only matching. Patterns run
// most-specific-first; the fixtures in tests/gmail-signals.test.mjs are real
// subjects from data/gmail-cache.json.

// Invisible junk some ATSes wrap around requisition ids ("(​25350​)").
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
// Reply/forward/calendar-update prefixes stack ("Re: Canceled: …") — strip the
// whole run. "Canceled:" is itself a state worth surfacing (a canceled
// interview), so it's detected inside the run BEFORE stripping and returned
// as a flag rather than silently eaten.
const SUBJECT_PREFIX_RE = /^(?:(?:re|fwd?|updated|cancell?ed)\s*:\s*)+/i;

export function extractRoleFromEmail(subject, snippet) {
  let subj = (subject || '').replace(ZERO_WIDTH_RE, '').trim();
  const prefix = subj.match(SUBJECT_PREFIX_RE);
  const canceled = !!prefix && /cancell?ed\s*:/i.test(prefix[0]);
  if (prefix) subj = subj.slice(prefix[0].length).trim();
  const done = (role, company = null, partial = false) => {
    const r = { role: (role || '').trim() || null, company: (company || '').trim() || null, partial };
    if (canceled) r.canceled = true;
    return r;
  };

  // R5 "Your COMPANY Application - ROLE [| bilingual dup]" — must run BEFORE
  // the pipe splitter: the Hootsuite template repeats the role in French after
  // a pipe, which would otherwise read as a pipe-segmented calendar subject.
  let m = subj.match(/^your\s+(.+?)\s+application\s*[-–—:]\s*([^|]+?)(?:\s*\|.*)?\s*$/i);
  if (m) return done(m[2], m[1]);

  // R1 calendar 3-segment "Event | ROLE | Company" (the Compass invite).
  const segs = subj.split('|').map(s => s.trim()).filter(Boolean);
  if (segs.length === 3) return done(segs[1], segs[2]);

  // R2 "Interview Invitation - ROLE [- City, PROV]" — the role keeps its
  // internal commas; only a trailing "- City, XX" location tail is stripped.
  m = subj.match(/^interview\s+invitation\s*[-–—:]\s*(.+)$/i);
  if (m) return done(m[1].replace(/\s*[-–—]\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*$/, ''));

  // R3 "Your application for ROLE (req-id)" — lazy role + $ anchor make the
  // LAST paren group the id, and the id must contain a digit, so a real paren
  // in the title ("(Supply Chain)") is kept and only "(25350)" is dropped.
  m = subj.match(/^your\s+application\s+for\s+(.+?)\s*\(([^()]*\d[^()]*)\)\s*$/i);
  if (m) return done(m[1]);

  // R4 "Your application for [our|the] ROLE [role|position] at COMPANY"
  // (the Stripe and Quandri templates).
  m = subj.match(/^your\s+application\s+for\s+(?:our\s+|the\s+)?(.+?)(?:\s+(?:role|position))?\s+at\s+(.+?)\s*$/i);
  if (m) return done(m[1], m[2]);

  // R6 "thank you for applying to/for [the] ROLE position|role" — the
  // position/role tail is REQUIRED: "Thank you for applying to Tenstorrent"
  // names only the company and must not mint a role.
  m = subj.match(/thank\s+you\s+for\s+applying\s+(?:to|for)\s+(?:the\s+)?(.+?)\s+(?:position|role)\b/i);
  if (m) return done(m[1]);

  // R7 calendar invite "Interview with COMPANY - ROLE [@ time]" — NOT
  // ^-anchored (Gmail prepends "Invitation from an unknown sender:"). Long
  // titles get ellipsis-truncated BEFORE the "@ Tue 9 Jun 2026 12:30pm" time
  // tail; strip the tail, and a trailing ellipsis marks the role partial so
  // the caller falls back to the snippet.
  m = subj.match(/\binterview\s+with\s+(.+?)\s*[-–—]\s*(.+)$/i);
  if (m) {
    let role = m[2].replace(/\s*@.*$/, '').trim();
    const partial = /(?:\.\.\.|…)$/.test(role) || /(?:\.\.\.|…)$/.test(subj);
    role = role.replace(/\s*(?:\.\.\.|…)$/, '');
    return done(role, m[1], partial);
  }

  // Snippet companion (last resort — a subject hit always wins): acks that
  // hide the title in the body as "the position of ROLE (req-id)". Same
  // digit rule as R3 — the id paren is dropped, real parens are kept.
  m = (snippet || '').replace(ZERO_WIDTH_RE, '')
    .match(/position of\s+(.+?)(?:\s*\([^()]*\d[^()]*\))?(?:\s*[,.;]|$)/i);
  if (m) return done(m[1]);

  return done(null);
}
