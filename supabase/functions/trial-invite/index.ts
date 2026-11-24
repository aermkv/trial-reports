// Admin-only: give someone access to Trial Reports with a role.
// People who already sign in to the Load Diagram Tool are added straight away
// (same accounts). Anyone new is sent a Supabase invitation email first.
import { admin, caller, cors, json } from "../_shared/common.ts";

const ROLES = ["requester", "engineer", "tech_director", "ops_director", "admin", "spectator"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await caller(req);
    if (!user) return json({ error: "Not signed in." }, 401);
    const db = admin();
    const { data: me } = await db.from("tr_members").select("role, active").eq("user_id", user.id).maybeSingle();
    if (!me?.active || me.role !== "admin") return json({ error: "Only admins can manage users." }, 403);

    const { email: rawEmail, name, role } = await req.json();
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (!ROLES.includes(role)) return json({ error: "Unknown role." }, 400);

    // Find an existing account: first the LDT's profiles table, then auth itself.
    let userId: string | null = null, invited = false;
    const { data: prof } = await db.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (prof) userId = prof.id;
    if (!userId) {
      for (let page = 1; page <= 20 && !userId; page++) {
        const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
        const hit = data?.users.find((u) => (u.email || "").toLowerCase() === email);
        if (hit) userId = hit.id;
        if (!data || data.users.length < 200) break;
      }
    }
    if (!userId) {
      const redirectTo = req.headers.get("origin") ? `${req.headers.get("origin")}/trial-reports/` : undefined;
      const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error) return json({ error: error.message }, 400);
      userId = data.user.id; invited = true;
    }

    const { data: existing } = await db.from("tr_members").select("user_id").eq("user_id", userId).maybeSingle();
    const { error } = await db.from("tr_members").upsert({ user_id: userId, email, role, active: true, ...(name ? { full_name: name } : {}) }, { onConflict: "user_id" });
    if (error) return json({ error: error.message }, 400);
    return json({ invited, restored: !!existing && !invited });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
