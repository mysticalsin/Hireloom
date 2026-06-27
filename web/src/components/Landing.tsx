import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Sparkles, Target, KanbanSquare, KeyRound, ScanSearch, FileText, Send, Star, Github } from 'lucide-react';
import AuthModal from './AuthModal';
import { Reveal, MagneticButton, useLenis } from './landing/Reveal';
import { Pricing, FAQ } from './landing/Pricing';

const NAV: [string, string][] = [['Features', '#features'], ['How it works', '#how'], ['Pricing', '#pricing'], ['FAQ', '#faq']];
const PROOF = ['Greenhouse', 'Lever', 'Ashby', 'Workday', 'SmartRecruiters', 'Indeed', 'LinkedIn'];

const FEATURES = [
  { Icon: ScanSearch, title: 'Fit scoring that tells the truth', body: 'Every role gets an honest A–G readout against your real CV — match, level, comp signal, legitimacy. Low-fit roles get you talked out of them, not into them.' },
  { Icon: FileText, title: 'Tailoring without the fiction', body: 'A sharp CV + cover letter drawn only from your actual record. No invented metrics. Work that survives a human read.' },
  { Icon: KanbanSquare, title: 'One calm pipeline', body: 'Every role you have ever touched — scanned, scored, applied — in one numbered directory. Inbox signals fold in automatically.' },
  { Icon: KeyRound, title: 'Bring your own key', body: 'Claude, GPT, Gemini, OpenRouter, or Kimi. Your key, your cost, zero markup. Encrypted in a vault, never echoed back.' },
];

const STEPS = [
  { Icon: Sparkles, title: 'Paste a role', body: 'A URL or the raw JD. Hireloom reads it safely and scores the fit on your key.' },
  { Icon: Target, title: 'Score & tailor', body: 'Get the A–G readout, then a truthful tailored CV + cover letter in a click.' },
  { Icon: Send, title: 'Apply on your terms', body: 'We draft the answers; you review and submit on the posting. The bot never clicks send.' },
];

export default function Landing() {
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | null>(null);
  const reduce = useReducedMotion();
  useLenis();
  const start = () => setAuthMode('signup');

  return (
    <div className="min-h-full bg-canvas text-ink">
      <nav className="sticky top-0 z-40 border-b border-hairline bg-canvas/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 md:px-10">
          <a href="#top" className="font-display text-xl font-semibold tracking-tight">Hireloom</a>
          <div className="hidden items-center gap-8 md:flex">
            {NAV.map(([label, href]) => (
              <a key={href} href={href} className="text-sm text-ink-muted transition-colors hover:text-ink">{label}</a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAuthMode('signin')} className="rounded-full px-4 py-2 text-sm text-ink-muted hover:text-ink">Sign in</button>
            <button onClick={start} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-transform duration-200 ease-atelier active:scale-[0.97]">Start free</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header id="top" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-[-10%] h-[60vh] w-[80vw] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
        </div>
        <div className="mx-auto max-w-4xl px-6 py-28 text-center md:py-36">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-xs text-ink-muted">
              <Star size={13} className="fill-accent text-accent" /> 740+ offers evaluated · 100+ tailored CVs
            </span>
            <h1 className="mt-6 font-display text-5xl leading-[1.05] tracking-tight md:text-7xl">
              Apply to fewer jobs.<br /><span className="text-accent">Get more interviews.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-muted">
              The anti-spam career atelier. Score every role, tailor truthfully, and track your whole search — on your own AI key, with no token markup.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <MagneticButton onClick={start} ariaLabel="Start free" className="rounded-full bg-accent px-7 py-3 font-medium text-on-accent shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
                Start free — bring your key
              </MagneticButton>
              <button onClick={() => setAuthMode('signin')} className="rounded-full border border-hairline-strong px-7 py-3 font-medium text-ink hover:bg-surface-2">Sign in</button>
            </div>
            <p className="mt-4 text-xs text-ink-faint">No card. Your AI key stays yours.</p>
          </motion.div>
        </div>
      </header>

      {/* Proof marquee */}
      <section aria-label="Reads postings from major job boards" className="border-y border-hairline bg-surface/50 py-6">
        <p className="mb-4 text-center text-xs uppercase tracking-widest text-ink-faint">Reads the boards you already use</p>
        <div className="relative overflow-hidden">
          <div className={`flex w-max gap-12 px-6 ${reduce ? '' : 'animate-marquee'}`}>
            {[...PROOF, ...PROOF].map((p, i) => <span key={i} className="font-display text-lg text-ink-faint">{p}</span>)}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24 md:px-10">
        <Reveal className="mb-12 max-w-2xl">
          <h2 className="font-display text-3xl tracking-tight md:text-4xl">A quiet atelier, not a spam cannon.</h2>
          <p className="mt-3 text-ink-muted">Four things, done with taste.</p>
        </Reveal>
        <div className="grid gap-5 md:grid-cols-2">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.05}>
              <div className="flex h-full gap-4 rounded-2xl border border-hairline bg-surface p-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><f.Icon size={20} /></div>
                <div>
                  <h3 className="font-medium text-ink">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{f.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-hairline bg-surface/30">
        <div className="mx-auto max-w-6xl px-6 py-24 md:px-10">
          <Reveal className="mb-12 text-center"><h2 className="font-display text-3xl tracking-tight md:text-4xl">Three steps. You stay in control.</h2></Reveal>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.07} className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-surface text-accent"><s.Icon size={20} /></div>
                <div className="mb-1 font-mono text-xs text-ink-faint">0{i + 1}</div>
                <h3 className="font-medium text-ink">{s.title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <Pricing onStart={start} />
      <FAQ />

      {/* Final CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-28 text-center md:px-10">
        <Reveal>
          <div className="rounded-3xl border border-hairline bg-surface p-12">
            <h2 className="font-display text-3xl tracking-tight md:text-4xl">Run your next search like an atelier.</h2>
            <p className="mx-auto mt-3 max-w-lg text-ink-muted">Fewer applications. Sharper ones. Your key, your data, your call on every submit.</p>
            <div className="mt-7 flex justify-center">
              <MagneticButton onClick={start} ariaLabel="Start free" className="rounded-full bg-accent px-7 py-3 font-medium text-on-accent shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
                Start free
              </MagneticButton>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-ink-faint md:flex-row md:px-10">
          <div><span className="font-display text-base text-ink-muted">Hireloom</span> <span className="ml-2">heir + loom · a quiet career atelier</span></div>
          <div className="flex items-center gap-6">
            <a href="/privacy" className="hover:text-ink">Privacy</a>
            <a href="/terms" className="hover:text-ink">Terms</a>
            <a href="https://github.com/mysticalsin/Hireloom" target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:text-ink"><Github size={14} /> Open source</a>
          </div>
        </div>
      </footer>

      {authMode && <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSwitch={(m) => setAuthMode(m)} />}
    </div>
  );
}
