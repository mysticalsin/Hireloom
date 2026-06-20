# Hireloom Web

The cinematic front page + accounts, on **Supabase** (auth + Postgres + RLS).
Vite + React + TypeScript + Tailwind + lucide-react. Inter via Google Fonts.

## What it does
- **Landing:** full-viewport cinematic hero (background video, liquid-glass UI,
  blur-fade-up entrance, value-prop rotator).
- **Accounts:** real email/password + Google sign-up & sign-in via Supabase Auth.
- **Dashboard (gated):** shows the signed-in user's plan, monthly usage, and
  tracked roles — read straight from Supabase under Row-Level Security.

## Backend (Supabase) — set up once
1. Create a project at https://supabase.com.
2. SQL Editor → run `../supabase/migrations/0001_init.sql`. This creates
   `profiles`, `subscriptions`, `roles`, `reports`, `usage_counters`, RLS policies
   (each user sees only their own rows via `auth.uid()`), an on-signup trigger
   (auto profile + free subscription), and an atomic `increment_usage()` RPC.
3. Authentication → Providers: enable **Email**; optionally enable **Google**
   (add OAuth credentials) and set the Site URL / redirect to your domain.

## Run
```bash
cd web
cp .env.example .env          # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                   # http://localhost:5173
npm run build                 # production build
```
Only the anon key reaches the browser — that's expected and safe; RLS is what
protects the data. Never ship the service_role key in this app.

## How it connects to the engine
The Node engine (`../engine/*`) evaluates/tailors on the user's BYO key and writes
roles/reports. In production those writes target the same Supabase tables (via a
Postgres adapter on the store interface, or a Supabase Edge Function), so the
dashboard reflects them live. Billing entitlement (`engine/billing/*`) maps onto
the `subscriptions` table.

## Status
- Landing + auth + dashboard: built. Auth/data go live once the Supabase env vars
  are set and the migration is run.
