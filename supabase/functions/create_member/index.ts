/**
 * Admin-only: create a household member Auth user (no email verification) + profile.
 * Kids/local Docker app is unaffected.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "auth required" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: adminUser },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !adminUser) return json({ error: "invalid session" }, 401);

    const { data: adminProfile, error: profErr } = await userClient
      .from("profiles")
      .select("id, household_id, roles, username")
      .eq("id", adminUser.id)
      .maybeSingle();
    if (profErr || !adminProfile) return json({ error: "no profile" }, 403);
    const roles = adminProfile.roles || [];
    if (!roles.includes("admin")) return json({ error: "admin required" }, 403);

    const body = await req.json();
    const username = String(body.username || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "");
    const password = String(body.password || "");
    const displayName = String(body.display_name || body.displayName || username).trim();
    const phone = String(body.phone || "").trim();
    const emailRaw = String(body.email || "").trim().toLowerCase();
    const memberRoles: string[] = Array.isArray(body.roles) ? body.roles : ["chore"];

    if (!username || username.length < 2) return json({ error: "username required" }, 400);
    if (!password || password.length < 3) return json({ error: "password min 3 chars" }, 400);

    const allowed = new Set(["chore", "task", "admin"]);
    const cleanRoles = memberRoles.filter((r) => allowed.has(r));
    if (!cleanRoles.length) return json({ error: "invalid roles" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const synthetic = `${username}.${String(adminProfile.household_id).replace(/-/g, "").slice(0, 12)}@members.chompchores.app`;
    const email = emailRaw.includes("@") ? emailRaw : synthetic;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        display_name: displayName,
        phone,
        household_id: adminProfile.household_id,
        created_by: adminUser.id,
      },
    });
    if (createErr || !created?.user) {
      return json({ error: createErr?.message || "create user failed" }, 400);
    }

    const { data: attached, error: rpcErr } = await userClient.rpc("create_household_member", {
      p_user_id: created.user.id,
      p_username: username,
      p_display_name: displayName,
      p_phone: phone || null,
      p_email: emailRaw.includes("@") ? emailRaw : null,
      p_roles: cleanRoles,
    });

    if (rpcErr) {
      // Roll back auth user if profile attach failed
      try {
        await admin.auth.admin.deleteUser(created.user.id);
      } catch (_) {
        /* ignore */
      }
      return json({ error: rpcErr.message || "attach failed" }, 400);
    }

    return json({
      ok: true,
      user_id: created.user.id,
      username,
      email: emailRaw.includes("@") ? emailRaw : null,
      login_hint: emailRaw.includes("@")
        ? "Can sign in with email or username"
        : "Sign in with username + household (no email)",
      result: attached,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
