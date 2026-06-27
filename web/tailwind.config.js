/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Token names map 1:1 to the CSS vars in index.css (see DESIGN.md §1).
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        overlay: 'var(--overlay)',
        hairline: 'var(--border)',
        'hairline-strong': 'var(--border-strong)',
        ink: 'var(--text)',
        'ink-muted': 'var(--text-muted)',
        'ink-faint': 'var(--text-faint)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-press': 'var(--accent-press)',
        'on-accent': 'var(--on-accent)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '20px', '2xl': '28px' },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.30)',
        md: '0 8px 24px rgba(0,0,0,0.35)',
        // The ONE glowing CTA only (DESIGN.md §8).
        glow: '0 0 0 1px rgba(224,164,88,0.35), 0 8px 40px rgba(224,164,88,0.20)',
      },
      transitionTimingFunction: { atelier: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      keyframes: {
        'blur-fade-up': {
          from: { opacity: '0', filter: 'blur(20px)', transform: 'translateY(40px)' },
          to: { opacity: '1', filter: 'blur(0)', transform: 'translateY(0)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
      },
      animation: {
        // <300ms UI; the 1s entrance is marketing-only (DESIGN.md §6/§8).
        'blur-fade-up': 'blur-fade-up 1s var(--ease-atelier) forwards',
        'fade-in': 'fade-in 200ms var(--ease-atelier) forwards',
        'scale-in': 'scale-in 200ms var(--ease-atelier) forwards',
      },
    },
  },
  plugins: [],
};
