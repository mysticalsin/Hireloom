# Contributing to Hireloom

Thanks for your interest in contributing! Hireloom is built with Claude Code — and the easiest way to contribute doesn't require opening a PR at all.

## The Hireloom way: submit your build changelog (recommended)

Hireloom ships with a built-in contribution recorder. As you customize and improve your own install — fix a bug, add a portal parser, sharpen a mode, harden a script — your AI agent automatically records every project-affecting change in **`BUILD-CHANGELOG.md`** (created on first change from `templates/BUILD-CHANGELOG.template.md`). Each entry carries the same schema:

- **Layer:** system or user
- **Files:** what was touched
- **Change:** what was done
- **Root cause:** the WHY behind it
- **Upstream:** yes/no — should everyone get this?
- **Reproduce:** (optional) how to see the problem it fixed

**To contribute, send us that one markdown file.** No fork, no PR, no need to understand the rest of the codebase:

1. Post your `BUILD-CHANGELOG.md` in the [Discord](https://discord.gg/3jEjwygjNG), or attach it to a GitHub issue.
2. A maintainer ingests it with the built-in `/review-contribution` skill — it maps your entries onto the repo, assesses each `Upstream: yes` entry, and turns the good ones into upstream changes, credited to you.
3. That's it. Your improvements reach everyone without you ever leaving your own install.

**Keep personal data out of it.** Your CV, profile, preferences, and tracker are user-layer — they belong in your own files, never in the upstream-bound changelog.

## The classic way: pull requests

PRs are welcome too, especially from contributors comfortable in the codebase:

1. Fork the repo and create a branch (`git checkout -b fix/my-fix`)
2. Make your changes; test with a fresh clone (see [docs/SETUP.md](../docs/SETUP.md))
3. Run the suite: `npm test` (unit tests) and `node engine/test-all.mjs` (system checks)
4. Open a Pull Request with a clear description of what changed and **why**

CI runs the full check suite on every PR (tests, CodeQL, secret scan, install smoke-tests on three platforms). Status checks must pass before merge.

**Good first contributions:**
- Add companies to `templates/portals.example.yml`
- Translate modes to other languages
- Improve documentation
- Add example CVs for different roles (in `docs/examples/`)
- Report bugs via [Issues](https://github.com/mysticalsin/Hireloom/issues)

**Bigger contributions:**
- New evaluation dimensions or scoring logic
- Dashboard features (`apps/web/`, `apps/tui/`)
- New skill modes (in `modes/`)
- Engine improvements (`engine/*.mjs`)

## Guidelines

- Keep modes language-agnostic when possible
- Scripts should handle missing files gracefully (check `existsSync` before `readFileSync`)
- TUI dashboard changes require `go build` (in `apps/tui/`) — test with real data before submitting
- Don't commit personal data (cv.md, profile.yml, applications.md, reports/)

## What we do NOT accept

- **PRs that scrape platforms prohibiting automated access** (LinkedIn, etc.). We actively reject these to respect third-party ToS.
- **PRs that remove the auto-applier's consent gates** — role selection, watched dry runs, confirmation-verified tracking, the pause-and-hand-to-user rule for flows it can't drive cleanly. Hireloom automates applying; it must never automate carelessness.
- **PRs that add external API dependencies** without prior discussion.
- **PRs containing personal data** (real CVs, emails, phone numbers). Use `docs/examples/` with fictional data instead.

## Development

```bash
npm test                                     # 222 unit tests
node engine/doctor.mjs                       # Setup validation
node engine/tracker/verify-pipeline.mjs      # Pipeline health check

# TUI dashboard
cd apps/tui && go build -o hireloom-tui . && ./hireloom-tui --path ../..
```

## License and Brand

The source code is governed by the [PolyForm Shield 1.0.0 LICENSE](../LICENSE)
(third-party MIT notices retained in the fine print). The **Hireloom** name and
brand are governed by [docs/TRADEMARK.md](../docs/TRADEMARK.md). If you fork the
project within the license terms, please give it your own product name and follow
the trademark policy regarding naming and endorsement claims.

## Need Help?

- [Join the Discord](https://discord.gg/3jEjwygjNG) — fastest way to get answers, share your build changelog, and connect with other contributors
- [Open an issue](https://github.com/mysticalsin/Hireloom/issues)
- [Read the architecture docs](../docs/ARCHITECTURE.md)
