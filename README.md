# ChompChores

Family chore + task app.

## Two tracks (important)

| Track | Path | Status |
|---|---|---|
| **Kids live app** | Root [`index.html`](index.html) + [`server.js`](server.js) + Docker | **Do not break** — JSON volume is production for the household |
| **Web PWA (PMF)** | [`apps/web-pwa/`](apps/web-pwa/) + [`supabase/`](supabase/) | Static PWA → Supabase RPCs — see [docs/PWA_SETUP.md](docs/PWA_SETUP.md) |
| **Native store path** | [`apps/mobile/`](apps/mobile/) | Expo — after PMF |

See [docs/DATA_SAFETY.md](docs/DATA_SAFETY.md), [docs/PWA_SETUP.md](docs/PWA_SETUP.md), and [docs/STORE_LAUNCH.md](docs/STORE_LAUNCH.md).

## Legacy (home LAN)

```bash
docker compose up -d
# open http://localhost:3000
```

## Web PWA + Supabase (new project only — does not touch kids JSON)

```bash
# 1) Create empty Supabase project → paste URL + anon key into apps/web-pwa/config.js
# 2) Link + push migrations (see docs/PWA_SETUP.md)
npx supabase link --project-ref YOUR_REF
npx supabase db push

# 3) Seed demo household (SQL) then:
npm run pwa
# open http://localhost:4173
```

## Mobile + Supabase (optional, later)

```bash
cd apps/mobile
cp .env.example .env   # paste anon URL/key
npm install
npx expo start
```

## Import household snapshot (later, never automatic)

```bash
mkdir -p exports
curl -s http://127.0.0.1:3000/data > exports/snapshot.json
cd scripts && npm i
npm run import-json -- --input ../exports/snapshot.json   # dry-run
```

## Layout

```
├── index.html / server.js / docker-compose.yml   # live kids app
├── supabase/migrations/                         # Postgres schema + RPCs
├── supabase/functions/                          # midnight_reset, ical_proxy
├── packages/domain/                             # shared pure TS helpers
├── scripts/import-json-to-pg.ts                 # snapshot → Supabase
├── apps/web-pwa/                                # static PWA → Supabase
├── apps/mobile/                                 # Expo app (later)
└── docs/                                        # safety + PWA setup + store checklist
```

