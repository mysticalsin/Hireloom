import { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import Hero from './components/Hero';
import AuthModal from './components/AuthModal';
import Dashboard from './components/Dashboard';

function Shell() {
  const { session, loading } = useAuth();
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | null>(null);

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-black text-gray-500">Loading…</div>;
  }

  // Signed in → the app. Signed out → the cinematic landing.
  if (session) return <Dashboard />;

  return (
    <>
      <Hero onGetStarted={() => setAuthMode('signup')} onSignIn={() => setAuthMode('signin')} />
      {authMode && (
        <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSwitch={(m) => setAuthMode(m)} />
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
