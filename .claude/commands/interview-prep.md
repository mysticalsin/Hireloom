---
description: Recruiter-screen interview prep — answers in the user's voice + strip cheatsheet + call-day launcher
---

# /interview-prep — Recruiter-screen prep

A recruiter screen is **feel-based FIT, not a technical test.** Goal: calm, be liked, be honest. Read Current Profile in `CLAUDE.md` first (skills truth, claiming rule, honesty limits).

## 1. Gather
Read the full JD + the **exact CV and cover letter he submitted** (find the package via `data/applications.md` → `output/applications/<#> - Company - Role/` or `output/<company>/applications/…`). Learn the company's product, why it matters, its customers.

## 2. Drill these in HIS voice — one at a time (he types a draft → you refine to tight, confident, HIS words; never polished-but-stiff)
- **Q1 "Tell me about yourself"** — opener; lead with the **abstraction/throughline** ("the common thread has always been running complex delivery systems"), NOT education; **no metrics**; clean start ("Sure." not "Well"); END pointing forward at the role; do NOT volunteer the gap.
- **Q2 "Why <co>? Why this role?"** — specific company knowledge + a culture read + why-role (3 beats, small pause between).
- **Q3 "What makes you a fit?"** — where ONE metric story goes (e.g. $1.4M / 22% / 99.2% SLA).
- **Q4 the gap probe** — **honest statement, NEVER a self-doubting question.** "I'm not an X and won't pretend to be" → reframe what the role actually needs → his genuine adjacent strengths → "a built delivery muscle is rarer and harder to teach than domain context." NEVER coach fake fluency.
- **Q5 "What do you know about <co>?"** — ~40s; concise = confident.
- **Logistics** — location/remote; work auth (Canadian, no sponsorship); availability (immediate). **Employment status:** with a live recruiter he's honest — "just wrapped at Amazon, back in the GTA, ready to go."
- **Comp — DEFLECT:** "The posted range is $X–Y. If the company feels I'm a genuine fit and wants to extend an offer, I'm certain we can come to an agreement on comp." (Pushed → "comfortable within the posted range.")
- **His questions (2–3 max)** + "what are the next steps?" asked LAST.

## 3. Delivery coaching
The **STOP problem** (he nails it then over-talks → "trust the period," finish on a question). Flag tricky pronunciations proactively. Deeper voice/video loop: `interview-prep/transcribe.py` + `sample-frames.py`, venv `~/.hireloom-whisper` ([[interview-voice-mock-setup]]).

## 4. Build the call-day kit — copy `interview-prep/kong-cheatsheet-strip.html` + `Launch Kong Cheat Sheet.command` as templates
- `interview-prep/<co>-cheatsheet-strip.html` — thin top-of-screen strip: teal title rail (context + lens hints) + one row of columns in **answer order** numbered "SAY IN ORDER," `★`=land-this-line, `✗`=don't-say (parked at column bottom), hardest 1–2 columns marked "◎ AT-LENS / read freely."
- `Launch <co> Cheat Sheet.command` (chmod +x): opens the strip as a Chrome app-mode panel (`--window-size=1512,300 --window-position=0,0`) + `caffeinate -dimsu -t 9000`.

## 5. Pre-game ritual to remind him
"Nothing to lose / the floor is real" pre-grant before Q1 (he has a pipeline + active interviews). Walk in calm.

## 6. Persist
Add/update a memory note `<co>-screening-prep` AND update `WORKING.md` (Active Interviews).
