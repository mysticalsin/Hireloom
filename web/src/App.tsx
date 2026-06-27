import { Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import SetNewPassword from './components/SetNewPassword';

// Code-split: logged-out visitors load only the landing chunk; the authed dashboard
// (and its deps) load on demand after sign-in.
const Dashboard = lazy(() => import('./components/Dashboard'));
const Landing = lazy(() => import('./components/Landing'));

function Loading() {
  return <div className="flex h-full items-center justify-center bg-canvas text-ink-faint">Loading…</div>;
}

function Shell() {
  const { session, loading, passwordRecovery } = useAuth();

  if (loading) return <Loading />;
  // Arrived from a reset email → set a new password (takes priority).
  if (passwordRecovery) return <SetNewPassword />;
  // Signed in → the app. Signed out → the cinematic landing.
  return (
    <Suspense fallback={<Loading />}>
      {session ? <Dashboard /> : <Landing />}
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
