import { useEffect, useState } from 'react';
import { LogOut, Briefcase, Gauge, CreditCard } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { getSubscription, getUsage, listRoles, type RoleRow, type Subscription } from '../lib/db';
import { startCheckout } from '../lib/billing';

const PLAN_CAP: Record<string, number> = { free: 10, pro: Infinity, studio: Infinity };

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [used, setUsed] = useState(0);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingMsg, setBillingMsg] = useState<string | null>(null);

  const upgrade = async (plan: 'pro' | 'studio') => {
    setBillingMsg('Redirecting to checkout…');
    const r = await startCheckout(plan);
    if (r.error) setBillingMsg(r.error);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, u, r] = await Promise.all([getSubscription(), getUsage(), listRoles()]);
      if (!alive) return;
      setSub(s); setUsed(u); setRoles(r); setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const plan = sub?.plan ?? 'free';
  const cap = PLAN_CAP[plan] ?? 10;

  return (
    <div className="min-h-full bg-black text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-5 md:px-12">
        <span className="text-xl font-bold tracking-tight">HIRELOOM</span>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-gray-400 sm:inline">{user?.email}</span>
          <button onClick={signOut} className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2 text-sm">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 md:px-12">
        <h1 className="mb-1 text-3xl font-semibold tracking-tight">Your atelier</h1>
        <p className="mb-8 text-gray-400">Everything Hireloom tracks for your search, in one place.</p>

        <div className="mb-10 grid gap-4 sm:grid-cols-3">
          <Card icon={<CreditCard size={18} />} label="Plan">
            <span className="text-2xl font-semibold capitalize">{plan}</span>
            <span className="ml-2 text-sm text-gray-400">{sub?.status ?? '—'}</span>
          </Card>
          <Card icon={<Gauge size={18} />} label="Evaluations this month">
            <span className="text-2xl font-semibold">{used}</span>
            <span className="ml-2 text-sm text-gray-400">/ {cap === Infinity ? '∞' : cap}</span>
          </Card>
          <Card icon={<Briefcase size={18} />} label="Roles tracked">
            <span className="text-2xl font-semibold">{roles.length}</span>
          </Card>
        </div>

        {plan !== 'studio' && (
          <div className="mb-10 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <span className="text-sm text-gray-300">
              {plan === 'free'
                ? 'You’re on Free. Upgrade for unlimited evaluations, inbox signals, and assisted apply.'
                : 'You’re on Pro. Go Studio for autopilot scanning + the Second Brain.'}
            </span>
            <div className="ml-auto flex gap-3">
              {plan === 'free' && (
                <button onClick={() => upgrade('pro')} className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-200">
                  Upgrade to Pro
                </button>
              )}
              <button onClick={() => upgrade('studio')} className="liquid-glass rounded-full px-5 py-2 text-sm font-medium">
                Upgrade to Studio
              </button>
            </div>
            {billingMsg && <span className="w-full text-sm text-gray-400">{billingMsg}</span>}
          </div>
        )}

        <h2 className="mb-3 text-lg font-semibold">Roles</h2>
        <div className="overflow-hidden rounded-xl border border-white/10">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading…</div>
          ) : roles.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No roles yet. Paste a job URL into the engine to score and tailor your first one.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-gray-400">
                <tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
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
    </div>
  );
}

function Card({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-400">{icon} {label}</div>
      <div>{children}</div>
    </div>
  );
}
