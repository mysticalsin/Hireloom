import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Reveal } from './Reveal';

const TIERS = [
  {
    name: 'Free', price: '$0', cadence: 'forever', highlight: false, comingSoon: false,
    blurb: 'Bring your own key and score your search.',
    features: ['10 evaluations / month', 'Truthful tailoring (3 packages/mo)', 'One unified pipeline', 'Your own AI key — no markup'],
    cta: 'Start free',
  },
  {
    name: 'Pro', price: '$29', cadence: '/month', highlight: true, comingSoon: false,
    blurb: 'Unlimited scoring, inbox signals, assisted apply.',
    features: ['Unlimited evaluations', 'Unlimited tailored packages', 'Gmail inbox signals', 'Assisted apply (draft answers)', 'Priority support'],
    cta: 'Go Pro',
  },
  {
    // Not yet built — sold as "coming soon" (no checkout) until the features ship.
    name: 'Studio', price: '$79', cadence: '/month', highlight: false, comingSoon: true,
    blurb: 'Coming soon — the full atelier.',
    features: ['Everything in Pro', 'Search autopilot (soon)', 'Obsidian Second Brain (soon)', 'Multi-profile workspaces (soon)'],
    cta: 'Join the waitlist',
  },
];

export function Pricing({ onStart }: { onStart: () => void }) {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-24 md:px-10">
      <Reveal className="mb-12 text-center">
        <h2 className="font-display text-3xl tracking-tight text-ink md:text-4xl">Pay your AI provider. Not us, twice.</h2>
        <p className="mx-auto mt-3 max-w-xl text-ink-muted">BYOK means inference is billed to your own key at cost. Plans unlock the atelier — never a token markup.</p>
      </Reveal>
      <div className="grid gap-5 md:grid-cols-3">
        {TIERS.map((t, i) => (
          <Reveal key={t.name} delay={i * 0.06}>
            <div className={`flex h-full flex-col rounded-2xl border p-6 ${t.highlight ? 'border-accent/40 bg-accent/[0.04] shadow-glow' : 'border-hairline bg-surface'}`}>
              {t.highlight && <span className="mb-3 w-fit rounded-full bg-accent/15 px-3 py-1 text-xs font-medium text-accent">Most popular</span>}
              <h3 className="font-display text-xl text-ink">{t.name}</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-semibold text-ink">{t.price}</span>
                <span className="text-sm text-ink-faint">{t.cadence}</span>
              </div>
              <p className="mt-3 text-sm text-ink-muted">{t.blurb}</p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-ink-muted">
                    <Check size={16} className="mt-0.5 shrink-0 text-accent" /> {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={t.comingSoon ? undefined : onStart}
                disabled={t.comingSoon}
                className={`mt-6 rounded-full px-5 py-2.5 text-sm font-medium transition-transform duration-200 ease-atelier active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${t.comingSoon ? 'cursor-not-allowed border border-hairline text-ink-faint' : t.highlight ? 'bg-accent text-on-accent' : 'border border-hairline-strong text-ink hover:bg-surface-2'}`}
              >
                {t.cta}
              </button>
            </div>
          </Reveal>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-ink-faint">Start on Free with your own key. Upgrade only when the atelier earns it.</p>
    </section>
  );
}

const FAQS = [
  { q: 'Is it really free?', a: 'The Free plan is free forever. You bring your own AI key (Anthropic, OpenAI, Gemini, OpenRouter, or Kimi), so inference is billed to you at cost — we never mark up tokens.' },
  { q: 'Does it auto-apply for me?', a: 'No. Hireloom drafts truthful CVs, cover letters, and answers — then stops. You review and submit on the posting yourself. Human-in-the-loop, always.' },
  { q: 'What happens to my CV and keys?', a: 'Your CV is row-level-isolated to your account. API keys are encrypted in a vault and never shown again or returned to the browser. Delete everything anytime from Settings.' },
  { q: 'Which AI providers work?', a: 'Anthropic (Claude), OpenAI (GPT), Google Gemini, OpenRouter (200+ models), and Kimi. Choose per evaluation.' },
  { q: 'Will it spam companies?', a: 'The opposite. Hireloom scores fit honestly and talks you out of low-fit roles. Five well-targeted applications beat fifty generic ones.' },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-24 md:px-10">
      <Reveal className="mb-10 text-center">
        <h2 className="font-display text-3xl tracking-tight text-ink md:text-4xl">Questions, answered</h2>
      </Reveal>
      <div className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {FAQS.map((f, i) => (
          <div key={f.q}>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="font-medium text-ink">{f.q}</span>
              <ChevronDown size={18} className={`shrink-0 text-ink-faint transition-transform duration-200 ${open === i ? 'rotate-180' : ''}`} />
            </button>
            {open === i && <p className="px-5 pb-5 text-sm leading-relaxed text-ink-muted">{f.a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
