# Deployment Guide

This document covers every supported way to run Hireloom — from a single-user
local install to a hardened, supervised, production setup. Pick the section
that matches your situation.

> **Hireloom is local-first by design.** Your CV, applications, and Gmail
> tokens never leave your machine. The dashboard binds to `127.0.0.1` by
> default and refuses to expose itself to the LAN unless you explicitly
> opt in. Most users should run it on their laptop and stop reading after
> Section 1.

---

## 1 · Single-user local install (recommended for 95% of users)

### Prerequisites

- **Node.js ≥ 20** ([download](https://nodejs.org/))
- **Git** (for clone + auto-update)
- **Chromium for Playwright** (auto-installed by `npm install`; ~140 MB)

### Install

```bash
git clone https://github.com/mysticalsin/Hireloom.git hireloom
cd hireloom
npm install                # installs deps + Playwright Chromium
npx playwright install chromium  # if Playwright didn't auto-install
```

### Run

```bash
npm start
# → Hireloom Atelier → http://127.0.0.1:4747  (bound to 127.0.0.1)
```

Open `http://127.0.0.1:4747` in your browser. The first thing you'll see is
the onboarding wizard — drop your CV, fill the basics, and you're ready.

### Stop / restart

`Ctrl+C` in the terminal. Restart with `npm start`. State is persisted to
`config/profile.yml`, `data/applications.md`, and `reports/*.md`.

### Update

```bash
npm run update:check   # see if a new version is available
npm run update         # apply the update (your data is preserved)
npm run rollback       # roll back the last update
```

---

## 2 · Run on boot (macOS launchd / Linux systemd / Windows)

You probably want Hireloom to come up when you log in so it's silently
polling Gmail, scanning portals, and waiting for you to paste a JD.

### Linux / WSL2 — systemd

A unit file ships at `scripts/packaging/career-ops.service`. Copy + edit it:

```bash
sudo cp scripts/packaging/career-ops.service /etc/systemd/system/hireloom.service
sudoedit /etc/systemd/system/hireloom.service
# Update User=, Group=, WorkingDirectory= to match your install
sudo systemctl daemon-reload
sudo systemctl enable --now hireloom
# Watch the logs
journalctl -u hireloom -f
```

The unit ships with hardening defaults (`ProtectSystem=strict`,
`PrivateTmp=true`, restricted address families) and a 1.5 GB memory cap.

### macOS — launchd

```bash
# Save the plist somewhere visible
cp scripts/packaging/com.hireloom.atelier.plist ~/Library/LaunchAgents/
# Edit the WorkingDirectory + ProgramArguments paths to match your install
$EDITOR ~/Library/LaunchAgents/com.hireloom.atelier.plist
launchctl load ~/Library/LaunchAgents/com.hireloom.atelier.plist
# Watch logs
tail -f ~/Library/Logs/hireloom.log
```

> The launchd plist isn't shipped yet — copy + adapt the systemd template.
> See `scripts/packaging/career-ops.service` as the reference.

### Windows — Task Scheduler

Create a Scheduled Task with trigger `At log on`, action `node
"C:\path\to\hireloom\apps\web\server.mjs"`. Set "Run whether user is
logged on or not" to off (you want it to share your session).

---

## 3 · Self-hosted on your LAN (multiple devices)

If you want to use Hireloom from your phone while it runs on a NAS / spare
box:

### Bind to LAN

```bash
HOST=0.0.0.0 PORT=4747 npm start
```

### Set up an auth token

When `HOST` is anything other than `127.0.0.1`, the server requires bearer
auth on every endpoint except `/api/health`:

```bash
# Generate a 32-byte token
AUTH_TOKEN=$(openssl rand -hex 32) HOST=0.0.0.0 PORT=4747 npm start
```

Now open `http://<your-lan-ip>:4747/?token=<the-token>` from your phone.
The token is read from the `?token=` query param OR the
`Authorization: Bearer <token>` header on every request — so save the
URL with the token, or use a browser extension that injects the
Authorization header. There is currently no cookie-based session.

### Put it behind a reverse proxy with TLS

If you must expose Hireloom beyond your LAN (you probably shouldn't),
front it with Caddy or nginx for TLS:

```caddy
# Caddyfile
hireloom.example.com {
    reverse_proxy 127.0.0.1:4747
    encode gzip
    header X-Real-IP {remote_host}
}
```

Caddy auto-provisions Let's Encrypt certificates. Set
`AUTH_TOKEN` and use a strong passphrase — Hireloom is not designed
for the public internet.

---

## 4 · Docker

A `Dockerfile` and two compose files ship at the repo root:

- `docker-compose.yaml` — minimal local run
- `docker-compose.hardened.yml` — read-only root FS, dropped capabilities

```bash
# Hardened production-ish run
docker compose -f docker-compose.hardened.yml up -d
docker compose logs -f hireloom
```

Mount your config + data dirs as volumes so they survive container rebuilds:

```yaml
services:
  hireloom:
    volumes:
      - ./config:/app/config
      - ./data:/app/data
      - ./reports:/app/reports
      - ./output:/app/output
```

---

## 5 · Environment variables

| Variable                | Default                 | Purpose                                          |
|-------------------------|-------------------------|--------------------------------------------------|
| `PORT`                  | `4747`                  | TCP port to bind                                 |
| `HOST`                  | `127.0.0.1`             | Bind address (`0.0.0.0` = LAN; requires auth)    |
| `CONFIG_DIR`            | `<repo>/config`         | Where `profile.yml` is written                   |
| `DATA_DIR`              | `<repo>/data`           | Trackers, gmail tokens, error log                |
| `REPORTS_DIR`           | `<repo>/reports`        | Evaluation reports                               |
| `GMAIL_CLIENT_ID`       | (unset)                 | Google OAuth client ID                           |
| `GMAIL_CLIENT_SECRET`   | (unset)                 | Google OAuth client secret                       |
| `GMAIL_REDIRECT_URI`    | `http://localhost:$PORT/auth/gmail/callback` | OAuth redirect target            |
| `AUTH_TOKEN`   | (unset)                 | Bearer token required when `HOST` is non-loopback |
| `RATE_GET_PER_MIN`      | `60`                    | Per-IP GET request budget                        |
| `RATE_POST_PER_MIN`     | `10`                    | Per-IP mutating request budget                   |

Drop them in a `.env` file at the repo root — the server reads it at boot
when Node ≥ 20 detects `--env-file=.env` (or use `dotenv`).

---

## 6 · Observability

### Health probe

`GET /api/health` returns:

```json
{
  "ok": true,
  "app": "Hireloom",
  "version": "1.8.0",
  "uptime": 3621,
  "now": "2026-05-08T00:00:00.000Z",
  "lastUnhandledRejection": null,
  "lastUnhandledRejectionAgoMs": null,
  "errorCounters": { "unhandledRejection": 0, "uncaughtException": 0, "routeError": 0 },
  "recentErrors": [],
  "authMode": "loopback"
}
```

Wire it to Uptime Kuma, Pingdom, or `curl --fail` in a monit script. The
`errorCounters` deltas are the right thing to alert on — they grow
monotonically until restart.

### Error log

A rotating JSON-lines log lives at `data/errors.log`:

```bash
tail -f data/errors.log | jq
```

Each entry has `t`, `iso`, `level`, `kind`, `message`, and optional
`stack`/`tag`/`ctx`. The file rotates to `errors.log.1` at 2 MiB.

---

## 7 · Backups

What to back up:

```
config/profile.yml         # your wizard answers (only one — the .bak.* files are auto-rotated)
data/applications.md       # tracker
data/pipeline.md           # inbox of pending URLs
data/scan-history.tsv      # scanner dedup history
data/gmail-tokens.json     # OAuth tokens (regeneratable but tedious)
reports/*.md               # all evaluation reports
output/*.pdf               # generated CVs
interview-prep/*.md        # STAR+R story bank
```

A simple cron entry on your machine handles it:

```cron
0 3 * * * tar -czf ~/backups/hireloom-$(date +\%F).tar.gz -C ~/hireloom config data reports output interview-prep
```

The wizard automatically snapshots `profile.yml` to
`profile.yml.bak.{timestamp}` before overwriting. The 10 most recent are
kept.

---

## 8 · Troubleshooting

| Symptom                                       | Diagnosis                                        | Fix                                                  |
|-----------------------------------------------|--------------------------------------------------|------------------------------------------------------|
| `EADDRINUSE: 4747`                            | Stale server already running                     | `lsof -ti:4747 \| xargs kill`  (Mac/Linux)           |
| Gmail status stays "not configured"           | Missing `GMAIL_CLIENT_ID` / secret in env        | See `docs/gmail-setup.md`                            |
| Wizard says "PDF generation failed"           | Playwright Chromium not installed                | `npx playwright install chromium`                    |
| Browser hangs on first load                   | Google Fonts blocked / offline                   | Disable network, fonts have a fallback chain         |
| `EROFS` on `/api/onboard/finalize`            | Read-only filesystem (Docker/WSL)                | Mount `config/` as RW or set `CONFIG_DIR` to `/tmp`  |
| Rate limit firing on legitimate use           | Default budget too tight for power users         | Bump `RATE_GET_PER_MIN=600 RATE_POST_PER_MIN=120`    |

For anything else, run `npm run doctor` — it prints a JSON diagnostic that
covers Node version, Playwright install state, file permissions, and known
config issues.

---

## 9 · Production readiness checklist

Before you put Hireloom in front of anyone other than yourself:

- [ ] **Auth token set** when bound to non-loopback (`AUTH_TOKEN`)
- [ ] **TLS terminated** by a reverse proxy (Caddy / nginx / Cloudflare)
- [ ] **Backups scheduled** (config/, data/, reports/)
- [ ] **Health probe** wired to a monitor
- [ ] **Error log** rotated + retained (default 2 MiB rolling)
- [ ] **CSP / X-Frame-Options** verified (`curl -I http://host:4747/`)
- [ ] **Rate limits** tuned for your traffic profile
- [ ] **Update channel** subscribed (`npm run update:check`)
- [ ] **Gmail OAuth scope** is `gmail.readonly` (verify in Google Cloud Console)
- [ ] **All 189 tests pass** (`npm test`)
- [ ] **Browser tests pass** (`SKIP_BROWSER_TESTS=0 npm test`)

If every box is checked: ship it.
