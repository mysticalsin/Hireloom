import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';

// Shown when the user arrives from a reset email (Supabase fires PASSWORD_RECOVERY).
export default function SetNewPassword() {
  const { updatePassword, clearRecovery, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    setBusy(true);
    const res = await updatePassword(password);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    clearRecovery(); // session is active → the app renders the dashboard
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-4" role="dialog" aria-modal="true" aria-labelledby="reset-title">
      <div className="liquid-glass w-full max-w-md rounded-2xl bg-gray-900/70 p-7 text-white shadow-2xl">
        <h2 id="reset-title" className="mb-1 text-2xl font-semibold tracking-tight">Set a new password</h2>
        <p className="mb-6 text-sm text-gray-400">Choose a new password for your account.</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="new-password" className="sr-only">New password</label>
          <input
            id="new-password" autoFocus type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters)"
            autoComplete="new-password" required
            className="rounded-lg border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          />
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={busy} className="mt-1 rounded-full bg-white px-6 py-3 font-medium text-black transition-colors hover:bg-gray-200 disabled:opacity-50">
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
        <button onClick={() => { clearRecovery(); signOut(); }} className="mt-4 w-full text-center text-sm text-gray-400 underline underline-offset-4 hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}
