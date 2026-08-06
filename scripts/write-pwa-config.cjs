#!/usr/bin/env node
/** Write apps/web-pwa/config.js from env (Cloudflare Pages / CI). */
const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    "Missing SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)."
  );
  process.exit(1);
}

const out = path.join(__dirname, "..", "apps", "web-pwa", "config.js");
const body = `// Generated at build time — do not commit
window.CHOMP_CONFIG = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(key)},
};
`;
fs.writeFileSync(out, body);
console.log("Wrote", out);
