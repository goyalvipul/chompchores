/**
 * Server-side iCal fetch (CORS-safe). Port of server.js /ical-proxy.
 */
Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization");
  if (!auth) {
    return new Response(JSON.stringify({ error: "auth required" }), { status: 401 });
  }

  const url = new URL(req.url).searchParams.get("url");
  if (!url) {
    return new Response(JSON.stringify({ error: "missing url" }), { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ChompChores/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "upstream " + res.status }), { status: 502 });
    }
    const body = await res.text();
    return new Response(body, {
      headers: {
        "Content-Type": "text/calendar;charset=utf-8",
        "Cache-Control": "max-age=300",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502 });
  }
});
