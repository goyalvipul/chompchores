# Data safety — kids are live

The home Docker app (`index.html` + `server.js` + volume `data.json`) stays the **source of truth** until you explicitly cut over.

## Hard rules

1. **Do not** point Supabase import at the live volume while kids are using the app unless you take a snapshot first.
2. **Do not** change Docker compose mounts, wipe the volume, or POST a blank `/data` during mobile development.
3. Import script defaults to **dry-run**. `--apply` only writes to a **new** Supabase project.
4. Migration (when you choose the day):
   - Pause new edits briefly (or accept a short freeze window)
   - `curl http://127.0.0.1:3000/data > exports/snapshot-YYYYMMDD.json`
   - Keep Docker running
   - Import the **snapshot file** into Supabase
   - Validate mobile against Supabase
   - Only then stop writing to JSON (optional freeze of legacy UI)

## What this repo does NOT do automatically

- No live migration on `npm install`
- No overwrite of `/data/data.json`
- No auth changes on the legacy HTML app
