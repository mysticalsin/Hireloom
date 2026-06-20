import { useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

interface AuthModalProps {
  mode: 'signin' | 'signup';
  onClose: () => void;
  onSwitch: (mode: 'signin' | 'signup') => void;
}

export default function AuthModal({ mode, onClose, onSwitch }: AuthModalProps) {
  const { signIn, signUp, signInWithGoogle, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === 'signup';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email || !password) { setError('Email and password are required.'); return; }
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    setBusy(true);
    const res = isSignup ? await signUp(email, password, fullName) : await signIn(email, password);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    if (isSignup) { setNotice('Check your email to confirm your account, then sign in.'); return; }
    onClose();
  };

  const google = async () => {
    setError(null);
    const res = await signInWithGoogle();
    if (res.error) setError(res.error);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="liquid-glass relative w-full max-w-md rounded-2xl bg-gray-900/70 p-7 text-white shadow-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-gray-400 hover:text-white">
          <X size={20} />
        </button>

        <h2 className="mb-1 text-2xl font-semibold tracking-tight">
          {isSignup ? 'Create your account' : 'Welcome back'}
        </h2>
        <p className="mb-6 text-sm text-gray-400">
          {isSignup ? 'Start free. Bring your own AI key — no card required.' : 'Sign in to your Hireloom atelier.'}
        </p>

        {!configured && (
          <p className="mb-4 rounded-lg border border-yellow-700/40 bg-yellow-900/20 p-3 text-sm text-yellow-200">
            Auth isn’t configured yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
          </p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          {isSignup && (
            <input
              className="rounded-lg border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus:border-white/40"
              placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name"
            />
          )}
          <input
            className="rounded-lg border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus:border-white/40"
            placeholder="you@email.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required
          />
          <input
            className="rounded-lg border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus:border-white/40"
            placeholder="Password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? 'new-password' : 'current-password'} required
          />

          {error && <p className="text-sm text-red-400">{error}</p>}
          {notice && <p className="text-sm text-emerald-400">{notice}</p>}

          <button type="submit" disabled={busy || !configured} className="mt-1 rounded-full bg-white px-6 py-3 font-medium text-black transition-colors hover:bg-gray-200 disabled:opacity-50">
            {busy ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-gray-500">
          <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
        </div>

        <button onClick={google} disabled={!configured} className="liquid-glass w-full rounded-full px-6 py-3 text-sm font-medium disabled:opacity-50">
          Continue with Google
        </button>

        <p className="mt-6 text-center text-sm text-gray-400">
          {isSignup ? 'Already have an account?' : 'New to Hireloom?'}{' '}
          <button onClick={() => onSwitch(isSignup ? 'signin' : 'signup')} className="text-white underline underline-offset-4">
            {isSignup ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  );
}
