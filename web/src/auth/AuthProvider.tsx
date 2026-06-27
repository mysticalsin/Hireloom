import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

type Result = { error?: string };

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  passwordRecovery: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<Result>;
  signIn: (email: string, password: string) => Promise<Result>;
  signInWithGoogle: () => Promise<Result>;
  connectGmail: () => Promise<Result>;
  resetPassword: (email: string) => Promise<Result>;
  updatePassword: (password: string) => Promise<Result>;
  clearRecovery: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // User arrived from a reset email → show the set-new-password screen.
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName?: string): Promise<Result> => {
    if (!supabase) return { error: 'Auth is not configured yet.' };
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    return { error: error?.message };
  };
  const signIn = async (email: string, password: string): Promise<Result> => {
    if (!supabase) return { error: 'Auth is not configured yet.' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  };
  const signInWithGoogle = async (): Promise<Result> => {
    if (!supabase) return { error: 'Auth is not configured yet.' };
    // Auth only — Gmail inbox scope is requested later via incremental consent
    // (connectGmail in the dashboard), not bundled into sign-in.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    return { error: error?.message };
  };
  const connectGmail = async (): Promise<Result> => {
    if (!supabase) return { error: 'Auth is not configured yet.' };
    // Incremental, opt-in Gmail read-only consent — requested from the dashboard,
    // never bundled into sign-in (keeps login friction low + avoids the scary
    // restricted-scope consent at first touch).
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    return { error: error?.message };
  };
  const resetPassword = async (email: string): Promise<Result> => {
    if (!supabase) return { error: 'Auth is not configured yet.' };
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    return { error: error?.message };
  };
  const updatePassword = async (password: string): Promise<Result> => {
    if (!supabase) return { error: 'Auth is not configured yet.' };
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message };
  };
  const clearRecovery = () => setPasswordRecovery(false);
  const signOut = async () => { await supabase?.auth.signOut(); };

  return (
    <AuthContext.Provider
      value={{
        session, user: session?.user ?? null, loading, configured: isSupabaseConfigured, passwordRecovery,
        signUp, signIn, signInWithGoogle, connectGmail, resetPassword, updatePassword, clearRecovery, signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
