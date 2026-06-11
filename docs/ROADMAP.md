# Career-Ops — Product Roadmap

> Goal: a Mac/Windows/Linux desktop app that turns "I have a resume" into "I have offers" with the least friction possible.
> The pipeline is built. The work ahead is making it easy enough that anyone can pick it up in 5 minutes and let it run.

---

## Phase 1 — Onboarding wizard (✅ shipped on `security/critical-hardening` branch)

The single biggest barrier to adoption was a one-shot text dump that asked nothing. Replaced with a 6-step wizard that gets people to a fully-armed pipeline in under 3 minutes:

1. **Resume** — drop a `.txt`/`.md` or paste text. Auto-extract name, email, phone, LinkedIn, location, headline.
2. **Confirm basics** — every extracted field is editable; one-line headline prompt.
3. **Target roles + comp** — multi-select chips of common archetypes (Chief of Staff, Head of AI, Director PS, Engineering Manager, etc.) plus free-text additions; comp target range, walk-away minimum, currency, location preference.
4. **Deal-breakers** — multi-select chips ("No relocation", "No on-call", "No commission-only", etc.) so the pipeline auto-skips bad fits.
5. **Narrative** — three superpowers, one best-achievement (STAR-style), proof points (name + URL + hero metric, repeatable).
6. **Review & generate** — summary card, single "Generate My Pipeline" CTA that writes `config/profile.yml` (with backup snapshot of any prior version) and kicks off CV PDF generation in the background.

**Aesthetic:** liquid-glass modal (translucent, backdrop blur 40px + saturate 180%, prismatic conic-gradient ring), prismatic step indicator (active step gets a multi-hue gradient with iridescent glow), liquid-metal primary CTA with a sweeping shimmer on hover. Restrained — Apple HIG, not gaudy.

**Safety:** every overwrite of `profile.yml` snapshots the prior file to `profile.yml.bak.{ISO-timestamp}`. The path is configurable via `CONFIG_DIR` env so smoke tests run against a tmp dir, not live data.

---

## Phase 2 — Desktop wrapper (Tauri preferred over Electron)

**Why Tauri:** ~10MB binary vs Electron's ~80MB; native webview (WebView2 on Windows, WKWebView on macOS) so no Chromium bundled; signed properly with platform-native code-signing flows.

**Deliverables:**
- `tauri.conf.json` configured with the dashboard's `localhost:4747` as the loaded URL OR bundle the Node server as a sidecar process Tauri spawns at startup.
- App icon set (1024×1024 source → `.icns`/`.ico`/`.png` derivatives).
- "First-run" splash that ensures Node + Playwright are installed; offers to install them if not.
- System-tray icon with show/hide/quit + a "Pipeline running" indicator.
- Auto-start on login (opt-in toggle in Settings).
- Single-window mode with the dashboard taking the full window — no browser chrome.

**Open question:** sidecar Node process vs Bun-bundled binary. Bun's `bun build --compile` produces a single executable that includes the Node-compatible runtime, which sidesteps the "user must have Node installed" problem entirely. Trade-off: Bun has less mature Playwright support.

**Estimate:** 2 sessions.

---

## Phase 3 — Open-source code signing strategy

The realistic plan for a project with no commercial signing budget:

| Platform | Strategy | What user sees |
|---|---|---|
| **Linux** (deb/rpm/AppImage) | Sign with Sigstore/cosign — keyless, GitHub OIDC-backed. Already industry-standard for OSS. | `cosign verify` works; AppImage launches normally. |
| **macOS** | Ad-hoc sign + notarization waiver via `xattr -d com.apple.quarantine` instructions in README. Optional: Apple Developer ID if a sponsor steps up. | First launch: right-click → Open. |
| **Windows** | Self-signed via PowerShell `New-SelfSignedCertificate` for the source. Document the SmartScreen warning + "More info → Run anyway" flow. Optional: Azure Trusted Signing (~$10/mo) if user opts in. | First launch: SmartScreen warning, one-click bypass. |

**Why not buy an EV cert:** $250-400/yr for the cert + USB token + private-key-handling friction. Not justified for a personal-use OSS tool. Document the workarounds clearly so users don't bounce off the warning.

**Deliverables:**
- `cosign.pub` checked into repo for Linux verification.
- `.github/SECURITY.md` updated with the signing+verification flow per platform.
- `scripts/sign-release.{sh,ps1}` automated for each platform.

**Estimate:** 1 session.

---

## Phase 4 — Release pipeline (GitHub Actions)

- Workflow on tag push: build for macOS-arm64, macOS-x64, Linux-x64, Windows-x64.
- `cargo tauri build --target ${{ matrix.target }}` per OS runner.
- Sign with the Phase 3 strategy.
- Upload artifacts to a GitHub Release with auto-generated changelog from conventional commits.
- Auto-update endpoint: `tauri-plugin-updater` pointing at the GitHub Release manifest.

**Estimate:** 1 session.

---

## Phase 5 — Onboarding polish (post-wizard UX)

The wizard gets people in. These bits make them stay:

- **Empty-state coaching** — when the dashboard first loads with zero applications, render an animated walkthrough (spotlight + tooltip) pointing at "Scan portals" → "Open inbox" → "Apply autopilot."
- **Progressive disclosure** — keep the dashboard minimal for the first 24 hours, then progressively reveal advanced panels (batch ops, Gmail signals) as the user accumulates state.
- **Inline help** — hover any badge/metric → tooltip explaining what it means in plain English ("Why is this score 4.2?" → "Match on archetype + comp range + 3 of your superpowers").
- **Onboarding checklist** — a persistent floating panel showing 5 steps to "fully armed" status; checks off automatically as the user completes them.
- **First-success celebration** — when the first application gets a "Responded" status, fire confetti + a card explaining what to do next ("Schedule the interview, then prep with `/career-ops interview-prep`").

**Estimate:** 1 session.

---

## Phase 6 — Marketing surface (public-facing)

When the app exists as a downloadable, it needs a landing page:

- Single-page site: hero, 3-step demo video (record yourself doing the wizard), comparison table (Career-Ops vs Indeed Easy Apply vs LinkedIn Premium), open-source CTA (GitHub + cosign verify), download buttons per OS.
- Aesthetic match: liquid-glass + prismatic, same as the wizard. Hero gradient = the same conic-gradient on the wizard's modal ring.
- Self-host on the user's domain or default to GitHub Pages.
- SEO: title "Career-Ops — Your AI hiring agent. Open source.", description focused on "hire-yourself" angle, OG image generated from the wizard screenshot.
- Newsletter capture for releases (no email harvesting beyond that).

**Estimate:** 1 session.

---

## Phase 7 — Observability & resilience

- Local-only telemetry: counts of applications, scan cycles, autopilot runs, errors. Stored in `data/telemetry.jsonl`. NEVER sent off-machine.
- Error reporting: opt-in only, scrubs PII before send. Sentry self-hosted or a minimal POST-to-localhost-receiver.
- Backup: nightly `git`-style snapshot of `data/` to a user-configurable path (Dropbox/iCloud/local). Recovery one-liner.
- Health check page in the dashboard: "Last scan: 2h ago, last apply: 14m ago, autopilot status: idle". Click to expand details.

**Estimate:** 1 session.

---

## Phase 8 — Cross-language support polish

The system already has `modes/de/`, `modes/fr/`, `modes/ja/`. The wizard should:

- Auto-detect resume language and offer to switch modes during step 2.
- Localize the wizard UI (labels, placeholders) per detected language.
- Translate `target_roles` chip presets per language (the German preset list shouldn't include "Chief of Staff" — should include "Geschäftsführerassistenz", etc.).

**Estimate:** 1 session.

---

## What's explicitly NOT on the roadmap

- **Mobile app.** The whole pipeline depends on Playwright + a real desktop browser session; mobile is a category mismatch.
- **SaaS hosting.** Every user's data is sensitive (resume, comp ask, salary expectations, deal-breakers). The local-first design is the entire trust model.
- **AI-generated cover letters in batch without human review.** The system explicitly stops before submit. Removing that guardrail invites mass-spam abuse.
- **Job-board scraping at scale.** Career-Ops uses public ATS APIs (Greenhouse, Ashby, Lever) — by design, not by accident. Anything that would put us in scraping-cat-and-mouse territory is out.

---

## Sequencing

```
Phase 1 ✅ → Phase 5 (UX polish, validates the wizard pays off)
              ↓
              Phase 2 (Tauri wrap)
              ↓
              Phase 3 (signing) ← Phase 4 (release pipeline)
                                  ↓
                                  Phase 6 (marketing)
                                  ↓
                                  Phase 7 (resilience)
                                  ↓
                                  Phase 8 (i18n polish)
```

Ship Phase 5 next — it's the cheapest way to validate that the wizard actually moves the conversion needle before we spend a session on Tauri.
