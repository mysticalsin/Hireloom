# Hireloom

> *heir + loom · a quiet career atelier*

[English](README.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [Русский](README.ru.md)

<p align="center">
  <a href="https://github.com/mysticalsin"><img src="docs/hero-banner.jpg" alt="Hireloom — Career Atelier · Multi-Agent Job Search System" width="800"></a>
</p>

<p align="center">
  <em>Companies use AI to filter candidates. Hireloom gives candidates AI to <strong>choose</strong> companies.</em><br>
  Heritage-grade UX, oxblood palette, set-in-lead serif wordmark — and the ruthless senior-level
  evaluation engine underneath. The atelier weaves; you decide.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Codex_(soon)-6B7280?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/License-PolyForm_Shield-blue.svg" alt="PolyForm Shield 1.0.0">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord"></a>
  <br>
  <img src="https://img.shields.io/badge/EN-blue?style=flat" alt="EN">
  <img src="https://img.shields.io/badge/ES-red?style=flat" alt="ES">
  <img src="https://img.shields.io/badge/DE-grey?style=flat" alt="DE">
  <img src="https://img.shields.io/badge/FR-blue?style=flat" alt="FR">
  <img src="https://img.shields.io/badge/PT--BR-green?style=flat" alt="PT-BR">
  <img src="https://img.shields.io/badge/KO-white?style=flat" alt="KO">
  <img src="https://img.shields.io/badge/JA-red?style=flat" alt="JA">
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Hireloom Demo" width="800">
</p>

<p align="center"><strong>740+ job listings evaluated · 100+ personalized CVs · 1 dream role landed</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a></p>

## What Is This

Hireloom turns any AI coding CLI into a full career atelier. Instead of manually tracking applications in a spreadsheet, you get an AI-powered pipeline that:

- **Evaluates offers** with a structured A-F scoring system (10 weighted dimensions)
- **Generates tailored PDFs** -- ATS-optimized CVs customized per job description
- **Scans portals** automatically (Greenhouse, Ashby, Lever, company pages)
- **Processes in batch** -- evaluate 10+ offers in parallel with sub-agents
- **Tracks everything** in a single source of truth with integrity checks

> **Important: This is NOT a spray-and-pray tool.** Hireloom is a filter -- it helps you find the few offers worth your time out of hundreds. The system strongly recommends against applying to anything scoring below 4.0/5. Your time is valuable, and so is the recruiter's. Always review before submitting.

Hireloom is agentic: Claude Code navigates career pages with Playwright, evaluates fit by reasoning about your CV vs the job description (not keyword matching), and adapts your resume per listing.

> **Heads up: the first evaluations won't be great.** The system doesn't know you yet. Feed it context -- your CV, your career story, your proof points, your preferences, what you're good at, what you want to avoid. The more you nurture it, the better it gets. Think of it as onboarding a new recruiter: the first week they need to learn about you, then they become invaluable.

Built by someone who used it to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-Pipeline** | Paste a URL, get a full evaluation + PDF + tracker entry |
| **6-Block Evaluation** | Role summary, CV match, level strategy, comp research, personalization, interview prep (STAR+R) |
| **Interview Story Bank** | Accumulates STAR+Reflection stories across evaluations -- 5-10 master stories that answer any behavioral question |
| **Negotiation Scripts** | Salary negotiation frameworks, geographic discount pushback, competing offer leverage |
| **ATS PDF Generation** | Keyword-injected CVs with Space Grotesk + DM Sans design |
| **Portal Scanner** | 45+ companies pre-configured (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + custom queries across Ashby, Greenhouse, Lever, Wellfound |
| **Batch Processing** | Parallel evaluation with `claude -p` workers |
| **Dashboard TUI** | Terminal UI to browse, filter, and sort your pipeline |
| **Human-in-the-Loop** | AI evaluates and recommends, you decide and act. The system never submits an application -- you always have the final call |
| **Pipeline Integrity** | Automated merge, dedup, status normalization, health checks |
| **Second Brain (optional)** | Say "set up my second brain" and your agent builds live dashboards over your pipeline inside [Obsidian](https://obsidian.md) (free) — what's hot, who's going cold, what's next. No new data entry; it visualizes what Hireloom already tracks. See `second-brain/`. |

## Requirements — what you need before installing

Hireloom runs locally and drives an AI coding CLI. Here's exactly what to have, what it costs, and what's truly required vs. nice-to-have. *(Plan names, free-tier limits, and pricing change over time — verify the current terms at each provider before relying on them.)*

### Required

| Tool | Why it's needed | Cost / limits |
|------|-----------------|---------------|
| **An AI coding CLI — [Claude Code](https://claude.ai/code)** (or OpenCode) | This is the agent that runs *everything* — evaluation, tailoring, scanning, applying. | Needs a paid **Claude Pro or Max** subscription, **or** Anthropic **API** billing (pay-as-you-go). ⚠️ **The free Claude tier will not run Hireloom** at any real volume — **Pro is the practical floor**, and **Max is recommended** for the heavier work (batch scoring, portal scans, large tailoring runs) where token usage is high. *(Nobody tells you this up front — budget for at least Pro.)* |
| **Node.js 20+** | All the scripts, the local server, and the PDF renderers. | Free. (See `.nvmrc`.) |
| **Playwright + Chromium** — `npx playwright install chromium` | PDF generation and career-portal scraping/automation. | Free; the browser download is ~300 MB–1 GB. |

### Optional (with a workaround) — and the benefit of adding each

| Tool | What it unlocks | If you skip it | Cost / limits |
|------|-----------------|----------------|---------------|
| **Kimi / Moonshot LLM** (via **NVIDIA NIM**) | The batch **smart-fill autopilot** and large-scale per-JD résumé/cover tailoring — lets you process many roles fast. | Core **evaluate / tailor / scan still work on Claude alone**; you just do high-volume tailoring and form-filling more manually. | A Kimi API key is normally paid — **but you can get one free via [NVIDIA NIM](https://build.nvidia.com) developer testing keys, which host a usable Kimi model** (rate-limited). Great way to add the autopilot at $0. |
| **[Obsidian](https://obsidian.md)** | Read/edit the memory vault (`CLAUDE.md`, `WORKING.md`, `career-log.md`, `TOOLKIT.md`) with graph view, backlinks, and search — turns your job-search context into a navigable knowledge base. | Everything is **plain markdown** — any text editor works; you just lose the graph/linking UX. | **Free for local/personal use.** (Sync & Publish are paid add-ons you don't need — a locally-hosted vault is enough.) |
| **Go 1.21+** | The terminal **dashboard TUI** for browsing/filtering your pipeline. | Use the web dashboard or the CLI/tracker instead. | Free. |
| **Gmail API credentials** | Email-cache / inbox features. | Skip entirely; not needed for the core flow. | Free. |

### Minimum specs & storage

- **OS:** any modern macOS, Linux, or Windows (WSL). **8 GB RAM works.** It only gets tight if you *also* run a **Parallels/VM Windows guest** for Windows-only BI tools (e.g. Power BI Desktop) — close other apps, or use a Mac-native/cloud BI alternative (Tableau, Looker Studio).
- **Disk:** ~**2 GB free** for the repo + `node_modules` + the Chromium browser. Generated artifacts (tailored PDFs, reports) grow over a real search; the optional **interview voice-recording** feature produces large files (**1–5 GB per recording**) — prune those periodically.
- **Network:** an internet connection (the agent calls career-portal APIs and your chosen AI provider).

## Install in 60 seconds

Pick the path that matches your machine — both end on the **same 6-step onboarding wizard** at `http://localhost:4747`: drop your resume → AI confirms basics → pick target roles + comp → flag deal-breakers → narrative → ship.

### macOS / Linux / WSL

```bash
git clone https://github.com/mysticalsin/Hireloom.git
cd career-ops
bash install.sh                  # interactive: docker | local | doctor
```

Or skip the prompt:

```bash
bash install.sh --docker         # Docker Compose, isolates Chromium + deps
bash install.sh --local          # native Node 20+ install
bash install.sh --update         # pull + apply system updates (data untouched)
bash install.sh --doctor         # diagnose without installing
```

### Windows (PowerShell)

```powershell
git clone https://github.com/mysticalsin/Hireloom.git
cd career-ops
.\install.ps1                    # interactive
# or: .\install.ps1 -Mode docker
```

### Make targets (macOS / Linux)

```bash
make            # show all targets
make install    # interactive
make docker     # docker compose up -d
make docker-prod # adds the hardened production overlay
make local      # npm install + tests + start
make logs       # tail the docker logs
make backup     # snapshot user data to ./backups/<timestamp>/
make doctor     # environment diagnostic
```

### One-line bootstrap

```bash
curl -fsSL https://raw.githubusercontent.com/mysticalsin/Hireloom/main/install.sh | bash
```

> **What happens on first launch:** Open the URL the installer prints, click **⊕ Profile** (or press `⌘ ,`), drop your resume in. The wizard reads it, asks the few things it can't infer (target roles, comp, deal-breakers, narrative), then renders your tailored CV PDF and arms the pipeline. ~2 min, end-to-end.

### Auto-start on boot (optional)

- **Linux** — `sudo cp packaging/career-ops.service /etc/systemd/system/ && sudo systemctl enable --now career-ops`
- **macOS** — `cp packaging/io.mysticalsin.hireloom.plist ~/Library/LaunchAgents/ && launchctl load -w ~/Library/LaunchAgents/io.mysticalsin.hireloom.plist` (edit the user/path placeholders first)
- **Docker** — already restarts unless stopped (`restart: unless-stopped`)

See [docs/SETUP.md](docs/SETUP.md) for the full setup guide and customization options.

## Manual install (if you want to skip the script)

```bash
git clone https://github.com/mysticalsin/Hireloom.git
cd career-ops
cp .env.example .env             # add ANTHROPIC_API_KEY, optional GMAIL_*
npm install
npx playwright install chromium  # required for PDF generation
npm test                         # 116 unit tests, ~150ms
npm start                        # http://localhost:4747
```

> **The system is designed to be customized by Claude itself.** Modes, archetypes, scoring weights, negotiation scripts — just ask Claude to change them. It reads the same files it uses, so it knows exactly what to edit.

## Usage

Career-ops is a single slash command with multiple modes:

```
/career-ops                → Show all available commands
/career-ops {paste a JD}   → Full auto-pipeline (evaluate + PDF + tracker)
/career-ops scan           → Scan portals for new offers
/career-ops pdf            → Generate ATS-optimized CV
/career-ops batch          → Batch evaluate multiple offers
/career-ops tracker        → View application status
/career-ops apply          → Fill application forms with AI
/career-ops pipeline       → Process pending URLs
/career-ops contacto       → LinkedIn outreach message
/career-ops deep           → Deep company research
/career-ops training       → Evaluate a course/cert
/career-ops project        → Evaluate a portfolio project
```

Or just paste a job URL or description directly -- career-ops auto-detects it and runs the full pipeline.

## How It Works

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-F Evaluation  │  Match, gaps, comp research, STAR stories
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf   .tsv
```

## Pre-configured Portals

The scanner comes with **45+ companies** ready to scan and **19 search queries** across major job boards. Copy `templates/portals.example.yml` to `portals.yml` and add your own:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automation:** n8n, Zapier, Make.com
**European:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Job boards searched:** Ashby, Greenhouse, Lever, Wellfound, Workable, RemoteFront

## Dashboard TUI

The built-in terminal dashboard lets you browse your pipeline visually:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

Features: 6 filter tabs, 4 sort modes, grouped/flat view, lazy-loaded previews, inline status changes.

## Project Structure

```
career-ops/
├── CLAUDE.md                    # Agent instructions
├── cv.md                        # Your CV (create this)
├── article-digest.md            # Your proof points (optional)
├── config/
│   └── profile.example.yml      # Template for your profile
├── modes/                       # 14 skill modes
│   ├── _shared.md               # Shared context (customize this)
│   ├── oferta.md                # Single evaluation
│   ├── pdf.md                   # PDF generation
│   ├── scan.md                  # Portal scanner
│   ├── batch.md                 # Batch processing
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Orchestrator script
├── dashboard/                   # Go TUI pipeline viewer
├── data/                        # Your tracking data (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, architecture
└── examples/                    # Sample CV, report, proof points
```

## Tech Stack

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agent**: Claude Code with custom skills and modes
- **PDF**: Playwright/Puppeteer + HTML template
- **Scanner**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin Mocha theme)
- **Data**: Markdown tables + YAML config + TSV batch files

## About the Author

Hireloom is maintained by [Tony Walteur](https://www.linkedin.com/in/tonywalteur/).

My portfolio and other open source projects → [github.com/mysticalsin](https://github.com/mysticalsin)


## Star History

<a href="https://www.star-history.com/?repos=mysticalsin%2FHireloom&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=mysticalsin/Hireloom&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=mysticalsin/Hireloom&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=mysticalsin/Hireloom&type=timeline&legend=top-left" />
 </picture>
</a>

## Disclaimer

**career-ops is a local, open-source tool — NOT a hosted service.** By using this software, you acknowledge:

1. **You control your data.** Your CV, contact info, and personal data stay on your machine and are sent directly to the AI provider you choose (Anthropic, OpenAI, etc.). We do not collect, store, or have access to any of your data.
2. **You control the AI.** The default prompts instruct the AI not to auto-submit applications, but AI models can behave unpredictably. If you modify the prompts or use different models, you do so at your own risk. **Always review AI-generated content for accuracy before submitting.**
3. **You comply with third-party ToS.** You must use this tool in accordance with the Terms of Service of the career portals you interact with (Greenhouse, Lever, Workday, LinkedIn, etc.). Do not use this tool to spam employers or overwhelm ATS systems.
4. **No guarantees.** Evaluations are recommendations, not truth. AI models may hallucinate skills or experience. The authors are not liable for employment outcomes, rejected applications, account restrictions, or any other consequences.

See [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) for full details. This software is provided under the [MIT License](LICENSE) "as is", without warranty of any kind.

## Contributors

<a href="https://github.com/mysticalsin/Hireloom/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mysticalsin/Hireloom" />
</a>

Got hired using career-ops? [Share your story!](https://github.com/mysticalsin/Hireloom/issues/new?template=i-got-hired.yml)

## License

PolyForm Shield 1.0.0 — free to use, copy, modify, and distribute, including commercially, for any purpose **except providing a product that competes with Hireloom**. Licensing and copyright notices must be preserved. Inherited portions of the original engine retain their MIT notice — see the Third-party notices section in [LICENSE](LICENSE). Versions released before this change remain MIT.

> **Note:** this license applies to this branch's build and takes effect for the project upon maintainer merge; `main` remains MIT until then.

## Let's Connect

[![Website](https://img.shields.io/badge/github.com/mysticalsin-000?style=for-the-badge&logo=safari&logoColor=white)](https://github.com/mysticalsin)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://github.com/mysticalsin)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://github.com/mysticalsin)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:github.com/mysticalsin (GitHub))
