import { Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import SetNewPassword from './components/SetNewPassword';
import Landing from './components/Landing';
import CookieConsent from './components/CookieConsent';

// Dashboard is the heavy authed surface — load it only after sign-in. The public
// Landing is eager so the marketing LCP paints without a chunk round-trip.
const Dashboard = lazy(() => import('./components/Dashboard'));

function Loading() {
  return <div className="flex h-full items-center justify-center bg-canvas text-ink-faint">Loading…</div>;
}

function Shell() {
  const { session, loading, passwordRecovery } = useAuth();

  if (loading) return <Loading />;
  // Arrived from a reset email → set a new password (takes priority).
  if (passwordRecovery) return <SetNewPassword />;
  // Signed in → the app (lazy). Signed out → the cinematic landing (eager).
  if (session) {
    return (
      <Suspense fallback={<Loading />}>
        <Dashboard />
      </Suspense>
    );
  }
  return <Landing />;
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
      {/* Mounted outside Shell so the consent notice shows on landing + app, any auth state. */}
      <CookieConsent />
    </AuthProvider>
  );
}
