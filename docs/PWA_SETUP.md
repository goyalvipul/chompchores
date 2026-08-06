# ChompChores Web PWA (Supabase) — setup & your interventions

This path is **separate from the live kids Docker/JSON app**.  
Do **not** change `index.html` / `server.js` / Docker volume for this work.

| Track | Touched? |
|---|---|
| Live kids app (`localhost:3000`, `data.json`) | **No** |
| `apps/web-pwa` + `supabase/` | Yes |

---

## Where YOU need to intervene (accounts & keys)

### 1) Create a Supabase project (required)

1. Go to [https://supabase.com](https://supabase.com) → sign up / log in  
2. **New project** (free tier is fine)  
3. Save the database password somewhere safe  
4. Project Settings → **API**:
   - **Project URL** → paste into `apps/web-pwa/config.js` as `supabaseUrl`
   - **anon public** key → paste as `supabaseAnonKey`

Tell the agent when this is done (or paste URL + anon key into `config.js` yourself).  
**Never commit the service_role key.** Only the anon key goes in the PWA.

### 2) Push schema + RPCs (required)

On your machine (with [Supabase CLI](https://supabase.com/docs/guides/cli) installed):

```bash
cd /home/vipulgoyal/Documents/ChompChores
npx supabase login          # browser login — YOU
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push        # applies migrations including app_events
```

Or: Supabase Dashboard → SQL → paste/run migration files in order under `supabase/migrations/`.

### 3) Create first Auth user + demo household (required for login)

Supabase Auth emails are used (not the legacy username login).

1. Dashboard → **Authentication** → **Users** → **Add user**  
   - Email + password (e.g. `you@example.com`)  
   - Confirm email if your project requires it (disable “Confirm email” under Auth settings for fastest testing)
2. Copy the user’s **UUID**
3. SQL Editor → open `supabase/seed_demo_household.sql`  
   - Replace `auth_user_id` with that UUID  
   - Run it  
4. SQL Editor → run `supabase/seed_app_state_for_existing.sql`  
   This loads the **full app document** (`household_app_state`) so the PWA clone has chores/rewards/users like the live UI.

You should then be able to sign into the PWA with that email/password.

### 4) Host the static PWA for $0 (required for phones + service workers)

HTTPS is required for install / service workers (except `localhost`).

Pick one:

| Host | What you do |
|---|---|
| **Cloudflare Pages** | Connect Git → **Build command** empty → **Output** `apps/web-pwa`. Set **Variables and secrets** `SUPABASE_URL` + `SUPABASE_ANON_KEY` (served at runtime via `functions/config.js.js`). Details in [`apps/web-pwa/README.md`](../apps/web-pwa/README.md). |
| **Netlify** | Same folder; `netlify.toml` is present — still need a build step or env injection for `config.js` |
| **Vercel** | Same; `vercel.json` is present — same `config.js` note |

After deploy, open the HTTPS URL on a phone and use **Add to Home Screen**.

Optional local preview (no install banner reliability on desktop):

```bash
npx --yes serve apps/web-pwa -p 4173
# http://localhost:4173
```

### 5) Schedule midnight reset (recommended before real families)

Dashboard → **Edge Functions** → deploy `midnight_reset` from `supabase/functions/midnight_reset`  
Then schedule it (Supabase cron / external cron hitting the function with the service role).  
Details also in `docs/STORE_LAUNCH.md`.

### 6) Recruit 2–3 testers (you)

Send the HTTPS URL + short Loom: iOS Share → Add to Home Screen.  
After 1–2 weeks, SQL on `app_events` + Sean Ellis question (see below).

---

## What the agent already built (no live app touch)

- [`apps/web-pwa/`](../apps/web-pwa/) — **full UI clone** of live `index.html` (Dashboard, Rewards, History, Calendar, Manage, Tasks, PIN, Impersonate, TV timer, etc.)
- `manifest.webmanifest` + `sw.js` + iOS install banner
- Persistence: `get_app_state` / `save_app_state` on `household_app_state` (full `S` JSON document + revision conflicts)
- Migration [`supabase/migrations/20260806170000_household_app_state.sql`](../supabase/migrations/20260806170000_household_app_state.sql)
- Demo seeds: [`seed_demo_household.sql`](../supabase/seed_demo_household.sql) + [`seed_app_state_for_existing.sql`](../supabase/seed_app_state_for_existing.sql)

**Note:** Adding a user in Manage creates them in the household document for chores/assign. For that person to **log in**, also create them in Supabase Auth and a matching `profiles` row.

---

## PMF signals (after testers use it)

```sql
-- Opens per day
select date_trunc('day', created_at) d, count(*) 
from app_events where event_type = 'app_open'
group by 1 order by 1;

-- Chore toggles
select date_trunc('day', created_at) d, count(*) 
from app_events where event_type = 'chore_toggle'
group by 1 order by 1;
```

Ask: *“How disappointed would you be if this went away?”*  
≥40% “very disappointed” is a common early PMF bar.

---

## Migration steps (LIVE kids data → Supabase) — later, not now

Do this only when you are ready to cut over. Until then, Docker JSON stays source of truth.

1. **Keep Docker kids app running** (do not shut it down for this step).
2. Snapshot:
   ```bash
   mkdir -p exports
   curl -s http://127.0.0.1:3000/data > exports/snapshot-$(date +%Y%m%d).json
   ```
3. Dry-run import:
   ```bash
   cd scripts && npm i
   npm run import-json -- --input ../exports/snapshot-YYYYMMDD.json
   ```
4. Review `exports/import-out/` (or script output). Fix mapping issues if any.
5. Apply import to the **same** Supabase project (script `--apply` only when you intend to write).
6. Create Auth users for `maahira` / `vipul` / `admin` (or map emails) and link `profiles` / `legacy_id` as the import script documents.
7. Point `apps/web-pwa/config.js` at that project (already) and validate:
   - Chores, bank, history match snapshot
   - Midnight edge function scheduled
8. Only then optionally freeze legacy UI / stop writing to JSON (family switch day).
9. Keep JSON snapshots + Docker volume backups for at least 30 days after cutover.

**Until step 8, the live app and the PWA are intentionally separate worlds.**
