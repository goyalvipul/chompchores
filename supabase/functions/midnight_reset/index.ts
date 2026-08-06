/**
 * Cron: call midnight_reset_all() with the service role.
 * Schedule in Supabase Dashboard → Edge Functions → Schedules (00:00 America/Los_Angeles).
 * Does not touch the home Docker JSON app.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret) {
    const hdr = req.headers.get("x-cron-secret");
    if (hdr !== secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "missing env" }), { status: 500 });
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase.rpc("midnight_reset_all");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, usersProcessed: data }), {
    headers: { "Content-Type": "application/json" },
  });
});
