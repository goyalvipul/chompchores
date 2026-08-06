# ChompChores Web PWA — full UI clone

This is a **full port** of the live `index.html` UI (Dashboard, Rewards, History, Calendar, Manage, Tasks shell, PIN, Impersonate, etc.) backed by **Supabase** instead of Docker `/data`.

The home kids Docker app is **not** used and must stay untouched.

## Setup

See [docs/PWA_SETUP.md](../../docs/PWA_SETUP.md) and:

```bash
# Copy config.example.js → config.js and fill Supabase URL + anon/publishable key
cp config.example.js config.js
npm run pwa   # from repo root → http://localhost:4173
```

Sign in with the Supabase Auth **email/password** (not the old username login).

## Deploy on Cloudflare Pages

1. Connect this GitHub repo in Cloudflare Pages.
2. Build settings:
   - **Root directory:** leave empty (repo root) *or* set to `/`
   - **Build command:** `npm run pwa:config`
   - **Build output directory:** `apps/web-pwa`
3. **Environment variables** (Settings → Environment variables):
   - `SUPABASE_URL` = `https://YOUR_REF.supabase.co`
   - `SUPABASE_ANON_KEY` = your anon or publishable key  
   (`config.js` is gitignored; the build writes it from these vars.)
4. Deploy → open the HTTPS URL → Add to Home Screen on phone.

## Data model

Household JSON document in `household_app_state` (same shape as live `S`), loaded/saved via:

- `get_app_state()`
- `save_app_state(state, expected_rev)` with revision conflict protection
