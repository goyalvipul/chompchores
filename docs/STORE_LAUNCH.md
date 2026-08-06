# End-to-end plan: App Store + Play Store (without sharing family data)

Goal: ship a **native-feeling** Expo (React Native) app to iOS and Android. Your existing household data stays private. Other families create **their own** households. Your JSON snapshot is imported only into **your** Supabase household when you choose.

## Architecture (locked)

| Layer | Choice |
|---|---|
| Mobile | Expo + EAS (iOS + Android one codebase) |
| Backend | Supabase Postgres + Auth + RLS + Edge Functions |
| Legacy home app | Keep Docker JSON until cutover ([DATA_SAFETY.md](./DATA_SAFETY.md)) |
| Tenancy | `households` — each family isolated |

Public users never see your chores. RLS enforces `household_id`.

## Phase 0 — Accounts & legal (do before first store build)

1. **Apple Developer Program** ($99/yr) — [developer.apple.com](https://developer.apple.com)
2. **Google Play Console** ($25 one-time) — [play.google.com/console](https://play.google.com/console)
3. **Expo account** + `npm i -g eas-cli` then `eas login`
4. Privacy policy URL (hosted page) — required by both stores
5. Support email / contact URL
6. Decide age rating: family utility; if under-13 accounts, follow COPPA / Kids category carefully (prefer **parent-owned accounts** with child profiles — our model)

## Phase 1 — Backend (new Supabase project)

```bash
# Install CLI once
npm i -g supabase

# Link to a NEW empty project (not related to Docker)
supabase login
supabase link --project-ref YOUR_REF
supabase db push   # applies supabase/migrations/*
```

Deploy functions:

```bash
supabase functions deploy midnight_reset
supabase functions deploy ical_proxy
```

Schedule `midnight_reset` daily at 00:05 America/Los_Angeles with `x-cron-secret`.

Set mobile env from Project Settings → API:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## Phase 2 — Your private household (optional, later)

Kids keep using Docker. When ready:

```bash
mkdir -p exports
curl -s http://127.0.0.1:3000/data > exports/snapshot.json
cd scripts && npm i
npm run import-json -- --input ../exports/snapshot.json
# review exports/import-out/summary.json + import.sql
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run import-json -- --input ../exports/snapshot.json --apply
```

Change imported passwords immediately. Docker remains unchanged until you freeze it.

## Phase 3 — Mobile MVP locally

```bash
cd apps/mobile
cp .env.example .env   # fill keys
npm install
npx expo start
```

Test: login → Impersonate (admin) → toggle chore → redeem → history.

## Phase 4 — Internal store builds (no public data)

```bash
cd apps/mobile
eas init                 # sets projectId in app.json
eas build --platform ios --profile preview
eas build --platform android --profile preview
```

- iOS: upload to **TestFlight** (internal testers = your family)
- Android: **Internal testing** track on Play Console

This ships the **app binary**, not your database. Testers use their own login / your household invites.

## Phase 5 — Store acceptance checklist

### Both stores

- [ ] Privacy policy URL in listing
- [ ] Account deletion in-app (Apple Guideline 5.1.1) — implement before public
- [ ] No hardcoded secrets (only anon key in app)
- [ ] Screenshots for phone sizes
- [ ] App icon 1024 / Play feature graphic
- [ ] Accurate “what the app does” description
- [ ] Login works on a clean install

### Apple App Store

- [ ] Bundle id `com.chompchores.app` registered
- [ ] Age rating questionnaire completed
- [ ] If kids under 13: Kids category rules or parental gate; prefer parent account
- [ ] Encryption export compliance: `ITSAppUsesNonExemptEncryption = false` if standard HTTPS only
- [ ] Demo account for review **OR** clear signup path (reviewer must reach main UI)
- [ ] No crash on launch without session

### Google Play

- [ ] Package `com.chompchores.app`
- [ ] Content rating questionnaire (IARC)
- [ ] Target API level current requirement
- [ ] Data safety form (collect email/auth? yes — disclose)
- [ ] Families policy if marketed to kids

### Kids / family rules (follow carefully)

- Do **not** put third-party ads or behavioral tracking in v1
- Parent creates household; children are profiles/members
- Avoid collecting child email when possible (use parent-managed credentials or username@household.local pattern for private import only; public signup should use parent email)
- Disclose data collection clearly

## Phase 6 — Public launch (multi-tenant)

Add before going fully public:

1. Household signup RPC (`create_household_with_admin`)
2. Invite member by username/code
3. Delete account / leave household
4. Export my data (JSON download)
5. Production EAS submit:

```bash
eas build --platform all --profile production
eas submit --platform ios
eas submit --platform android
```

## How you avoid “sharing the data you created”

| Concern | Approach |
|---|---|
| Other families see Maahira’s chores | Impossible under RLS + separate `household_id` |
| Reviewers need a demo | Create a **throwaway household** with fake chores |
| Snapshot import | Only your Supabase project; never embed JSON in the app binary |
| Open source repo | Keep `exports/` and `.env` gitignored; never commit snapshots |

## Native vs Expo

Expo produces **real native binaries** (Swift/Kotlin shells + RN JS). For App Store / Play Store this is the standard path. “Fully native” rewrite (SwiftUI + Kotlin) is unnecessary for this product and would double cost.

## Suggested timeline

| Week | Outcome |
|---|---|
| 1 | Supabase pushed, mobile login + dashboard against empty/demo household |
| 2 | Feature parity (timers, manage add, PIN) |
| 3 | TestFlight + Play internal |
| 4 | Account deletion + signup; production submit |
| Later | Optional cutover: snapshot import → retire Docker writes |

## Commands quick reference

```bash
# Legacy kids app (unchanged)
docker compose up -d

# Backend
supabase db push

# Mobile
cd apps/mobile && npx expo start
eas build --profile preview --platform all
```
