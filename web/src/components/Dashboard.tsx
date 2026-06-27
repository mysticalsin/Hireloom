import { useCallback, useEffect, useState } from 'react';
import { LogOut, Briefcase, Gauge, CreditCard, Sparkles, Settings as SettingsIcon, Check, X, Sun, Moon, ExternalLink } from 'lucide-react';
import Dialog from './Dialog';
import { useAuth } from '../auth/AuthProvider';
import { getSubscription, getUsage, listRoles, type RoleRow, type Subscription } from '../lib/db';
import { startCheckout, openBillingPortal } from '../lib/billing';
import { runEvaluation } from '../lib/evaluate';
import { runDemoEval } from '../lib/demo';
import { getCv, saveCv, getSavedProviders, saveProviderKey, validateProviderKey, deleteProviderKey, exportMyData, deleteMyAccount } from '../lib/settings';
import { getInboxSignals, type Signal } from '../lib/gmail';
import { track } from '../lib/analytics';
import RoleDetail from './RoleDetail';

const SIGNAL_STYLE: Record<string, string> = {
  offer: 'text-success border-hairline-strong',
  interview: 'text-info border-hairline-strong',
  rejection: 'text-danger border-hairline-strong',
  response: 'text-ink-muted border-hairline',
};

const PLAN_CAP: Record<string, number> = { free: 10, pro: Infinity, studio: Infinity };
const PROVIDERS = ['anthropic', 'openai', 'gemini', 'kimi', 'openrouter'];
// Where each provider mints API keys — surfaced next to the BYOK input so a new
// user isn't left hunting for the right console.
const CONSOLE_URL: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
  kimi: 'https://platform.moonshot.ai/console/api-keys',
};

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
  const [hasKey, setHasKey] = useState(false);
  const [savedProviders, setSavedProviders] = useState<string[]>([]);
  const [hasCv, setHasCv] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') === 'light' ? 'light' : 'dark'),
  );

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

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

  // keyless "try a sample score" demo (operator-funded; off → button hides)
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState<string | null>(null);
  const [demoReport, setDemoReport] = useState<string | null>(null);
  const [demoOff, setDemoOff] = useState(false);

  // Stable handlers so the modals' focus-trap/scroll-lock effects don't tear down on parent re-render.
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const closeRole = useCallback(() => setSelectedRole(null), []);

  async function reload() {
    setLoading(true); setLoadErr(null);
    try {
      const [s, u, r, providers, cv] = await Promise.all([
        getSubscription(), getUsage(), listRoles(),
        getSavedProviders().catch(() => [] as string[]), getCv().catch(() => ''),
      ]);
      setSub(s); setUsed(u); setRoles(r); setHasKey(providers.length > 0); setSavedProviders(providers); setHasCv(!!cv.trim());
      // Default the eval provider to one the user actually has a key for; leave a manual pick alone.
      setProvider((cur) => (providers.length > 0 && !providers.includes(cur) ? providers[0] : cur));
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
  const manageBilling = async () => {
    setBillingMsg('Opening billing portal…');
    const r = await openBillingPortal();
    if (r.error) setBillingMsg(r.error);
  };

  const evaluate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setEvalBusy(true); setEvalMsg('Evaluating… this can take 30–60s.');
    const r = await runEvaluation(input.trim(), provider);
    setEvalBusy(false);
    if (r.error) { setEvalMsg(r.error); return; }
    track('eval_run', { provider });
    setEvalMsg(`Scored ${r.summary?.company} — ${r.summary?.role}: ${r.summary?.score}/5`);
    setInput('');
    reload();
  };

  const tryDemo = async () => {
    setDemoBusy(true); setDemoErr(null);
    const r = await runDemoEval();
    setDemoBusy(false);
    if (r.disabled) { setDemoOff(true); return; } // operator hasn't funded the demo → hide silently
    if (r.error) { setDemoErr(r.error); return; }
    track('demo_run');
    setDemoReport(r.markdown ?? null);
  };

  return (
    <div className="min-h-full bg-canvas text-ink">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-5 md:px-12">
        <span className="font-display text-xl font-semibold tracking-tight">Hireloom</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-ink-muted sm:inline">{user?.email}</span>
          <button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} className="flex h-11 w-11 items-center justify-center rounded-full border border-hairline-strong text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button onClick={() => setShowSettings(true)} className="flex min-h-11 items-center gap-2 rounded-full border border-hairline-strong px-4 py-2 text-sm text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><SettingsIcon size={16} /> Settings</button>
          <button onClick={signOut} className="flex min-h-11 items-center gap-2 rounded-full border border-hairline-strong px-4 py-2 text-sm text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><LogOut size={16} /> Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 md:px-12">
        {banner && (
          <div className="mb-6 rounded-xl border border-hairline-strong bg-surface px-5 py-3 text-sm text-success">{banner}</div>
        )}

        {loadErr && (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline-strong bg-surface px-5 py-3 text-sm text-danger">
            <span>{loadErr}</span>
            <button onClick={reload} className="min-h-11 rounded-full border border-hairline-strong px-3 py-1 text-xs font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Retry</button>
          </div>
        )}

        <h1 className="mb-1 font-display text-3xl font-semibold tracking-tight">Your atelier</h1>
        <p className="mb-8 text-ink-muted">Everything Hireloom tracks for your search, in one place.</p>

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <Card icon={<CreditCard size={18} />} label="Plan">{loading ? <div className="h-8 w-24 animate-pulse rounded bg-surface-2" /> : <><span className="text-2xl font-semibold capitalize">{plan}</span><span className="ml-2 text-sm text-ink-muted">{sub?.status ?? '—'}</span></>}</Card>
          <Card icon={<Gauge size={18} />} label="Evaluations this month">{loading ? <div className="h-8 w-20 animate-pulse rounded bg-surface-2" /> : <><span className="text-2xl font-semibold">{used}</span><span className="ml-2 text-sm text-ink-muted">/ {cap === Infinity ? '∞' : cap}</span></>}</Card>
          <Card icon={<Briefcase size={18} />} label="Roles tracked">{loading ? <div className="h-8 w-12 animate-pulse rounded bg-surface-2" /> : <span className="text-2xl font-semibold">{roles.length}</span>}</Card>
        </div>

        {!loading && (!hasKey || !hasCv) && (
          <div className="mb-8 rounded-2xl border border-hairline bg-surface p-6">
            <h2 className="mb-1 font-display text-lg font-semibold">Get your first score in 3 steps</h2>
            <p className="mb-4 text-sm text-ink-muted">Hireloom runs on your own AI key — your CV and keys stay yours.</p>
            <ol className="space-y-2 text-sm">
              <li className="flex items-center gap-2">{hasKey ? <Check size={16} className="text-success" /> : <span className="w-4 text-ink-faint">1.</span>}<span className={hasKey ? 'text-ink-faint line-through' : 'text-ink'}>Add your AI provider key</span></li>
              <li className="flex items-center gap-2">{hasCv ? <Check size={16} className="text-success" /> : <span className="w-4 text-ink-faint">2.</span>}<span className={hasCv ? 'text-ink-faint line-through' : 'text-ink'}>Paste your CV</span></li>
              <li className="flex items-center gap-2"><span className="w-4 text-ink-faint">3.</span><span className="text-ink">Paste a job URL below to score it</span></li>
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={() => setShowSettings(true)} className="min-h-11 rounded-full bg-accent px-5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Open Settings</button>
              {!hasKey && !demoOff && (
                <button onClick={tryDemo} disabled={demoBusy} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline-strong px-5 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <Sparkles size={16} /> {demoBusy ? 'Scoring a sample…' : 'Try a sample score on us →'}
                </button>
              )}
            </div>
            {demoErr && <p role="alert" className="mt-3 text-sm text-danger">{demoErr}</p>}
            {demoReport && (
              <div className="mt-4 rounded-xl border border-hairline bg-surface-2 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><Sparkles size={15} className="text-accent" /> Your sample score</div>
                <div className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{demoReport}</div>
                <button onClick={() => setShowSettings(true)} className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Add your key to score real roles →</button>
              </div>
            )}
          </div>
        )}

        {/* New evaluation */}
        <div className="liquid-glass mb-8 rounded-2xl p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Sparkles size={16} className="text-accent" /> Evaluate a role</div>
          <form onSubmit={evaluate} className="flex flex-col gap-3 sm:flex-row">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste a job URL or the full JD text…" className="min-h-11 flex-1 rounded-lg border border-hairline bg-surface-2 px-4 py-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface" />
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="min-h-11 rounded-lg border border-hairline bg-surface-2 px-3 py-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface">
              {PROVIDERS.map((p) => <option key={p} value={p} className="bg-surface">{savedProviders.includes(p) ? p : `${p} (no key)`}</option>)}
            </select>
            <button type="submit" disabled={evalBusy || !savedProviders.includes(provider)} className="min-h-11 rounded-full bg-accent px-6 py-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{evalBusy ? 'Working…' : 'Evaluate'}</button>
          </form>
          {!savedProviders.includes(provider) && <p className="mt-3 text-sm text-ink-muted">Add a {provider} key in Settings to evaluate with it.</p>}
          {evalMsg && <p className="mt-3 text-sm text-ink-muted">{evalMsg}</p>}
          <p className="mt-2 text-xs text-ink-muted">Runs on your saved {provider} key (Settings). Score, tailor, track — truthfully.</p>
        </div>

        {plan === 'free' && (
          <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-surface p-5">
            <span className="text-sm text-ink-muted">You’re on Free. Upgrade to Pro for unlimited evaluations, inbox signals, and assisted apply.</span>
            <div className="ml-auto flex gap-3">
              <button onClick={() => { track('upgrade_click', { plan: 'pro' }); upgrade('pro'); }} className="min-h-11 rounded-full bg-accent px-5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Upgrade to Pro</button>
            </div>
            {billingMsg && <span className="w-full text-sm text-ink-muted">{billingMsg}</span>}
          </div>
        )}

        {plan !== 'free' && (
          <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-surface p-5 text-sm text-ink-muted">
            <span>Manage your subscription, payment method, and invoices.</span>
            <button onClick={manageBilling} className="ml-auto min-h-11 rounded-full border border-hairline-strong px-5 py-2 font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Manage billing</button>
            {billingMsg && <span className="w-full text-ink-muted">{billingMsg}</span>}
          </div>
        )}

        {/* Inbox signals */}
        <div className="mb-8 rounded-2xl border border-hairline bg-surface p-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Inbox signals</span>
            <button onClick={syncInbox} disabled={inboxBusy} className="min-h-11 rounded-full border border-hairline-strong px-4 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{inboxBusy ? 'Syncing…' : 'Sync inbox'}</button>
            {needsGmail && <button onClick={() => connectGmail()} className="min-h-11 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Connect Gmail</button>}
          </div>
          {inboxMsg && <p className="mb-3 text-xs text-ink-muted">{inboxMsg}</p>}
          {signals && signals.length > 0 && (
            <ul className="space-y-2">
              {signals.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm">
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs capitalize ${SIGNAL_STYLE[s.type] ?? 'text-ink-muted border-hairline'}`}>{s.type}</span>
                  <span className="truncate text-ink-muted">{s.subject}</span>
                  <span className="ml-auto shrink-0 text-xs text-ink-faint">{s.from.replace(/<.*>/, '').trim()}</span>
                </li>
              ))}
            </ul>
          )}
          {!signals && !inboxMsg && <p className="text-xs text-ink-muted">Read-only Gmail scan for responses, rejections, interviews, and offers. Runs in your browser on your Google token.</p>}
        </div>

        <h2 className="mb-3 font-display text-lg font-semibold">Roles</h2>
        <div className="overflow-hidden rounded-xl border border-hairline">
          {loading ? (
            <div className="divide-y divide-hairline" aria-busy="true" aria-label="Loading roles">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
                  <div className="h-4 w-48 animate-pulse rounded bg-surface-2" />
                  <div className="ml-auto h-4 w-10 animate-pulse rounded bg-surface-2" />
                  <div className="h-4 w-16 animate-pulse rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : roles.length === 0 ? <div className="p-8 text-center text-ink-faint">No roles yet. Paste a job URL above to score your first one.</div>
            : (
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted"><tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Status</th></tr></thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id} onClick={() => setSelectedRole(r)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedRole(r); } }} tabIndex={0} role="button" aria-label={`Open ${r.company} — ${r.title}`} className="cursor-pointer border-t border-hairline transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                      <td className="px-4 py-3 font-medium">{r.company}</td>
                      <td className="px-4 py-3 text-ink-muted">{r.title}</td>
                      <td className="px-4 py-3">{r.score ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-muted">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </main>

      {showSettings && <SettingsPanel onClose={closeSettings} />}
      {selectedRole && <RoleDetail role={selectedRole} onClose={closeRole} onChanged={reload} />}
    </div>
  );
}

function Card({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5">
      <div className="mb-2 flex items-center gap-2 text-sm text-ink-muted">{icon} {label}</div>
      <div>{children}</div>
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [cv, setCv] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [keyStatus, setKeyStatus] = useState<Record<string, { ok?: boolean; error?: string; testing?: boolean }>>({});
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { signOut } = useAuth();

  // Split status vs failure so errors don't render as green "success" text.
  const ok = (text: string) => setMsg({ text });
  const fail = (text: string) => setMsg({ text, error: true });

  useEffect(() => {
    getCv().then(setCv).catch(() => fail('Could not load your saved CV.'));
    getSavedProviders().then(setSaved).catch(() => {});
  }, []);

  // Ping the provider with the stored key; surface ✓/✗ inline (key stays server-side).
  const testKey = async (p: string) => {
    setKeyStatus((s) => ({ ...s, [p]: { testing: true } }));
    const r = await validateProviderKey(p);
    setKeyStatus((s) => ({ ...s, [p]: { ok: r.ok, error: r.error } }));
  };

  const saveKey = async () => {
    if (!apiKey.trim()) { fail('Enter a key.'); return; }
    const p = provider;
    const r = await saveProviderKey(p, apiKey.trim());
    if (r.error) { fail(r.error); return; }
    track('key_added', { provider: p });
    ok(`${p} key saved.`); setApiKey(''); getSavedProviders().then(setSaved).catch(() => {});
    testKey(p); // auto-validate the freshly-saved key
  };
  const removeKey = async (p: string) => {
    const r = await deleteProviderKey(p);
    if (r.error) { fail(r.error); return; }
    ok(`${p} key removed.`); getSavedProviders().then(setSaved).catch(() => {});
  };
  const downloadData = async () => {
    const r = await exportMyData();
    if (r.error) { fail(r.error); return; }
    if (r.url) {
      const a = document.createElement('a');
      a.href = r.url; a.download = 'hireloom-export.json'; a.click();
      URL.revokeObjectURL(r.url);
      ok('Your data was downloaded as JSON.');
    }
  };
  const removeAccount = async () => {
    const r = await deleteMyAccount();
    if (r.error) { fail(r.error); return; }
    await signOut();
  };
  const saveResume = async () => {
    const r = await saveCv(cv);
    if (r.error) { fail(r.error); return; }
    track('cv_added');
    ok('CV saved.');
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
        <div className="mb-6">
          <div className="mb-2 text-sm font-medium">AI provider key (BYOK)</div>
          <div className="flex gap-2">
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="min-h-11 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface">
              {PROVIDERS.map((p) => <option key={p} value={p} className="bg-surface">{p}</option>)}
            </select>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your key" className="min-h-11 flex-1 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface" />
            <button onClick={saveKey} className="min-h-11 rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">Save</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href={CONSOLE_URL[provider]} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface">Get a {provider} key <ExternalLink size={13} /></a>
            <span className="text-xs text-ink-faint">Most evaluations cost ~$0.01–0.05 on your own key — no markup from us.</span>
          </div>
          <p className="mt-2 text-xs text-ink-faint">Encrypted in a vault and never shown again. We never mark up tokens — you pay your provider directly.</p>
          {saved.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {saved.map((p) => {
                const st = keyStatus[p];
                return (
                  <li key={p} className="flex flex-col gap-1 rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="capitalize">{p} <span className="inline-flex items-center gap-0.5 text-success"><Check size={13} className="text-success" /> saved</span></span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => testKey(p)} disabled={st?.testing} className="min-h-11 px-3.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{st?.testing ? 'Testing…' : 'Test'}</button>
                        <button onClick={() => removeKey(p)} className="min-h-11 px-3.5 text-xs text-ink-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Remove</button>
                      </div>
                    </div>
                    <span role="status" aria-live="polite">
                      {st && !st.testing && (st.ok
                        ? <span className="inline-flex items-center gap-1 text-xs text-success"><Check size={13} className="text-success" /> Key works</span>
                        : <span className="inline-flex items-center gap-1 text-xs text-danger"><X size={13} className="text-danger" /> {st.error || 'Key check failed.'}</span>)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mb-2">
          <div className="mb-2 text-sm font-medium">Your CV (markdown)</div>
          <textarea value={cv} onChange={(e) => setCv(e.target.value)} rows={6} placeholder="Paste your CV in markdown…" className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface" />
          <button onClick={saveResume} className="mt-2 min-h-11 rounded-full border border-hairline-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Save CV</button>
        </div>

        <div className="mt-6 border-t border-hairline pt-5">
          <div className="mb-2 text-sm font-medium">Your data</div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={downloadData} className="min-h-11 rounded-full border border-hairline-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Download my data</button>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="min-h-11 rounded-full border border-hairline-strong px-4 py-2 text-sm font-medium text-danger hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Delete account</button>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-danger">Erases everything. Sure?</span>
                <button onClick={removeAccount} className="min-h-11 rounded-full bg-danger px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Delete forever</button>
                <button onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-full border border-hairline-strong px-3 py-1.5 text-xs text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-muted">Export is JSON (GDPR portability). Delete removes your account, data, and saved keys — irreversible.</p>
        </div>

        {msg && (
          <p role={msg.error ? 'alert' : 'status'} className={`mt-4 text-sm ${msg.error ? 'text-danger' : 'text-success'}`}>{msg.text}</p>
        )}
    </Dialog>
  );
}
