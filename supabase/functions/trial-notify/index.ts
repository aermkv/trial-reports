// Emails the right people after an action on a trial report. Called by the app
// right after tr_transition / tr_comment succeeds. It only emails about the
// report's latest activity entry made by the caller, so it can't be used to
// send arbitrary mail. Everyone is emailed only when it's their move (or
// they need to know the outcome), like the Load Diagram Tool.
import { admin, caller, cors, esc, json, sendEmail } from "../_shared/common.ts";

const STATUS: Record<string, string> = {
  draft: "Draft", settings: "Settings Entry", ops_review: "Operations Review", tech_review: "Final Approval",
  scheduling: "Scheduling", execution: "Execution", testing: "Testing", closed: "Closed", cancelled: "Cancelled",
};
const ADVANCED: Record<string, string> = {
  draft: "sent a trial request to Engineering for settings", settings: "entered the line settings and sent the report for Operations review",
  ops_review: "approved the report (Operations) and sent it for final approval", tech_review: "gave final approval; the trials are ready to schedule",
  scheduling: "scheduled the trials", execution: "ran the trials and sent the report to R&D for testing", testing: "closed the report. Here is the after-trial package",
};
// Owner roles of each step (author = the report's requester).
const OWNERS: Record<string, string[]> = {
  draft: ["author"], settings: ["engineer"], ops_review: ["ops_director"], tech_review: ["tech_director"],
  scheduling: ["plant_manager"], execution: ["engineer"], testing: ["author", "requester"],
};

const afterPackage = (a: Record<string, string>) => {
  const row = (l: string, v?: string) => (v ? `<p style="margin:8px 0 0"><b>${esc(l)}</b><br><span style="white-space:pre-wrap">${esc(v)}</span></p>` : "");
  return `<div style="border-top:1px solid #ccc;margin-top:12px;padding-top:4px">${row("After-trial summary", a.summary)}${row("Problems on the line", a.problems)}${row("Where the trial material ended up", a.material)}${row("Recommendations and next steps", a.next)}
    <p style="color:#666">The full package (settings as run and test results for each trial-condition, samples shipped and both sign-offs) is in the report. Use Print / PDF there for a copy.</p></div>`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await caller(req);
    if (!user) return json({ error: "Not signed in." }, 401);
    const { reportId, appUrl } = await req.json();
    const db = admin();

    const { data: report } = await db.from("tr_reports").select("*").eq("id", reportId).single();
    if (!report) return json({ error: "Report not found." }, 404);
    const { data: last } = await db.from("tr_activity").select("*").eq("report_id", reportId).order("id", { ascending: false }).limit(1).single();
    if (!last || last.actor !== user.id || Date.now() - new Date(last.at).getTime() > 5 * 60_000) return json({ skipped: "no recent action by caller" });

    const { data: members } = await db.from("tr_members").select("user_id, email, full_name, role, active").eq("active", true);
    const byRole = (...roles: string[]) => (members || []).filter((m) => roles.includes(m.role));
    const byId = (id: string) => (members || []).filter((m) => m.user_id === id);
    const { data: trials } = await db.from("tr_trials").select("trial_no").eq("report_id", reportId).order("position");

    let to: { email: string; user_id: string }[] = [];
    const s = report.status, k = last.kind;
    const ownersOf = (step: string) => (OWNERS[step] || []).flatMap((r) => (r === "author" ? byId(report.created_by) : byRole(r)));
    if (k === "advance" && s === "closed") {
      // After-trial package: Technology, the engineer who ran it, Plant Manager, Operations (and the requester).
      const ranBy = report.acks?.execution?.user;
      to = [...byRole("tech_director", "plant_manager", "ops_director"), ...(ranBy ? byId(ranBy) : byRole("engineer")), ...byId(report.created_by)];
    } else if (k === "advance" || k === "send_back") to = ownersOf(s);
    else if (k === "cancel") to = [...byId(report.created_by), ...ownersOf(last.from_status)];
    else if (k === "comment") to = [...byId(report.created_by), ...ownersOf(s)];
    const emails = [...new Set(to.filter((m) => m.user_id !== user.id).map((m) => m.email))];
    if (!emails.length) return json({ sent: 0 });

    const link = `${String(appUrl || "").split("#")[0].split("?")[0]}?report=${report.id}`;
    const nums = (trials || []).map((t) => t.trial_no).join(", ");
    const subject = `${STATUS[s] || s}: ${report.title || "Trial report"}${nums ? ` (${nums})` : ""}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#202020;line-height:1.5">
      <p><b>${esc(last.actor_name)}</b> ${esc(k === "advance" ? ADVANCED[last.from_status] || "handed off a trial report" : k === "send_back" ? `sent a trial report back to ${s === "draft" ? "the requester" : STATUS[s]}` : k === "cancel" ? "cancelled a trial report" : "commented on a trial report")}.</p>
      ${(k === "advance" || k === "send_back") && s !== "closed" ? `<p>It's now at <b>${esc(STATUS[s])}</b> and waiting on you.</p>` : ""}
      ${s === "closed" && k === "advance" ? afterPackage(report.data?.after || {}) : ""}
      <p style="margin:0"><b>${esc(report.title)}</b><br>${esc(nums)}<br>Requested by ${esc(report.requester_name)} · Status: ${esc(STATUS[s] || s)}</p>
      ${last.body ? `<p style="border-left:3px solid #888;padding-left:10px;white-space:pre-wrap">${esc(last.body)}</p>` : ""}
      <p><a href="${esc(link)}" style="color:#202020">Open the report</a></p></div>`;
    await sendEmail(emails, subject, html);
    return json({ sent: emails.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
