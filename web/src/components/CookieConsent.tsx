import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cookie-consent';

// Strictly-necessary + theme storage notice. No ad tracking, so this is a single
// "got it" acknowledgement rather than a granular opt-in/out flow. Dismissal is
// remembered in localStorage so the banner shows once per browser.
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== '1') setVisible(true);
    } catch {
      // Private mode / storage blocked → show the notice but don't crash.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Ignore: if we can't persist, the banner simply reappears next load.
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="cookie notice"
      className="fixed inset-x-0 bottom-0 z-[110] motion-safe:animate-fade-in border-t border-hairline-strong bg-surface text-ink shadow-md"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          Hireloom stores a sign-in session in your browser (strictly necessary) and remembers your
          theme. No ad tracking.{' '}
          <a href="/privacy" className="text-ink underline underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Privacy
          </a>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
