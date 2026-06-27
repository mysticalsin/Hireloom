import { useEffect, useRef, useState, type JSX } from 'react';
import { X, ExternalLink, Sparkles, Download, FileDown, ClipboardCheck, Copy, Send } from 'lucide-react';
import { getReportForRole, getTailoring, getApplyAnswers, type RoleRow, type Tailoring, type ApplyAnswers } from '../lib/db';
import { runTailor } from '../lib/tailor';
import { runApplyAssist } from '../lib/apply';
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
      ? <strong key={i} className="text-white">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>);
}
function renderMarkdown(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let k = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('### ')) out.push(<h4 key={k++} className="mb-1 mt-4 font-semibold text-white">{inline(line.slice(4))}</h4>);
    else if (line.startsWith('## ')) out.push(<h3 key={k++} className="mb-2 mt-5 text-lg font-semibold text-white">{inline(line.slice(3))}</h3>);
    else if (line.startsWith('# ')) out.push(<h2 key={k++} className="mb-2 mt-5 text-xl font-semibold text-white">{inline(line.slice(2))}</h2>);
    else if (/^[-*]\s+/.test(line)) out.push(<li key={k++} className="ml-5 list-disc text-gray-300">{inline(line.replace(/^[-*]\s+/, ''))}</li>);
    else out.push(<p key={k++} className="mb-2 text-gray-300">{inline(line)}</p>);
  }
  return out;
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
  const [copied, setCopied] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, onClose);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    Promise.all([getReportForRole(role.id), getTailoring(role.id), getApplyAnswers(role.id)])
      .then(([r, t, a]) => { if (!alive) return; setReport(r?.markdown ?? null); setTailoring(t); setApply(a); })
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rd-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} className="liquid-glass relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-gray-900/70 p-7 text-white shadow-2xl">
        <button onClick={onClose} autoFocus aria-label="Close" className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"><X size={20} /></button>

        <div className="mb-1 flex items-center gap-3">
          <h2 id="rd-title" className="text-2xl font-semibold tracking-tight">{role.company}</h2>
          {role.score != null && <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-sm">{role.score}/5</span>}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gray-400">
          <span>{role.title}</span>
          <span>· {role.status}</span>
          {role.url && <a href={role.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-white underline underline-offset-4">posting <ExternalLink size={13} /></a>}
        </div>

        <div className="overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-5 text-sm leading-relaxed">
          {loading ? <p className="text-gray-500">Loading report…</p>
            : error ? <p role="alert" className="text-red-300">{error}</p>
            : report ? renderMarkdown(report)
            : <p className="text-gray-500">No report stored for this role yet.</p>}

          {/* Tailoring */}
          <div className="mt-6 border-t border-white/10 pt-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-white"><Sparkles size={15} /> Tailored package</span>
              <button onClick={tailor} disabled={tailorBusy} className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black hover:bg-gray-200 disabled:opacity-50">
                {tailorBusy ? 'Tailoring…' : tailoring ? 'Re-tailor' : 'Tailor CV + cover letter'}
              </button>
              {tailoring && (
                <>
                  <button onClick={() => openPrint(cvHtml(tailoring, name, contact))} className="liquid-glass inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs"><FileDown size={13} /> CV PDF</button>
                  <button onClick={() => openPrint(coverHtml(tailoring, name, contact))} className="liquid-glass inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs"><FileDown size={13} /> Cover PDF</button>
                  <button onClick={() => download(`${slug(role.company)}-cv.md`, cvMarkdown(tailoring))} className="liquid-glass inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs"><Download size={13} /> .md</button>
                  <button onClick={() => download(`${slug(role.company)}-cover-letter.md`, (tailoring.coverLetter ?? []).join('\n\n'))} className="liquid-glass inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs"><Download size={13} /> Cover .md</button>
                </>
              )}
            </div>
            {tailorMsg && <p className="mb-3 text-xs text-gray-400">{tailorMsg}</p>}
            {tailoring && (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <p className="mb-2 font-semibold text-white">{tailoring.title}</p>
                <p className="mb-3 text-gray-300">{tailoring.summary}</p>
                {(tailoring.experience ?? []).slice(0, 2).map((j, i) => (
                  <div key={i} className="mb-3">
                    <p className="text-sm font-medium text-white">{j.title} <span className="text-gray-500">· {j.period}</span></p>
                    <ul className="mt-1">{(j.bullets ?? []).slice(0, 3).map((b, bi) => <li key={bi} className="ml-5 list-disc text-gray-400">{b}</li>)}</ul>
                  </div>
                ))}
                <p className="mt-3 text-xs text-gray-500">Cover letter ready — download above. Print to PDF from your browser.</p>
              </div>
            )}
            {!tailoring && !tailorBusy && <p className="text-xs text-gray-400">Generate a truthful CV + cover letter tuned to this role (uses your saved key + CV).</p>}
          </div>

          {/* Assisted apply */}
          <div className="mt-6 border-t border-white/10 pt-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-white"><Send size={15} /> Assisted apply</span>
              <button onClick={draftApply} disabled={applyBusy} className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black hover:bg-gray-200 disabled:opacity-50">
                {applyBusy ? 'Drafting…' : apply ? 'Re-draft answers' : 'Draft answers'}
              </button>
              {role.url && <a href={role.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-white underline underline-offset-4">open posting <ExternalLink size={12} /></a>}
            </div>
            {applyMsg && <p className="mb-3 text-xs text-gray-400">{applyMsg}</p>}
            {apply && (
              <div className="space-y-3">
                {apply.answers.map((qa, i) => (
                  <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-gray-300">{qa.question}</p>
                      <button onClick={() => copy(i, qa.answer)} aria-label="Copy" className="shrink-0 text-gray-400 hover:text-white">
                        {copied === i ? <ClipboardCheck size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <p className="text-sm text-gray-400">{qa.answer}</p>
                  </div>
                ))}
                <p className="text-xs text-gray-400">Review every answer, then submit on the posting yourself. Hireloom never auto-submits.</p>
              </div>
            )}
            {!apply && !applyBusy && <p className="text-xs text-gray-400">Draft truthful answers to the common application questions, ready to review and paste. Pro feature.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
