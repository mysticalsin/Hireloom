#!/usr/bin/env bash
# launch-apply.sh — one-command launcher for the apply-session window.
#
# Boots engine/apply/apply-session.mjs as a headed browser, wired to a BYO LLM key.
# The engine speaks the OpenAI-compatible /chat/completions API (its KIMI_* slots),
# and the Gemini OpenAI endpoint is OpenAI-compatible — so we read GEMINI_* from the
# gitignored .env and map it onto the engine's KIMI_* slots. No secret on the CLI.
#
# Provider precedence:
#   1. If GEMINI_API_KEY is set in .env  -> use Gemini (the BYO-key apply path)
#   2. else fall back to the .env KIMI_* values (NVIDIA NIM / Moonshot)
#
# Chromium is auto-resolved from the Playwright cache if PW_CHROMIUM_PATH is unset.
#
# Usage:  npm run apply:session     (or)     bash engine/apply/launch-apply.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

env_get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }

GEMINI_KEY="$(env_get GEMINI_API_KEY)"
if [ -n "$GEMINI_KEY" ]; then
  export KIMI_API_KEY="$GEMINI_KEY"
  export KIMI_BASE_URL="$(env_get GEMINI_BASE_URL)"
  export KIMI_MODEL="$(env_get GEMINI_MODEL)"
  echo "apply-session: using Gemini (${KIMI_MODEL:-gemini})"
else
  echo "apply-session: no GEMINI_API_KEY in .env — falling back to KIMI_* from .env"
fi

if [ -z "${PW_CHROMIUM_PATH:-}" ]; then
  PW_CHROMIUM_PATH="$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium*/chrome-mac-arm64/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" 2>/dev/null | head -1 || true)"
  export PW_CHROMIUM_PATH
fi
echo "apply-session: chromium $([ -n "${PW_CHROMIUM_PATH:-}" ] && echo "ok" || echo "NOT FOUND (will try Playwright default)")"

# Dock the window to the right half of the main display (so it sits beside your
# editor instead of going fullscreen). Override by exporting APPLY_WINDOW="x,y,w,h".
if [ -z "${APPLY_WINDOW:-}" ]; then
  BOUNDS="$(osascript -e 'tell application "Finder" to get bounds of window of desktop' 2>/dev/null || true)"
  SW="$(printf '%s' "$BOUNDS" | awk -F', ' '{print $3}')"
  SH="$(printf '%s' "$BOUNDS" | awk -F', ' '{print $4}')"
  if [ -n "$SW" ] && [ -n "$SH" ]; then
    export APPLY_WINDOW="$((SW/2)),24,$((SW/2)),$((SH-24))"
    echo "apply-session: window docked right ($APPLY_WINDOW)"
  fi
fi

exec node engine/apply/apply-session.mjs
