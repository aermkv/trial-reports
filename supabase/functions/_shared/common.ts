// Shared helpers for the Trial Reports edge functions.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// The signed-in caller, from their own access token.
export async function caller(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  return data.user;
}

export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Sent through Resend, like the Load Diagram Tool's emails.
export async function sendEmail(to: string[], subject: string, html: string) {
  if (!to.length) return;
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is not set");
  // Same sender as the Load Diagram Tool (its FROM_EMAIL secret), unless
  // TRIAL_EMAIL_FROM is set to give Trial Reports its own address.
  const from = Deno.env.get("TRIAL_EMAIL_FROM") || Deno.env.get("FROM_EMAIL") || "Gardian Trial Reports <notifications@notifications.gardian.com>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
