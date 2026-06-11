# Hireloom

> *heir + loom · a quiet career atelier*

[English](README.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md)

<p align="center">
  <a href="https://github.com/mysticalsin/Hireloom"><img src="docs/hero-banner.jpg" alt="Hireloom — Career Atelier · Multi-Agent Job Search System" width="800"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Codex_(soon)-6B7280?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Obsidian-7C3AED?style=flat&logo=obsidian&logoColor=white" alt="Obsidian">
  <img src="https://img.shields.io/badge/License-PolyForm_Shield-blue.svg" alt="PolyForm Shield 1.0.0">
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Hireloom Demo" width="800">
</p>

## Why this exists

Every application you send is read first by software. The hiring side has been automated for a decade; the candidate side is still a human alone with forty browser tabs and a spreadsheet.

Hireloom closes that asymmetry. It hands the candidate an AI agent of their own — one that reads job descriptions the way a sharp recruiter reads a CV: reasoning about fit, not matching keywords. You stay the decision-maker. The agent does the reading, the scoring, the tailoring, the tracking, and the remembering.

The grind it kills is the repetition: reading the two-hundredth JD, retyping the same work-authorization answers, rebuilding the same CV with slightly different keywords, updating the spreadsheet, forgetting to follow up. Hireloom automates that loop **at scale and without lying** — every CV it sends is built from your real record, tailored until it's impossible to ignore for the recruiter skimming 200 resumes *and* for the AI that grades applications before a human ever sees them. Mass application and quality aren't opposites here; the tailoring engine is what makes volume honest.

**Proof it survives contact with reality:** the engine ran one full search in AI/automation (740+ listings evaluated, 100+ tailored CVs, the target role landed), then was rebuilt and field-run a second time, end to end, in a completely different discipline. Two careers, one loom.

## The designed workflow

1. **Install and connect.** The CLI agent, Node, Playwright — plus your Gmail (the post-apply loop reads responses from it) and optionally a Kimi API key (the auto-applier's engine; see Requirements).
2. **Teach it who you are.** The onboarding wizard reads your resume and asks for the rest: target roles, comp, deal-breakers, work authorization, narrative. Your identity lives in one config file — nothing personal is hardcoded in the engine.
3. **Let the scanner loose.** `node scan.mjs` sweeps Greenhouse, Ashby, and Lever APIs directly — zero LLM tokens — using queries built from *your* targets, and saves every JD locally.
4. **The pipeline ranks itself.** Each role is scored 0–5 against your real profile: fit, gaps and whether they're learnable, comp, posting legitimacy.
5. **The tailor builds every package.** Per-JD CV + cover letter, truthful by construction — your proof points sharpened into the posting's language, never invented.
6. **You choose what goes out.** Pick roles on the dashboard or in the CLI — by hand or by score floor (default 4.0+).
7. **Dry runs before live runs.** The auto-applier fills real forms in front of you **without submitting** — `--dry-run`, as many passes as you want. Tell the agent what to fix until you're satisfied.
8. **Then it applies for you.** A clean browser with no logins or cookies (so nothing autofills stale data), one role after another, only on flows it can complete cleanly — anything uncertain is left for you instead of forced. The tracker flips to `Applied` only on a verified confirmation page; unverified submits are flagged `Submitted?` for manual check, with a screenshot for the audit trail.
9. **Non-ATS sites stay yours.** For portals the auto-applier can't drive cleanly (Indeed and friends), the assisted flow fills everything and hard-stops before Submit — the proven manual method.
10. **The loop closes itself.** Dashboard and Second Brain track applied / failed / not-yet-applied; Gmail watching catches responses, rejections, and interview invites; interview prep runs on the built-in methods (story bank, company research, mock analysis); you report outcomes and the book-keeping stays true.

## The rooms

| Room | What happens there |
|------|--------------------|
| **Evaluate** | A–F structured scoring, archetype detection, comp research, legitimacy screening — for one role or a ranked comparison of several |
| **Tailor** | Per-JD CV + cover letter PDFs (Space Grotesk / DM Sans), keyword-aware but honest — it sharpens your story, it doesn't invent one |
| **Scan** | 45+ pre-configured companies and 19 query feeds across Ashby, Greenhouse, Lever, Wellfound — token-free, API-direct |
| **Auto-apply** | The batch applier (Kimi-powered): dry runs you watch first, clean cookie-free browser, confirmation-verified tracking — runs only when you launch it |
| **Assisted apply** | For everything the auto-applier shouldn't force: fills the form, hard-stops before Submit; work-authorization answers come from your profile, never guessed |
| **Track** | One source of truth for every application, with merge, dedup, status normalization, and health checks built in |
| **Prepare** | Deep company research, a story bank that accumulates STAR+R material across evaluations, negotiation scripts, follow-up cadence |
| **Remember** | A per-user memory layer (`goodnight` / `morning`) so fresh sessions start fully briefed — no more re-explaining yourself to your own tools |
| **See it all** | A web dashboard with an onboarding wizard, a Go terminal TUI, and an optional Obsidian command center built over your live data |

## What it refuses to do

These aren't settings; they're the product's spine.

- **It never applies without your say-so.** Automation runs only when *you* launch it, on roles *you* selected, after dry runs *you* watched and approved. Outside that flow — assisted mode, outreach, follow-ups — it drafts and fills but never sends; the final click is yours.
- **It doesn't fake you.** The tailoring engine works from your CV and proof points on file. No invented metrics, no skills you don't have, no guessed work-authorization answers.
- **It doesn't force a form it can't drive cleanly.** Uncertain application flows are handed to you, not bulldozed.
- **It scores honestly.** The default floor is 4.0/5 — it will tell you when a role isn't worth a tailored package, and you can override it.

## It learns you — and survives the session ending

Out of the box, the first evaluations will be merely decent. The system improves the way a new recruiter does: by being told. *"That score's too high — I'd never relocate for that."* *"You missed that I've run greenfield supply chains."* Corrections land in your profile files immediately, and every evaluation after reads them.

What makes this durable is the **file-based memory layer**. Long AI threads rot — context fills up, summaries get summarized, details quietly fall out. Hireloom sidesteps the problem: say **`goodnight`** and the agent checkpoints who you are (`CLAUDE.local.md`), what's mid-flight (`WORKING.md`), what changed and why (`career-log.md`), and the map of your local tooling (`TOOLKIT.md`). Say **`morning`** in a brand-new session and it reloads the lot, flags anything stale, and tells you the next step.

Everything is plain, Obsidian-friendly markdown. Everything personal is gitignored. **The machinery ships with the repo; your life stays on your machine** — that split is contractual, not aspirational: see [DATA_CONTRACT.md](DATA_CONTRACT.md). System updates can replace the engine; they physically cannot touch your CV, profile, tracker, reports, or memory.

## The Second Brain (optional)

If you run [Obsidian](https://obsidian.md) — free, local, reads plain markdown folders — one sentence, *"set up my second brain,"* has your agent build a live command center over the pipeline Hireloom already maintains:

- **Pipeline** — kanban of every application by status
- **Apply Queue** — what's next, in ranked order
- **Follow-up Radar** — who's going cold, with drafted (never auto-sent) nudges
- **Interviews** — upcoming rounds and prep state
- **Scan Feed · Patterns · Inbox** — fresh postings, rejection analytics, pending URLs

Zero new data entry, and a strict no-fake-data law: every tile binds to a real file, and an empty tile names the exact command that fills it. The build interviews you only about taste — colors, rhythm, extras — because the data answers already live in your config. Everything is hosted locally by default (free Obsidian is all you need); if you have an Obsidian Sync subscription and want the vault on your other devices, just ask the agent to wire it. Spec: [second-brain/BUILD-SPEC.md](second-brain/BUILD-SPEC.md).

## Requirements — what you need before installing

Hireloom runs locally and drives an AI coding CLI. Here's exactly what to have, what it costs, and what's truly required vs. nice-to-have. *(Plan names, free-tier limits, and pricing change over time — verify the current terms at each provider before relying on them.)*

### Required

| Tool | Why it's needed | Cost / limits |
|------|-----------------|---------------|
| **An AI coding CLI — [Claude Code](https://claude.ai/code)** (or OpenCode) | This is the agent that runs *everything* — evaluation, tailoring, scanning, applying. | Needs a paid **Claude Pro or Max** subscription, **or** Anthropic **API** billing (pay-as-you-go). ⚠️ **The free Claude tier will not run Hireloom** at any real volume — **Pro is the practical floor**, and **Max is recommended** for the heavier work (batch scoring, portal scans, large tailoring runs) where token usage is high. *(Nobody tells you this up front — budget for at least Pro.)* |
| **Node.js 20+** | All the scripts, the local server, and the PDF renderers. | Free. (See `.nvmrc`.) |
| **Playwright + Chromium** — `npx playwright install chromium` | PDF generation and career-portal scraping/automation. | Free; the browser download is ~300 MB–1 GB. |
| **Gmail API credentials** | The post-apply loop: Hireloom reads your inbox to track responses, rejections, and interview invites automatically. | Free. *(Technically skippable — but then you're updating every status by hand, which defeats the design. Connect it during setup.)* |

### Optional (with a workaround) — and the benefit of adding each

| Tool | What it unlocks | If you skip it | Cost / limits |
|------|-----------------|----------------|---------------|
| **Kimi / Moonshot LLM** (via **NVIDIA NIM**) | **The auto-applier.** This is the model that drives batch form-filling and large-scale per-JD tailoring — without a key, the auto-applier does not run, and the agent will tell you so. | Everything else still works — **evaluate / tailor / scan / track run on Claude alone**, and you can apply role-by-role with the assisted flow. Possible, just not the designed path. | A Kimi API key is normally paid — **but you can get one free via [NVIDIA NIM](https://build.nvidia.com) developer testing keys, which host a usable Kimi model** (rate-limited). Great way to add the autopilot at $0. |
| **[Obsidian](https://obsidian.md)** | The **Second Brain** dashboards, plus graph view, backlinks, and search over the memory vault — your job-search context as a navigable knowledge base. | Everything is **plain markdown** — any text editor works; you just lose the dashboards and graph/linking UX. | **Free for local/personal use.** (Sync & Publish are paid add-ons you don't need — a locally-hosted vault is enough.) |
| **Go 1.21+** | The terminal **dashboard TUI** for browsing/filtering your pipeline. | Use the web dashboard or the CLI/tracker instead. | Free. |

### Minimum specs & storage

- **OS:** any modern macOS, Linux, or Windows (WSL). **8 GB RAM works.** It only gets tight if you *also* run a **Parallels/VM Windows guest** for Windows-only BI tools (e.g. Power BI Desktop) — close other apps, or use a Mac-native/cloud BI alternative (Tableau, Looker Studio).
- **Disk:** ~**2 GB free** for the repo + `node_modules` + the Chromium browser. Generated artifacts (tailored PDFs, reports) grow over a real search; the optional **interview voice-recording** feature produces large files (**1–5 GB per recording**) — prune those periodically.
- **Network:** an internet connection (the agent calls career-portal APIs and your chosen AI provider).

## Installing

Every path below lands in the same place: a local server at `http://localhost:4747` with a six-step onboarding wizard — drop your resume in, confirm what it extracted, pick target roles and comp, flag deal-breakers and work authorization, add your narrative, ship. About two minutes, and the first tailored CV renders at the end of it.

### macOS / Linux / WSL

```bash
git clone https://github.com/mysticalsin/Hireloom.git
cd Hireloom
bash install.sh                  # interactive: docker | local | doctor
```

Non-interactive variants:

```bash
bash install.sh --docker         # Docker Compose, isolates Chromium + deps
bash install.sh --local          # native Node 20+ install
bash install.sh --update         # pull + apply system updates (data untouched)
bash install.sh --doctor         # diagnose without installing
```

### Windows (PowerShell)

```powershell
git clone https://github.com/mysticalsin/Hireloom.git
cd Hireloom
.\install.ps1                    # interactive
# or: .\install.ps1 -Mode docker
```

### By hand, if you'd rather see every step

```bash
git clone https://github.com/mysticalsin/Hireloom.git
cd Hireloom
cp .env.example .env             # add ANTHROPIC_API_KEY, optional GMAIL_*
npm install
npx playwright install chromium  # required for PDF generation
npm test                         # 222 unit tests
node doctor.mjs                  # validates the whole setup, profile included
npm start                        # http://localhost:4747
```

### Extras

```bash
make            # all targets: install / docker / local / logs / backup / doctor
```

Auto-start on boot: `packaging/career-ops.service` (systemd) or `packaging/io.mysticalsin.hireloom.plist` (launchd); Docker restarts itself. Full setup guide: [docs/SETUP.md](docs/SETUP.md).

## Driving it

One slash command, many modes — or skip the command entirely and just paste a job URL; the agent recognizes it and runs the full pipeline.

```
/career-ops                → menu of everything below
/career-ops {paste a JD}   → evaluate + report + PDF + tracker, end to end
/career-ops scan           → sweep the portals for new postings
/career-ops pdf            → tailored, ATS-clean CV
/career-ops batch          → parallel evaluation with sub-agent workers
/career-ops tracker        → pipeline status at a glance
/career-ops apply          → fill the form, stop at Submit
/career-ops deep           → company research before an interview
/career-ops patterns       → what your rejections have in common
/career-ops followup       → who to nudge, and when
```

The same modes run on [OpenCode](https://opencode.ai) via `.opencode/commands/` aliases.

## Make it yours

The defaults ship tuned for AI/automation roles because that's where the engine was first proven — and **changing that is a conversation, not a config dive.** Tell your agent *"my targets are data engineering roles"* or *"rewrite the archetypes for aviation program management"* and it edits the right layer itself.

- **One identity file.** `config/profile.yml` carries your name, contact line, education, certifications, even the order your jobs render in. Every PDF renderer reads it; the engine contains no one's personal data.
- **A personalization layer updates can't touch.** Your archetypes, scoring weights, narrative, and deal-breakers live in `modes/_profile.md` and `config/profile.yml` — user layer, never overwritten.
- **Native-language evaluation modes.** German (`modes/de/`), French (`modes/fr/`), and Japanese (`modes/ja/`) modes speak the market's actual vocabulary — Kündigungsfrist, convention collective SYNTEC, 賞与 — not translated English.
- **Safe updates.** `node update-system.mjs check` fetches engine updates with your data outside the blast radius; `node doctor.mjs` confirms nothing's miswired, your profile's render block included.

## Under the hood

```
Hireloom/
├── CLAUDE.md                    # The agent's rulebook + memory machinery
├── cv.md                        # Your CV — the single source of truth (user layer)
├── config/profile.example.yml   # Identity + cv: render block template
├── lib/                         # identity, profile validation, shared engine libs
├── modes/                       # Evaluation/apply/scan modes + de/ fr/ ja/
├── second-brain/BUILD-SPEC.md   # The Obsidian command-center build spec
├── batch/                       # Parallel workers + the tailoring engine
├── dashboard/                   # Go TUI (Bubble Tea)
├── dashboard-web/               # Web dashboard + onboarding wizard
├── templates/                   # CV template, portal config, canonical states
├── tests/                       # 222 unit tests — npm test
├── data/ reports/ output/       # Yours, gitignored (user layer)
└── docs/                        # Setup, customization, architecture
```

Node (ESM) for the engine · Playwright for rendering and browsing · Go + Bubble Tea for the TUI · YAML for config · markdown and TSV for data, so every byte of your pipeline stays human-readable, diffable, and Obsidian-navigable.

## Contributing — code optional

Hireloom installs are self-improving: when your agent fixes or extends something on your machine, it logs the change, the root cause, and an upstream-worthiness flag to your `BUILD-CHANGELOG.md` (schema: [BUILD-CHANGELOG.template.md](BUILD-CHANGELOG.template.md)). **Submitting that single markdown file is a complete contribution** — reach out to us on the community Discord and share it, or open an issue with it attached; maintainers triage it with a dedicated review command and port what generalizes. PRs are welcome too: [CONTRIBUTING.md](CONTRIBUTING.md).

<a href="https://github.com/mysticalsin/Hireloom/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mysticalsin/Hireloom" />
</a>

Landed a role with Hireloom in the loop? [Tell us the story.](https://github.com/mysticalsin/Hireloom/issues/new?template=i-got-hired.yml)

## Maintainers

Hireloom is maintained by [Tony Walteur](https://www.linkedin.com/in/tonywalteur/), with major contributions — the memory system, the Second Brain, the identity layer, and the batch/apply tooling — by [Ramy Sherif](https://github.com/ramysherifwork).

More from the maintainer → [github.com/mysticalsin](https://github.com/mysticalsin)

## Star History

<a href="https://www.star-history.com/?repos=mysticalsin%2FHireloom&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=mysticalsin/Hireloom&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=mysticalsin/Hireloom&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=mysticalsin/Hireloom&type=timeline&legend=top-left" />
 </picture>
</a>

## Disclaimer

Hireloom is local, source-available software you run yourself — there is no hosted service behind it and nobody on this project can see your data. Your CV and profile travel only between your machine and the AI provider *you* configure. Automated applying runs only when you launch it, on roles you approved after watching the dry runs — and you are the operator: review what the AI generates before it goes out under your name, stay within the Terms of Service of every portal you touch, and treat evaluations as informed opinions, not promises — language models can be wrong about you and about the job. Full text: [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md). Provided "as is", without warranty, under the [PolyForm Shield 1.0.0 license](LICENSE).

## License

PolyForm Shield 1.0.0 — free to use, copy, modify, and distribute, including commercially, for any purpose **except providing a product that competes with Hireloom**. Licensing and copyright notices must be preserved. Inherited portions of the original engine retain their MIT notice — see the Third-party notices section in [LICENSE](LICENSE). Versions released before this change remain MIT.

> **Note:** this license applies to this branch's build and takes effect for the project upon maintainer merge; `main` remains MIT until then.
