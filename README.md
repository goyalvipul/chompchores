# ChompChores

Family chore + task app.

## Two tracks (important)

| Track | Path | Status |
|---|---|---|
| **Kids live app** | Root [`index.html`](index.html) + [`server.js`](server.js) + Docker | **Do not break** — JSON volume is production for the household |
| **Store path** | [`supabase/`](supabase/) + [`apps/mobile/`](apps/mobile/) | New Postgres + Expo for App Store / Play Store |

See [docs/DATA_SAFETY.md](docs/DATA_SAFETY.md) and [docs/STORE_LAUNCH.md](docs/STORE_LAUNCH.md).

## Legacy (home LAN)

```bash
docker compose up -d
# open http://localhost:3000
```

## Mobile + Supabase (new project only)

```bash
# 1) Create empty Supabase project, then:
supabase link --project-ref YOUR_REF
supabase db push

# 2) Mobile
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
├── apps/mobile/                                 # Expo app
└── docs/                                        # safety + store checklist
```
