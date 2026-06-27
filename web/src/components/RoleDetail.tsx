import { useEffect, useRef, useState, type JSX } from 'react';
import { X, ExternalLink, Sparkles, Download, FileDown, ClipboardCheck, Copy, Send, Gauge, Check, Minus } from 'lucide-react';
import { getReportForRole, getTailoring, getApplyAnswers, getRecruiterScore, type RoleRow, type Tailoring, type ApplyAnswers, type RecruiterScore } from '../lib/db';
import { runTailor } from '../lib/tailor';
import { runApplyAssist } from '../lib/apply';
import { runRecruiterScore } from '../lib/recruiter';
import { openPrint, cvHtml, coverHtml } from '../lib/print';
import { useAuth } from '../auth/AuthProvider';
import { useFocusTrap } from '../lib/useFocusTrap';

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function cvMarkdown(t: Tailoring): string {
  const exp = (t.experience ?? []).map((j) => `### ${j.title} — ${j.period}\n${j.location}\n${(j.bullets ?? []).map((b) => `- ${b}`).join('\n')}`).join('\n\n');
  return `# ${t.title}\n\n## Summary\n${t.summary}\n\n## Experience\n${exp}\n\n## Competencies\n${t.competencies}\n\n## Tools\n${t.tools}\n`;
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Tiny, XSS-safe markdown → JSX (headings, bullets, **bold**, paragraphs).
function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="text-ink">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>);
}
function renderMarkdown(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let k = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('### ')) out.push(<h4 key={k++} className="mb-1 mt-4 font-semibold text-ink">{inline(line.slice(4))}</h4>);
    else if (line.startsWith('## ')) out.push(<h3 key={k++} className="mb-2 mt-5 font-display text-lg font-semibold text-ink">{inline(line.slice(3))}</h3>);
    else if (line.startsWith('# ')) out.push(<h2 key={k++} className="mb-2 mt-5 font-display text-xl font-semibold text-ink">{inline(line.slice(2))}</h2>);
    else if (/^[-*]\s+/.test(line)) out.push(<li key={k++} className="ml-5 list-disc text-ink-muted">{inline(line.replace(/^[-*]\s+/, ''))}</li>);
    else out.push(<p key={k++} className="mb-2 text-ink-muted">{inline(line)}</p>);
  }
  return out;
}

// Recruiter scorecard verdict → tokenized badge (success/warning/danger).
const VERDICT: Record<RecruiterScore['verdict'], { label: string; cls: string }> = {
  advance: { label: 'Advance', cls: 'border-success text-success' },
  borderline: { label: 'Borderline', cls: 'border-warning text-warning' },
  reject: { label: 'Reject', cls: 'border-danger text-danger' },
};
function metIcon(met: RecruiterScore['criteria'][number]['met']) {
  if (met === 'yes') return <Check size={14} className="text-success" />;
  if (met === 'partial') return <Minus size={14} className="text-warning" />;
  return <X size={14} className="text-danger" />;
}
function RecruiterScorecard({ score }: { score: RecruiterScore }) {
  const v = VERDICT[score.verdict] ?? VERDICT.borderline;
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>
        <p className="font-semibold text-ink">{score.headline}</p>
      </div>
      <p className="mb-3 text-ink-muted">{score.sixSecondScan}</p>
      <ul className="mb-3 space-y-1.5">
        {(score.criteria ?? []).map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0">{metIcon(c.met)}</span>
            <span className="text-ink-muted">
              <span className="font-medium text-ink">{c.name}</span>
              {c.required && <span className="ml-1.5 rounded border border-hairline-strong px-1 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">required</span>}
              {c.note && <span className="block text-ink-faint">{c.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      {(score.redFlags ?? []).length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-danger">Red flags</p>
          <ul>{score.redFlags.map((f, i) => <li key={i} className="ml-5 list-disc text-ink-muted">{f}</li>)}</ul>
        </div>
      )}
      {(score.gapsToClose ?? []).length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-ink">Gaps to close</p>
          <ul>{score.gapsToClose.map((g, i) => <li key={i} className="ml-5 list-disc text-ink-muted">{g}</li>)}</ul>
        </div>
      )}
      {score.fairnessNote && <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-faint">{score.fairnessNote}</p>}
    </div>
  );
}

export default function RoleDetail({ role, onClose }: { role: RoleRow; onClose: () => void }) {
  const { user } = useAuth();
  const name = (user?.user_metadata?.full_name as string) || user?.email || 'Candidate';
  const contact = user?.email ?? '';
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tailoring, setTailoring] = useState<Tailoring | null>(null);
  const [tailorBusy, setTailorBusy] = useState(false);
  const [tailorMsg, setTailorMsg] = useState<string | null>(null);
  const [apply, setApply] = useState<ApplyAnswers | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [recruiter, setRecruiter] = useState<RecruiterScore | null>(null);
  const [rsBusy, setRsBusy] = useState(false);
  const [rsMsg, setRsMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, onClose);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    Promise.all([getReportForRole(role.id), getTailoring(role.id), getApplyAnswers(role.id), getRecruiterScore(role.id)])
      .then(([r, t, a, rs]) => { if (!alive) return; setReport(r?.markdown ?? null); setTailoring(t); setApply(a); setRecruiter(rs); })
      .catch(() => { if (alive) setError('Could not load this role. Close and reopen, or retry.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [role.id]);

  const draftApply = async () => {
    setApplyBusy(true); setApplyMsg('Drafting answers… 20–40s.');
    const res = await runApplyAssist(role.id);
    setApplyBusy(false);
    if (res.error) { setApplyMsg(res.error); return; }
    setApply(res.content ?? null); setApplyMsg(null);
  };
  const copy = (i: number, text: string) => { navigator.clipboard?.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); };

  const tailor = async () => {
    setTailorBusy(true); setTailorMsg('Tailoring CV + cover letter… 30–60s.');
    const res = await runTailor(role.id);
    setTailorBusy(false);
    if (res.error) { setTailorMsg(res.error); return; }
    setTailoring(res.content ?? null); setTailorMsg(null);
  };

  const scoreCv = async () => {
    setRsBusy(true); setRsMsg('Scoring through a recruiter lens… 20–40s.');
    const res = await runRecruiterScore(role.id);
    setRsBusy(false);
    if (res.error) { setRsMsg(res.error); return; }
    setRecruiter(res.content ?? null); setRsMsg(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rd-title">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-hairline-strong bg-surface p-7 text-ink shadow-md">
        <button onClick={onClose} autoFocus aria-label="Close" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><X size={20} /></button>

        <div className="mb-1 flex items-center gap-3">
          <h2 id="rd-title" className="font-display text-2xl font-semibold tracking-tight">{role.company}</h2>
          {role.score != null && <span className="rounded-full border border-hairline-strong px-2.5 py-0.5 text-sm">{role.score}/5</span>}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <span>{role.title}</span>
          <span>· {role.status}</span>
          {role.url && <a href={role.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-accent underline underline-offset-4">posting <ExternalLink size={13} /></a>}
        </div>

        <div className="overflow-y-auto rounded-xl border border-hairline bg-surface-2 p-5 text-sm leading-relaxed">
          {loading ? (
            <div className="space-y-2.5" aria-busy="true" aria-label="Loading report">
              <div className="h-5 w-2/5 animate-pulse rounded bg-surface" />
              <div className="h-4 w-full animate-pulse rounded bg-surface" />
              <div className="h-4 w-11/12 animate-pulse rounded bg-surface" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-surface" />
              <div className="mt-4 h-5 w-1/3 animate-pulse rounded bg-surface" />
              <div className="h-4 w-full animate-pulse rounded bg-surface" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface" />
            </div>)
            : error ? <p role="alert" className="text-danger">{error}</p>
            : report ? renderMarkdown(report)
            : <p className="text-ink-faint">No report stored for this role yet.</p>}

          {/* Tailoring */}
          <div className="mt-6 border-t border-hairline pt-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-ink"><Sparkles size={15} className="text-accent" /> Tailored package</span>
              <button onClick={tailor} disabled={tailorBusy} className="min-h-11 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {tailorBusy ? 'Tailoring…' : tailoring ? 'Re-tailor' : 'Tailor CV + cover letter'}
              </button>
              {tailoring && (
                <>
                  <button onClick={() => openPrint(cvHtml(tailoring, name, contact))} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-hairline-strong px-4 py-1.5 text-xs text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><FileDown size={13} /> CV PDF</button>
                  <button onClick={() => openPrint(coverHtml(tailoring, name, contact))} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-hairline-strong px-4 py-1.5 text-xs text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><FileDown size={13} /> Cover PDF</button>
                  <button onClick={() => download(`${slug(role.company)}-cv.md`, cvMarkdown(tailoring))} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-hairline-strong px-4 py-1.5 text-xs text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><Download size={13} /> .md</button>
                  <button onClick={() => download(`${slug(role.company)}-cover-letter.md`, (tailoring.coverLetter ?? []).join('\n\n'))} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-hairline-strong px-4 py-1.5 text-xs text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><Download size={13} /> Cover .md</button>
                </>
              )}
            </div>
            {tailorMsg && <p className="mb-3 text-xs text-ink-muted">{tailorMsg}</p>}
            {tailoring && (
              <div className="rounded-lg border border-hairline bg-surface p-4">
                <p className="mb-2 font-semibold text-ink">{tailoring.title}</p>
                <p className="mb-3 text-ink-muted">{tailoring.summary}</p>
                {(tailoring.experience ?? []).slice(0, 2).map((j, i) => (
                  <div key={i} className="mb-3">
                    <p className="text-sm font-medium text-ink">{j.title} <span className="text-ink-faint">· {j.period}</span></p>
                    <ul className="mt-1">{(j.bullets ?? []).slice(0, 3).map((b, bi) => <li key={bi} className="ml-5 list-disc text-ink-muted">{b}</li>)}</ul>
                  </div>
                ))}
                <p className="mt-3 text-xs text-ink-faint">Cover letter ready — download above. Print to PDF from your browser.</p>
              </div>
            )}
            {!tailoring && !tailorBusy && <p className="text-xs text-ink-muted">Generate a truthful CV + cover letter tuned to this role (uses your saved key + CV).</p>}
          </div>

          {/* Recruiter scorecard */}
          <div className="mt-6 border-t border-hairline pt-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-ink"><Gauge size={15} className="text-accent" /> Recruiter scorecard</span>
              <button onClick={scoreCv} disabled={rsBusy} className="min-h-11 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {rsBusy ? 'Scoring…' : recruiter ? 'Re-score' : 'Recruiter scorecard'}
              </button>
            </div>
            {rsMsg && <p className="mb-3 text-xs text-ink-muted">{rsMsg}</p>}
            {recruiter && <RecruiterScorecard score={recruiter} />}
            {!recruiter && !rsBusy && <p className="text-xs text-ink-muted">See how a hiring manager would screen your CV against this role — honest, bias-free (uses your saved key + CV).</p>}
          </div>

          {/* Assisted apply */}
          <div className="mt-6 border-t border-hairline pt-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-ink"><Send size={15} className="text-accent" /> Assisted apply</span>
              <button onClick={draftApply} disabled={applyBusy} className="min-h-11 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {applyBusy ? 'Drafting…' : apply ? 'Re-draft answers' : 'Draft answers'}
              </button>
              {role.url && <a href={role.url} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-xs text-accent underline underline-offset-4">open posting <ExternalLink size={12} /></a>}
            </div>
            {applyMsg && <p className="mb-3 text-xs text-ink-muted">{applyMsg}</p>}
            {apply && (
              <div className="space-y-3">
                {apply.answers.map((qa, i) => (
                  <div key={i} className="rounded-lg border border-hairline bg-surface p-3">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-ink-muted">{qa.question}</p>
                      <button onClick={() => copy(i, qa.answer)} aria-label="Copy" className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        {copied === i ? <ClipboardCheck size={14} className="text-success" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <p className="text-sm text-ink-muted">{qa.answer}</p>
                  </div>
                ))}
                <p className="text-xs text-ink-muted">Review every answer, then submit on the posting yourself. Hireloom never auto-submits.</p>
              </div>
            )}
            {!apply && !applyBusy && <p className="text-xs text-ink-muted">Draft truthful answers to the common application questions, ready to review and paste. Pro feature.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
