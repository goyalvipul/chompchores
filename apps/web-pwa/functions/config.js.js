/** Cloudflare Pages Function — serves /config.js from runtime env vars. */
export async function onRequest(context) {
  const url = context.env.SUPABASE_URL || "";
  const key =
    context.env.SUPABASE_ANON_KEY ||
    context.env.SUPABASE_PUBLISHABLE_KEY ||
    "";

  if (!url || !key) {
    return new Response(
      "/* Missing SUPABASE_URL or SUPABASE_ANON_KEY in Pages Variables and secrets */\n" +
        "window.CHOMP_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };\n",
      {
        status: 200,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const body =
    "window.CHOMP_CONFIG = {\n" +
    `  supabaseUrl: ${JSON.stringify(url)},\n` +
    `  supabaseAnonKey: ${JSON.stringify(key)},\n` +
    "};\n";

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
