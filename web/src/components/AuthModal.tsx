import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useFocusTrap } from '../lib/useFocusTrap';

interface AuthModalProps {
  mode: 'signin' | 'signup';
  onClose: () => void;
  onSwitch: (mode: 'signin' | 'signup') => void;
}

const FIELD = 'min-h-11 rounded-lg border border-hairline bg-surface-2 px-4 py-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export default function AuthModal({ mode, onClose, onSwitch }: AuthModalProps) {
  const { signIn, signUp, signInWithGoogle, resetPassword, configured } = useAuth();
  const [view, setView] = useState<'auth' | 'forgot'>('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isSignup = mode === 'signup';

  // Trap Tab + Escape + restore focus; autofocus the first field on open.
  useFocusTrap(panelRef, onClose);
  useEffect(() => { firstField.current?.focus(); }, [mode, view]);

  const reset = () => { setError(null); setNotice(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); reset();
    if (!email || !password) { setError('Email and password are required.'); return; }
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    setBusy(true);
    const res = isSignup ? await signUp(email, password, fullName) : await signIn(email, password);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    if (isSignup) { setNotice('Check your email to confirm your account, then sign in.'); return; }
    onClose();
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault(); reset();
    if (!email) { setError('Enter your email.'); return; }
    setBusy(true);
    const res = await resetPassword(email);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setNotice('If that email has an account, a reset link is on its way.');
  };

  const google = async () => { reset(); const res = await signInWithGoogle(); if (res.error) setError(res.error); };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-hairline-strong bg-surface p-7 text-ink shadow-md">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <X size={20} />
        </button>

        {view === 'forgot' ? (
          <>
            <h2 id="auth-title" className="mb-1 font-display text-2xl font-semibold tracking-tight">Reset your password</h2>
            <p className="mb-6 text-sm text-ink-muted">We’ll email a secure link to set a new one.</p>
            <form onSubmit={sendReset} className="flex flex-col gap-3">
              <label htmlFor="reset-email" className="sr-only">Email</label>
              <input id="reset-email" ref={firstField} className={FIELD} placeholder="you@email.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              {notice && <p role="status" className="text-sm text-success">{notice}</p>}
              <button type="submit" disabled={busy || !configured} className="mt-1 min-h-11 rounded-full bg-accent px-6 py-3 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">{busy ? 'Sending…' : 'Send reset link'}</button>
            </form>
            <p className="mt-6 text-center text-sm text-ink-muted">
              <button onClick={() => { setView('auth'); reset(); }} className="min-h-11 text-ink underline underline-offset-4">Back to sign in</button>
            </p>
          </>
        ) : (
          <>
            <h2 id="auth-title" className="mb-1 font-display text-2xl font-semibold tracking-tight">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
            <p className="mb-6 text-sm text-ink-muted">{isSignup ? 'Start free. Bring your own AI key — no card required.' : 'Sign in to your Hireloom atelier.'}</p>

            {!configured && (
              <p role="alert" className="mb-4 rounded-lg border border-hairline-strong bg-surface-2 p-3 text-sm text-warning">
                Auth isn’t configured yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
              </p>
            )}

            <form onSubmit={submit} className="flex flex-col gap-3">
              {isSignup && (
                <>
                  <label htmlFor="auth-name" className="sr-only">Full name</label>
                  <input id="auth-name" ref={firstField} className={FIELD} placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
                </>
              )}
              <label htmlFor="auth-email" className="sr-only">Email</label>
              <input id="auth-email" ref={isSignup ? undefined : firstField} className={FIELD} placeholder="you@email.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              <label htmlFor="auth-password" className="sr-only">Password</label>
              <input id="auth-password" className={FIELD} placeholder="Password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSignup ? 'new-password' : 'current-password'} required />

              {!isSignup && (
                <button type="button" onClick={() => { setView('forgot'); reset(); }} className="min-h-11 self-start text-xs text-ink-muted underline underline-offset-4 hover:text-ink">Forgot password?</button>
              )}
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              {notice && <p role="status" className="text-sm text-success">{notice}</p>}

              <button type="submit" disabled={busy || !configured} className="mt-1 min-h-11 rounded-full bg-accent px-6 py-3 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                {busy ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
              </button>
            </form>

            <div className="my-4 flex items-center gap-3 text-xs text-ink-faint">
              <span className="h-px flex-1 bg-hairline" /> or <span className="h-px flex-1 bg-hairline" />
            </div>

            <button onClick={google} disabled={!configured} className="min-h-11 w-full rounded-full border border-hairline-strong px-6 py-3 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
              Continue with Google
            </button>

            <p className="mt-6 text-center text-sm text-ink-muted">
              {isSignup ? 'Already have an account?' : 'New to Hireloom?'}{' '}
              <button onClick={() => onSwitch(isSignup ? 'signin' : 'signup')} className="min-h-11 text-ink underline underline-offset-4">
                {isSignup ? 'Sign in' : 'Create one'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
