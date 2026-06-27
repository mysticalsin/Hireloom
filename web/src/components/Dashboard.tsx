import { useEffect, useState } from 'react';
import { LogOut, Briefcase, Gauge, CreditCard, Sparkles, Settings as SettingsIcon } from 'lucide-react';
import Dialog from './Dialog';
import { useAuth } from '../auth/AuthProvider';
import { getSubscription, getUsage, listRoles, type RoleRow, type Subscription } from '../lib/db';
import { startCheckout } from '../lib/billing';
import { runEvaluation } from '../lib/evaluate';
import { getCv, saveCv, getSavedProviders, saveProviderKey, deleteProviderKey, exportMyData, deleteMyAccount } from '../lib/settings';
import { getInboxSignals, type Signal } from '../lib/gmail';
import RoleDetail from './RoleDetail';

const SIGNAL_STYLE: Record<string, string> = {
  offer: 'text-emerald-300 border-emerald-700/40',
  interview: 'text-sky-300 border-sky-700/40',
  rejection: 'text-red-300 border-red-800/40',
  response: 'text-gray-300 border-white/15',
};

const PLAN_CAP: Record<string, number> = { free: 10, pro: Infinity, studio: Infinity };
const PROVIDERS = ['anthropic', 'openai', 'gemini', 'kimi', 'openrouter'];

export default function Dashboard() {
  const { user, signOut, connectGmail } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [used, setUsed] = useState(0);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [billingMsg, setBillingMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleRow | null>(null);
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxMsg, setInboxMsg] = useState<string | null>(null);
  const [needsGmail, setNeedsGmail] = useState(false);

  const syncInbox = async () => {
    setInboxBusy(true); setInboxMsg('Reading inbox…'); setNeedsGmail(false);
    const r = await getInboxSignals();
    setInboxBusy(false);
    if (r.needsConnect) { setNeedsGmail(true); setInboxMsg('Connect Gmail (read-only) to surface responses, interviews, and offers.'); return; }
    if (r.error) { setInboxMsg(r.error); return; }
    setSignals(r.signals ?? []);
    setInboxMsg((r.signals?.length ?? 0) === 0 ? 'No job-search signals in the last 45 days.' : null);
  };

  // new evaluation
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const [evalBusy, setEvalBusy] = useState(false);
  const [evalMsg, setEvalMsg] = useState<string | null>(null);

  async function reload() {
    setLoading(true); setLoadErr(null);
    try {
      const [s, u, r] = await Promise.all([getSubscription(), getUsage(), listRoles()]);
      setSub(s); setUsed(u); setRoles(r);
    } catch {
      // Never let a failed load read as "no roles" / "free plan" / "0 used".
      setLoadErr('We couldn’t load your atelier. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    const p = new URLSearchParams(window.location.search).get('billing');
    if (p === 'success') setBanner('Payment received — your plan will update momentarily.');
    if (p === 'cancel') setBanner('Checkout canceled. No charge made.');
    if (p) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const plan = sub?.plan ?? 'free';
  const cap = PLAN_CAP[plan] ?? 10;

  const upgrade = async (target: 'pro' | 'studio') => {
    setBillingMsg('Redirecting to checkout…');
    const r = await startCheckout(target);
    if (r.error) setBillingMsg(r.error);
  };

  const evaluate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setEvalBusy(true); setEvalMsg('Evaluating… this can take 30–60s.');
    const r = await runEvaluation(input.trim(), provider);
    setEvalBusy(false);
    if (r.error) { setEvalMsg(r.error); return; }
    setEvalMsg(`Scored ${r.summary?.company} — ${r.summary?.role}: ${r.summary?.score}/5`);
    setInput('');
    reload();
  };

  return (
    <div className="min-h-full bg-black text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-5 md:px-12">
        <span className="text-xl font-bold tracking-tight">HIRELOOM</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-gray-400 sm:inline">{user?.email}</span>
          <button onClick={() => setShowSettings(true)} className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2 text-sm"><SettingsIcon size={16} /> Settings</button>
          <button onClick={signOut} className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2 text-sm"><LogOut size={16} /> Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 md:px-12">
        {banner && (
          <div className="mb-6 rounded-xl border border-emerald-700/40 bg-emerald-900/20 px-5 py-3 text-sm text-emerald-200">{banner}</div>
        )}

        {loadErr && (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-800/50 bg-red-950/30 px-5 py-3 text-sm text-red-200">
            <span>{loadErr}</span>
            <button onClick={reload} className="rounded-full border border-red-700/50 px-3 py-1 text-xs font-medium hover:bg-red-900/30">Retry</button>
          </div>
        )}

        <h1 className="mb-1 text-3xl font-semibold tracking-tight">Your atelier</h1>
        <p className="mb-8 text-gray-400">Everything Hireloom tracks for your search, in one place.</p>

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <Card icon={<CreditCard size={18} />} label="Plan"><span className="text-2xl font-semibold capitalize">{loading ? '—' : plan}</span><span className="ml-2 text-sm text-gray-400">{loading ? '' : (sub?.status ?? '—')}</span></Card>
          <Card icon={<Gauge size={18} />} label="Evaluations this month"><span className="text-2xl font-semibold">{loading ? '—' : used}</span><span className="ml-2 text-sm text-gray-400">/ {cap === Infinity ? '∞' : cap}</span></Card>
          <Card icon={<Briefcase size={18} />} label="Roles tracked"><span className="text-2xl font-semibold">{loading ? '—' : roles.length}</span></Card>
        </div>

        {/* New evaluation */}
        <div className="liquid-glass mb-8 rounded-2xl bg-white/[0.03] p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Sparkles size={16} className="text-white" /> Evaluate a role</div>
          <form onSubmit={evaluate} className="flex flex-col gap-3 sm:flex-row">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste a job URL or the full JD text…" className="flex-1 rounded-lg border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus:border-white/40" />
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-3 text-sm outline-none">
              {PROVIDERS.map((p) => <option key={p} value={p} className="bg-gray-900">{p}</option>)}
            </select>
            <button type="submit" disabled={evalBusy} className="rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-gray-200 disabled:opacity-50">{evalBusy ? 'Working…' : 'Evaluate'}</button>
          </form>
          {evalMsg && <p className="mt-3 text-sm text-gray-400">{evalMsg}</p>}
          <p className="mt-2 text-xs text-gray-600">Runs on your saved {provider} key (Settings). Score, tailor, track — truthfully.</p>
        </div>

        {plan !== 'studio' && (
          <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <span className="text-sm text-gray-300">{plan === 'free' ? 'You’re on Free. Upgrade for unlimited evaluations, inbox signals, and assisted apply.' : 'You’re on Pro. Go Studio for autopilot + the Second Brain.'}</span>
            <div className="ml-auto flex gap-3">
              {plan === 'free' && <button onClick={() => upgrade('pro')} className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-gray-200">Upgrade to Pro</button>}
              <button onClick={() => upgrade('studio')} className="liquid-glass rounded-full px-5 py-2 text-sm font-medium">Upgrade to Studio</button>
            </div>
            {billingMsg && <span className="w-full text-sm text-gray-400">{billingMsg}</span>}
          </div>
        )}

        {/* Inbox signals */}
        <div className="liquid-glass mb-8 rounded-2xl bg-white/[0.03] p-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Inbox signals</span>
            <button onClick={syncInbox} disabled={inboxBusy} className="liquid-glass rounded-full px-4 py-1.5 text-xs font-medium disabled:opacity-50">{inboxBusy ? 'Syncing…' : 'Sync inbox'}</button>
            {needsGmail && <button onClick={() => connectGmail()} className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black hover:bg-gray-200">Connect Gmail</button>}
          </div>
          {inboxMsg && <p className="mb-3 text-xs text-gray-400">{inboxMsg}</p>}
          {signals && signals.length > 0 && (
            <ul className="space-y-2">
              {signals.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm">
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs capitalize ${SIGNAL_STYLE[s.type] ?? 'text-gray-300 border-white/15'}`}>{s.type}</span>
                  <span className="truncate text-gray-300">{s.subject}</span>
                  <span className="ml-auto shrink-0 text-xs text-gray-500">{s.from.replace(/<.*>/, '').trim()}</span>
                </li>
              ))}
            </ul>
          )}
          {!signals && !inboxMsg && <p className="text-xs text-gray-600">Read-only Gmail scan for responses, rejections, interviews, and offers. Runs in your browser on your Google token.</p>}
        </div>

        <h2 className="mb-3 text-lg font-semibold">Roles</h2>
        <div className="overflow-hidden rounded-xl border border-white/10">
          {loading ? <div className="p-8 text-center text-gray-500">Loading…</div>
            : roles.length === 0 ? <div className="p-8 text-center text-gray-500">No roles yet. Paste a job URL above to score your first one.</div>
            : (
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Status</th></tr></thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id} onClick={() => setSelectedRole(r)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedRole(r); } }} tabIndex={0} role="button" aria-label={`Open ${r.company} — ${r.title}`} className="cursor-pointer border-t border-white/5 transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none">
                      <td className="px-4 py-3 font-medium">{r.company}</td>
                      <td className="px-4 py-3 text-gray-300">{r.title}</td>
                      <td className="px-4 py-3">{r.score ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-400">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {selectedRole && <RoleDetail role={selectedRole} onClose={() => setSelectedRole(null)} />}
    </div>
  );
}

function Card({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="liquid-glass rounded-xl bg-white/[0.03] p-5">
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-400">{icon} {label}</div>
      <div>{children}</div>
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [cv, setCv] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { signOut } = useAuth();

  useEffect(() => {
    getCv().then(setCv).catch(() => setMsg('Could not load your saved CV.'));
    getSavedProviders().then(setSaved).catch(() => {});
  }, []);

  const saveKey = async () => {
    if (!apiKey.trim()) { setMsg('Enter a key.'); return; }
    const r = await saveProviderKey(provider, apiKey.trim());
    if (r.error) { setMsg(r.error); return; }
    setMsg(`${provider} key saved.`); setApiKey(''); getSavedProviders().then(setSaved).catch(() => {});
  };
  const removeKey = async (p: string) => {
    const r = await deleteProviderKey(p);
    if (r.error) { setMsg(r.error); return; }
    setMsg(`${p} key removed.`); getSavedProviders().then(setSaved).catch(() => {});
  };
  const downloadData = async () => {
    const r = await exportMyData();
    if (r.error) { setMsg(r.error); return; }
    if (r.url) {
      const a = document.createElement('a');
      a.href = r.url; a.download = 'hireloom-export.json'; a.click();
      URL.revokeObjectURL(r.url);
      setMsg('Your data was downloaded as JSON.');
    }
  };
  const removeAccount = async () => {
    const r = await deleteMyAccount();
    if (r.error) { setMsg(r.error); return; }
    await signOut();
  };
  const saveResume = async () => {
    const r = await saveCv(cv);
    setMsg(r.error ?? 'CV saved.');
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
        <div className="mb-6">
          <div className="mb-2 text-sm font-medium">AI provider key (BYOK)</div>
          <div className="flex gap-2">
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm">
              {PROVIDERS.map((p) => <option key={p} value={p} className="bg-gray-900">{p}{saved.includes(p) ? ' ✓' : ''}</option>)}
            </select>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your key" className="flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/40" />
            <button onClick={saveKey} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-200">Save</button>
          </div>
          <p className="mt-2 text-xs text-gray-500">Encrypted in a vault and never shown again. We never mark up tokens — you pay your provider directly.</p>
          {saved.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {saved.map((p) => (
                <li key={p} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm">
                  <span className="capitalize">{p} <span className="text-emerald-400">✓ saved</span></span>
                  <button onClick={() => removeKey(p)} className="text-xs text-gray-400 hover:text-red-400">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mb-2">
          <div className="mb-2 text-sm font-medium">Your CV (markdown)</div>
          <textarea value={cv} onChange={(e) => setCv(e.target.value)} rows={6} placeholder="Paste your CV in markdown…" className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/40" />
          <button onClick={saveResume} className="mt-2 liquid-glass rounded-full px-4 py-2 text-sm font-medium">Save CV</button>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="mb-2 text-sm font-medium">Your data</div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={downloadData} className="liquid-glass rounded-full px-4 py-2 text-sm font-medium">Download my data</button>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="rounded-full border border-red-800/50 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-950/30">Delete account</button>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-red-300">Erases everything. Sure?</span>
                <button onClick={removeAccount} className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500">Delete forever</button>
                <button onClick={() => setConfirmDelete(false)} className="rounded-full border border-white/15 px-3 py-1.5 text-xs">Cancel</button>
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-600">Export is JSON (GDPR portability). Delete removes your account, data, and saved keys — irreversible.</p>
        </div>

        {msg && <p role="status" className="mt-4 text-sm text-emerald-400">{msg}</p>}
    </Dialog>
  );
}
