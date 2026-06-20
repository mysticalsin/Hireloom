import { useState } from 'react';
import {
  Search, User, Menu, X, Star, FileText, KeyRound,
  Play, ChevronLeft, ChevronRight,
} from 'lucide-react';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_094145_4a271a6c-3869-4f1c-8aa7-aeb0cb227994.mp4';

const NAV_LINKS = ['Features', 'Pricing', 'How it works', 'FAQ', 'Open source'];

// Prev/Next cycle these value-prop slides (the cinematic "featured" rotator).
const SLIDES = [
  {
    title: ['Apply to fewer jobs.', 'Get more interviews.'],
    desc: 'The anti-spam AI job-search engine. Score every role, tailor truthfully, and track your whole pipeline — on your own AI key.',
  },
  {
    title: ['Truthful tailoring,', 'every single time.'],
    desc: 'A sharp CV and cover letter drawn only from your real record. No invented metrics — work that survives a human read.',
  },
  {
    title: ['Your whole search,', 'one calm view.'],
    desc: 'Fit-scored roles, inbox signals, follow-ups, and an honest pipeline. You approve every submit; the bot never clicks send.',
  },
];

const META = [
  { Icon: Star, label: '740+ offers evaluated', strong: true },
  { Icon: FileText, label: '100+ tailored CVs' },
  { Icon: KeyRound, label: 'BYOK · no token markup' },
];

interface HeroProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export default function Hero({ onGetStarted, onSignIn }: HeroProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const slide = SLIDES[idx];
  const prev = () => setIdx((i) => (i - 1 + SLIDES.length) % SLIDES.length);
  const next = () => setIdx((i) => (i + 1) % SLIDES.length);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white">
      {/* Background video */}
      <video
        className="fixed inset-0 z-0 h-full w-full object-cover"
        src={VIDEO_URL}
        autoPlay
        loop
        muted
        playsInline
      />
      {/* Bottom blur overlay (blur only, no dark gradient) */}
      <div className="bottom-blur pointer-events-none fixed inset-0 z-[1]" />

      <div className="relative z-10 flex h-full flex-col">
        {/* Navbar */}
        <nav className="relative z-50 flex items-center justify-between px-4 py-4 sm:px-6 md:px-12 md:py-6">
          <div className="flex items-center gap-2 animate-blur-fade-up" style={{ animationDelay: '0ms' }}>
            <span className="text-xl font-bold tracking-tight md:text-2xl">HIRELOOM</span>
          </div>

          <div className="hidden items-center gap-8 lg:flex">
            {NAV_LINKS.map((link, i) => (
              <a
                key={link}
                href="#"
                className="animate-blur-fade-up text-sm text-white/90 transition-colors hover:text-gray-300"
                style={{ animationDelay: `${100 + i * 50}ms` }}
              >
                {link}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onSignIn}
              className="liquid-glass hidden items-center gap-2 rounded-full px-4 py-2 text-sm font-medium sm:flex md:px-6 animate-blur-fade-up"
              style={{ animationDelay: '350ms' }}
            >
              <Search size={18} /> Sign in
            </button>
            <button
              onClick={onGetStarted}
              aria-label="Get started"
              className="liquid-glass hidden h-10 w-10 items-center justify-center rounded-full sm:flex animate-blur-fade-up"
              style={{ animationDelay: '400ms' }}
            >
              <User size={18} />
            </button>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Menu"
              className="liquid-glass flex h-10 w-10 items-center justify-center rounded-full lg:hidden animate-blur-fade-up"
              style={{ animationDelay: '350ms' }}
            >
              <span className="relative h-[18px] w-[18px]">
                <Menu size={18} className={`absolute inset-0 transition-all duration-500 ease-out ${menuOpen ? 'rotate-180 scale-50 opacity-0' : 'opacity-100'}`} />
                <X size={18} className={`absolute inset-0 transition-all duration-500 ease-out ${menuOpen ? 'opacity-100' : 'rotate-180 scale-50 opacity-0'}`} />
              </span>
            </button>
          </div>
        </nav>

        {/* Mobile menu */}
        <div
          className={`absolute left-0 right-0 top-[72px] z-40 border-b border-t border-gray-800 bg-gray-900/95 shadow-2xl backdrop-blur-lg transition-all duration-500 ease-out lg:hidden ${
            menuOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-4 opacity-0'
          }`}
        >
          <div className="flex flex-col px-4 py-3">
            {NAV_LINKS.map((link, i) => (
              <a
                key={link}
                href="#"
                className="rounded-lg px-3 py-3 text-sm transition-colors hover:bg-gray-800/50"
                style={{ transitionDelay: `${i * 50}ms` }}
              >
                {link}
              </a>
            ))}
            <div className="mt-2 flex gap-3 border-t border-gray-800 pt-3 sm:hidden">
              <button onClick={onSignIn} className="liquid-glass flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm">
                <Search size={16} /> Sign in
              </button>
              <button onClick={onGetStarted} className="liquid-glass flex h-10 w-10 items-center justify-center rounded-full" aria-label="Get started">
                <User size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Hero content */}
        <div className="z-10 flex flex-1 flex-col justify-end px-4 pb-8 sm:px-6 md:px-12 md:pb-16">
          <div className="flex flex-col items-end gap-8 md:flex-row">
            {/* Left */}
            <div className="flex-1" key={idx}>
              <div className="mb-6 flex flex-wrap items-center gap-3 text-xs animate-blur-fade-up sm:gap-6 sm:text-sm md:mb-8" style={{ animationDelay: '300ms' }}>
                {META.map(({ Icon, label, strong }) => (
                  <span key={label} className="flex items-center gap-2">
                    <Icon size={16} className={`sm:h-5 sm:w-5 ${strong ? 'fill-white' : ''}`} />
                    <span className={strong ? 'font-medium' : ''}>{label}</span>
                  </span>
                ))}
              </div>

              <h1 className="mb-4 text-3xl font-normal sm:text-5xl md:mb-6 md:text-6xl lg:text-7xl animate-blur-fade-up" style={{ letterSpacing: '-0.04em', animationDelay: '400ms' }}>
                {slide.title[0]}<br />{slide.title[1]}
              </h1>

              <p className="mb-6 max-w-2xl text-base text-gray-300 sm:text-lg md:mb-12 md:text-xl animate-blur-fade-up" style={{ animationDelay: '500ms' }}>
                {slide.desc}
              </p>

              <div className="flex flex-wrap gap-3 sm:gap-4">
                <button
                  onClick={onGetStarted}
                  className="flex items-center gap-2 rounded-full bg-white px-6 py-2.5 font-medium text-black transition-colors hover:bg-gray-200 sm:px-8 sm:py-3 animate-blur-fade-up"
                  style={{ animationDelay: '600ms' }}
                >
                  <Play size={18} className="fill-black" /> Get started
                </button>
                <button
                  onClick={onSignIn}
                  className="liquid-glass rounded-full px-6 py-2.5 font-medium sm:px-8 sm:py-3 animate-blur-fade-up"
                  style={{ animationDelay: '700ms' }}
                >
                  Sign in
                </button>
              </div>
            </div>

            {/* Right: slide indicator + nav */}
            <div className="flex flex-col items-start gap-3 self-start md:items-end md:self-end">
              <div className="flex gap-2 animate-blur-fade-up" style={{ animationDelay: '780ms' }}>
                {SLIDES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setIdx(i)}
                    aria-label={`Slide ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === idx ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'}`}
                  />
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={prev} aria-label="Previous" className="liquid-glass flex items-center gap-1 rounded-full px-4 py-2.5 sm:px-6 sm:py-3 animate-blur-fade-up" style={{ animationDelay: '800ms' }}>
                  <ChevronLeft size={18} />
                </button>
                <button onClick={next} aria-label="Next" className="liquid-glass flex items-center gap-1 rounded-full px-4 py-2.5 sm:px-6 sm:py-3 animate-blur-fade-up" style={{ animationDelay: '900ms' }}>
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
