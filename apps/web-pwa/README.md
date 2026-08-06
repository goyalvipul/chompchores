# ChompChores Web PWA — full UI clone

Full port of the live `index.html` UI, backed by Supabase. The home kids Docker app stays untouched.

## Local

```bash
# from repo root
npm run pwa
# http://localhost:4173
```

Sign in with Supabase Auth **email/password**.

`config.js` contains the **publishable/anon** key only (meant for browsers). Never put the `service_role` key in this file.

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
