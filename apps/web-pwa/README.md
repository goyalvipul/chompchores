# ChompChores Web PWA — full UI clone

Full port of the live `index.html` UI, backed by Supabase. The home kids Docker app stays untouched.

## Local

```bash
# from repo root
npm run pwa
# http://localhost:4173
```

Use **Sign up** (new household admin) or **Sign in** (email or username + household).  
Kids added in Manage sign in with **username + household** (no email verify).  
See [`docs/AUTH_EMAIL.md`](../../docs/AUTH_EMAIL.md) for confirmation email setup.

`config.js` contains the **publishable/anon** key only (meant for browsers). Never put the `service_role` key in this file.

Local Docker kids app login is unchanged (username/password on `data.json`).

## Deploy on Cloudflare Pages

1. Connect this GitHub repo.
2. Build settings:
   - **Framework preset:** None
   - **Build command:** leave **empty**
   - **Build output directory:** `apps/web-pwa`
   - **Root directory:** empty / `/`
3. Deploy → open the site → sign in.

No Cloudflare env vars required for basic deploy (`config.js` is committed).

## Data model

Household JSON in `household_app_state` via `get_app_state` / `save_app_state`.
