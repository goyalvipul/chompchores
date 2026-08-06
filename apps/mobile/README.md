# ChompChores mobile (Expo)

Native iOS / Android client for the Supabase backend.

## Setup

1. Create a **new** Supabase project and `supabase db push` from repo root.
2. `cp .env.example .env` and paste URL + anon key.
3. `npm install && npx expo start`

Kids’ Docker JSON app is unrelated until you import a snapshot (see `docs/DATA_SAFETY.md`).

## Screens

- Login
- Dashboard (toggle chores via `toggle_chore` RPC)
- Rewards (`redeem_reward`)
- History
- Manage (admin list)
- Impersonate bar for admins

## Store builds

See [docs/STORE_LAUNCH.md](../../docs/STORE_LAUNCH.md) and `eas.json`.
