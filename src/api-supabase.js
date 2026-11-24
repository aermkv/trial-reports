// Live backend: the Load Diagram Tool's own Supabase project (same sign-in,
// same people). Trial Reports keeps its data in its own tr_* tables.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const cleanUrl = () => window.location.origin + window.location.pathname + window.location.search;
const fail = (error) => { if (error) throw new Error(error.message || String(error)); };

// Same redirect-error handling as the LDT's auth.js.
function readRedirectError() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const description = hash.get("error_description") || query.get("error_description");
  const code = hash.get("error_code") || query.get("error_code") || hash.get("error") || query.get("error");
  if (!description && !code) return null;
  ["error", "error_code", "error_description"].forEach((k) => query.delete(k));
  const search = query.toString();
  window.history.replaceState(null, "", window.location.pathname + (search ? `?${search}` : ""));
  const text = `${code || ""} ${description || ""}`;
  if (/banned/i.test(text)) return "This account has been removed. Ask an admin if you need access again.";
  if (/signup|not allowed/i.test(text)) return "This Microsoft account isn't registered. Ask an admin to invite the same email address, or sign in with your email below.";
  if (/access_denied|cancel/i.test(text)) return "Microsoft sign-in was cancelled.";
  return `Microsoft sign-in didn't work${description ? `: ${description}` : "."} You can sign in with your email below.`;
}
const redirectError = readRedirectError();

const TRIAL_COLS = "id, report_id, position, line, line_no, lamp_n, planned_date, shift, duration, crew, conditions, seq, trial_no";
const trialRow = (t, reportId, position) => ({
  report_id: reportId, position, line: t.line || null, line_no: t.line === "tp" ? t.line_no || null : null,
  lamp_n: +t.lamp_n || 4, planned_date: t.planned_date || null, shift: t.shift || "", duration: t.duration || "",
  crew: t.crew || "", conditions: t.conditions?.length ? t.conditions : [{ name: "" }],
});
const reportRow = (r) => ({
  title: r.title || "", requester_name: r.requester_name || "", request_date: r.request_date,
  rd_lead: r.rd_lead || "", project: r.project || "", part_number: r.part_number || "", data: r.data || {},
});

export const api = {
  mode: "live",
  takeRedirectError: () => redirectError,
  onAuth(cb) { supabase.auth.onAuthStateChange((_e, session) => cb(session)); },
  async sendCode(email) {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: cleanUrl(), shouldCreateUser: false } });
    if (error) {
      if (/banned/i.test(error.message)) throw new Error("This account has been removed. Ask an admin if you need access again.");
      if (/signups? not allowed|user not found/i.test(error.message)) throw new Error("This email isn't registered. Ask an admin to invite you.");
      throw error;
    }
  },
  async verifyCode(email, token) {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw new Error(/banned/i.test(error.message) ? "This account has been removed. Ask an admin if you need access again." : error.message);
  },
  async signInMicrosoft() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email", redirectTo: cleanUrl() } });
    fail(error);
  },
  async signOut() { await supabase.auth.signOut(); },

  async me() {
    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    if (!user) return null;
    const { data } = await supabase.from("tr_members").select("full_name, role, active").eq("user_id", user.id).maybeSingle();
    return { id: user.id, email: user.email, name: data?.full_name || user.email, role: data?.active ? data.role : null };
  },

  async listReports() {
    const { data, error } = await supabase.from("tr_report_list").select("*").order("updated_at", { ascending: false });
    fail(error);
    return data;
  },
  async getReport(id) {
    const [r, t, a] = await Promise.all([
      supabase.from("tr_reports").select("*").eq("id", id).maybeSingle(),
      supabase.from("tr_trials").select(TRIAL_COLS).eq("report_id", id).order("position").order("created_at"),
      supabase.from("tr_activity").select("*").eq("report_id", id).order("at"),
    ]);
    fail(r.error); fail(t.error); fail(a.error);
    if (!r.data) throw new Error("This report doesn't exist, or you don't have access to it.");
    return { report: r.data, trials: t.data, activity: a.data };
  },
  // Saves the report, then its trials in tab order (so new trial numbers
  // follow the tabs). Removed trials are deleted; their numbers aren't reused.
  async saveReport(report, trials, removedIds = []) {
    let id = report.id;
    if (!id) {
      const { data, error } = await supabase.from("tr_reports").insert(reportRow(report)).select("id").single();
      fail(error); id = data.id;
    } else {
      const { error } = await supabase.from("tr_reports").update(reportRow(report)).eq("id", id);
      fail(error);
    }
    if (removedIds.length) { const { error } = await supabase.from("tr_trials").delete().in("id", removedIds); fail(error); }
    for (let i = 0; i < trials.length; i++) {
      const t = trials[i], row = trialRow(t, id, i);
      const q = t.id ? supabase.from("tr_trials").update(row).eq("id", t.id) : supabase.from("tr_trials").insert(row);
      const { error } = await q;
      fail(error);
    }
    return this.getReport(id);
  },
  async transition(id, action, comment = "") {
    const { error } = await supabase.rpc("tr_transition", { p_report: id, p_action: action, p_comment: comment });
    fail(error);
    this.notify(id, action, comment);
  },
  async comment(id, body) {
    const { error } = await supabase.rpc("tr_comment", { p_report: id, p_body: body });
    fail(error);
    this.notify(id, "comment", body);
  },
  async deleteReport(id) {
    const { data, error } = await supabase.from("tr_reports").delete().eq("id", id).select("id");
    fail(error);
    if (!data?.length) throw new Error("You can't delete this report.");
  },
  async listMembers() {
    const { data, error } = await supabase.from("tr_members").select("*").order("created_at", { ascending: false });
    fail(error);
    return data;
  },
  async setMember(userId, role, active, name) {
    const { error } = await supabase.rpc("tr_set_member", { p_user: userId, p_role: role, p_active: active, p_name: name ?? null });
    fail(error);
  },
  async inviteMember(email, name, role) { return callFn("trial-invite", { email, name, role }, "Could not add this person."); },
  // Emails are best-effort, like the LDT: a failed email never blocks the action.
  notify(id, event, comment) { callFn("trial-notify", { reportId: id, event, comment, appUrl: cleanUrl() }).catch((e) => console.warn("email", e)); },
};

async function callFn(name, payload, fallback = "Request failed.") {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || fallback);
  return body;
}
