# DESIGN.md — Hireloom (Career Atelier)

> The single visual source of truth for the hosted SaaS (`web/`). No frontend code
> ships with a raw hex or off-token px — reference token **names**. Reconciled with
> `~/.claude/rules/design-standards.md` (the Apple-HIG + anti-AI-slop authority);
> any deviation is stated in "Known gaps", never silent.
>
> Brand: *heir + loom — a quiet career atelier.* Editorial, calm, precise. The
> opposite of the spammy job-board. Dark-first cinematic; one warm "thread" accent.

---

## 1 · Token graph (YAML — maps 1:1 to Tailwind theme + CSS vars)

```yaml
# ── color (dark = primary; light = mandatory companion) ──────────────────
colors:
  dark:
    canvas:        "#0A0A0B"   # app background (near-black, faint warmth)
    surface:       "#141416"   # raised cards / panels
    surface-2:     "#1C1D20"   # nested / inputs
    overlay:       "rgba(0,0,0,0.62)"   # modal scrim
    border:        "rgba(255,255,255,0.08)"   # hairline
    border-strong: "rgba(255,255,255,0.16)"
    text:          "#F5F4F1"   # warm off-white (not pure #fff)
    text-muted:    "#A6A5A3"
    text-faint:    "#6E6D6B"
    accent:        "#E0A458"   # the loom "thread" — the ONE accent (warm gold)
    accent-hover:  "#EFB770"
    accent-press:  "#C98F42"
    on-accent:     "#1A1204"   # text/icon on accent fill
    success:       "#34D399"
    warning:       "#F59E42"
    danger:        "#F87171"
    info:          "#7AA2F7"
  light:
    canvas:        "#FBFAF7"   # warm paper
    surface:       "#FFFFFF"
    surface-2:     "#F3F1EC"
    overlay:       "rgba(20,18,14,0.40)"
    border:        "rgba(10,10,11,0.10)"
    border-strong: "rgba(10,10,11,0.20)"
    text:          "#1A1A1C"
    text-muted:    "#57565A"
    text-faint:    "#8A8A8E"
    accent:        "#B5772A"   # darker gold for AA contrast on light
    accent-hover:  "#9C6420"
    accent-press:  "#824F16"
    on-accent:     "#FFFFFF"
    success:       "#15803D"
    warning:       "#B45309"
    danger:        "#B91C1C"
    info:          "#2155CD"

# ── typography (TWO faces: display serif + body grotesque) ────────────────
typography:
  display: "'Fraunces', ui-serif, Georgia, serif"   # headings, hero — optical, editorial
  body:    "'Inter', ui-sans-serif, system-ui, sans-serif"
  mono:    "'JetBrains Mono', ui-monospace, monospace"   # scores, keys, code
  scale_rem: { xs: 0.75, sm: 0.875, base: 1, lg: 1.125, xl: 1.25, "2xl": 1.5, "3xl": 1.875, "4xl": 2.5, "5xl": 3.5, "6xl": 4.5 }
  weight:   { regular: 400, medium: 500, semibold: 600 }   # hierarchy via size/weight/space — NOT color
  tracking_display: "-0.03em"   # tighten large display
  leading:  { tight: 1.1, snug: 1.3, normal: 1.55 }

# ── shape / space (8px rhythm; 4 = half-step only) ───────────────────────
rounded:  { sm: 6, md: 10, lg: 14, xl: 20, "2xl": 28, full: 9999 }   # px
spacing:  [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]   # px — 8px grid
shadow:
  sm: "0 1px 2px rgba(0,0,0,0.30)"
  md: "0 8px 24px rgba(0,0,0,0.35)"     # used sparingly — elevation via surface+hairline first
  glow: "0 0 0 1px rgba(224,164,88,0.35), 0 8px 40px rgba(224,164,88,0.20)"   # the ONE glowing CTA only

# ── components (token-bound specs) ───────────────────────────────────────
components:
  button:
    primary:   "bg=accent, text=on-accent, radius=full, h=44, press=scale(0.97)"
    secondary: "border=border-strong, text=text, bg=transparent, hover=surface-2"
    ghost:     "text=text-muted, hover:text=text"
    glow-cta:  "primary + shadow.glow — reserved for the single hero CTA"
  input:    "bg=surface-2, border=border, focus: ring 2px accent (>=3:1), radius=md, h=44, label REQUIRED (not placeholder-only)"
  card:     "bg=surface, border=border, radius=xl, padding=24"
  modal:    "scrim=overlay+blur(6px), panel bg=surface radius=2xl, focus-trap, Esc closes, initial focus set"
  badge:    "radius=full, text=xs, semantic-tinted border+text"
  table-row:"hover=surface-2, border-top=border, row min-h=44"
```

---

## 2 · Color usage
Dark is the default. Light mode is **not optional** — every component renders in both,
toggled by `data-theme` / `.dark` class; tokens above are the only source. **One accent
(gold "thread")** carries brand + the primary CTA + key highlights — never as body
text color, never gradient-washed across the page (that is the AI-slop tell). Semantic
colors are for state only (success/warning/danger/info), not decoration. Elevation comes
from `surface → surface-2` + a hairline `border`, not heavy shadows.

## 3 · Typography
Display = **Fraunces** (variable serif, optical size) for hero + section headings — the
editorial "atelier" voice. Body = **Inter** for everything readable. Mono = **JetBrains
Mono** for scores, API-key fields, and code. Hierarchy is built from size/weight/space,
never color. Display tracks tight (`-0.03em`); body leads at 1.55.

## 4 · Spacing & layout
8px rhythm (4 only as a half-step). Intentional asymmetry — **never three identical
centered cards**. Generous, uneven whitespace; content gets the room, chrome recedes.
Max content width ~1120px for app, full-bleed cinematic for the marketing hero.

## 5 · Components & required states
Every interactive component defines: **Default · Hover · Focus (2px visible ring ≥3:1) ·
Active (scale 0.97) · Loading (skeleton, not spinner-only) · Error · Empty · Disabled ·
Success.** Every data-fetching surface MUST render loading + error + empty (quality rule).
Icons: **Lucide only, one family. Zero emoji as UI icons.**

## 6 · Motion (Emil Kowalski rules)
Default curve `cubic-bezier(0.23, 1, 0.32, 1)`. UI transitions **<300ms**, **transform +
opacity only** (60fps). Enter from `scale(0.96)`/`translateY(8px)`, never `scale(0)`. Press
`scale(0.97)`. Lists stagger 30–80ms; exit ≈ 60–70% of enter. `ease-out` enter/exit,
`ease-in-out` on-screen morph, **never `ease-in`** on UI. `prefers-reduced-motion`: keep
opacity/color, **drop all movement/transform**. High-frequency actions get no motion.

## 7 · Accessibility (WCAG 2.2 AA — both modes)
Contrast 4.5:1 text / 3:1 large+UI, verified in light AND dark. Visible 2px focus ring
(≥3:1). Touch targets ≥44×44. Full keyboard nav, no focus traps except intentional modal
traps (with Esc + restore focus). Real `<label>`s (not placeholder-only). ARIA on dialogs,
tabs, live regions. Screen-reader pass before "done".

## 8 · Marketing "spectacle" (landing only — restraint still governs)
Dark cinematic hero = the product. Staggered text reveal on load (the existing
`blur-fade-up`, kept ≤300ms per item). Scroll-triggered reveals below the fold
(IntersectionObserver / Motion `whileInView`). Magnetic hover on the primary CTA. Glass
surfaces **sparingly** (nav + cards, not everything). Marquee social proof (740+ offers
evaluated · 100+ tailored CVs). **One** glowing CTA (`shadow.glow`, accent). Smooth scroll
via Lenis. Self-host or poster+lazy the hero video (no 5MB blocking LCP).

## 9 · Anti-slop guardrails (pre-ship blocking checklist)
- [ ] Exactly ONE accent (gold). No purple/indigo default, no rainbow gradients.
- [ ] Two typefaces (Fraunces + Inter); hierarchy via size/weight/space.
- [ ] Intentional asymmetry & real hierarchy — not 3 identical centered cards.
- [ ] Lucide icons, one family; zero emoji as UI.
- [ ] Uneven, intentional whitespace on the 8px rhythm.
- [ ] Opinionated, specific copy (no "Empower your workflow"). One bespoke detail: the
      hairline **"thread"/loom-weave divider** motif.
- [ ] Content over chrome; glass used sparingly, never glass-on-everything.
- [ ] Motion per §6; screenshot-verify each surface → "share-worthy?" → iterate.

---

## Iteration guide
Change a token here first, then let it flow to `tailwind.config.js` theme + `index.css`
CSS vars. Never hardcode a value in a component. When the audit's `fe-design`/`fe-a11y`
findings land, reconcile them against §2/§6/§7 and bump this file, not the components ad hoc.

## Known gaps (to validate)
- Gold accent (`#E0A458`) vs `warning` (`#F59E42`) share a warm hue — they live in different
  contexts (CTA vs caution toast), but verify they never sit adjacent + pass contrast in the a11y pass.
- Light-mode accent contrast on `surface` to be measured (target ≥4.5:1 for text-on-accent, ≥3:1 UI).
- Fraunces + Inter + JetBrains Mono = 3 font families to load; budget with `display=swap`,
  preconnect, and subset — keep off the LCP critical path.
