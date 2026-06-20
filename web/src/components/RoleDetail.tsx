import { useEffect, useState, type JSX } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { getReportForRole, type RoleRow } from '../lib/db';

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
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getReportForRole(role.id).then((r) => { if (alive) { setReport(r?.markdown ?? null); setLoading(false); } });
    return () => { alive = false; };
  }, [role.id]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="liquid-glass relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-gray-900/70 p-7 text-white shadow-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-gray-400 hover:text-white"><X size={20} /></button>

        <div className="mb-1 flex items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{role.company}</h2>
          {role.score != null && <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-sm">{role.score}/5</span>}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gray-400">
          <span>{role.title}</span>
          <span>· {role.status}</span>
          {role.url && <a href={role.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-white underline underline-offset-4">posting <ExternalLink size={13} /></a>}
        </div>

        <div className="overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-5 text-sm leading-relaxed">
          {loading ? <p className="text-gray-500">Loading report…</p>
            : report ? renderMarkdown(report)
            : <p className="text-gray-500">No report stored for this role yet.</p>}
        </div>
      </div>
    </div>
  );
}
