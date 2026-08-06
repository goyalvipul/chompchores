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
   - **Framework preset:** None
   - **Build command:** leave **empty** (runtime Function serves `/config.js`)
   - **Build output directory:** `apps/web-pwa`
   - **Root directory:** leave empty / `/`
3. **Variables and secrets** (Production) — already the right place:
   - `SUPABASE_URL` = `https://YOUR_REF.supabase.co`
   - `SUPABASE_ANON_KEY` = your anon or publishable key  
   These are read at **runtime** by repo-root [`functions/config.js.js`](../../functions/config.js.js) (not during build).
4. Deploy → open `https://YOUR-SITE.pages.dev/config.js` — you should see your Supabase URL in plain JS (not the HTML app page).
5. Then open the site root and sign in.

Locally you still use a gitignored `config.js` (`cp config.example.js config.js`).

## Data model

Household JSON document in `household_app_state` (same shape as live `S`), loaded/saved via:

- `get_app_state()`
- `save_app_state(state, expected_rev)` with revision conflict protection
