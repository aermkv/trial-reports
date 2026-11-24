// Emails the right people after an action on a trial report. Called by the app
// right after tr_transition / tr_comment succeeds. It only emails about the
// report's latest activity entry made by the caller, so it can't be used to
// send arbitrary mail. Everyone is emailed only when it's their move (or
// they need to know the outcome), like the Load Diagram Tool.
import { admin, caller, cors, esc, json, sendEmail } from "../_shared/common.ts";

const STATUS: Record<string, string> = {
  draft: "Draft", tech_review: "Pending Technology Approval", ops_review: "Pending Operations Approval",
  approved: "Approved", completed: "Completed", cancelled: "Cancelled",
};
const WHAT: Record<string, string> = {
  submit: "submitted a trial report for approval", approved_tech: "approved a trial report (Director of Technology)",
  approved_ops: "gave final approval to a trial report", send_back: "sent back a trial report", recall: "recalled a trial report",
  reopen: "reopened a trial report for edits", complete: "marked a trial report completed", cancel: "cancelled a trial report",
  comment: "commented on a trial report",
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
    if (k === "submit") to = byRole("tech_director");
    else if (k === "approved_tech") to = byRole("ops_director");
    else if (k === "approved_ops") to = [...byId(report.created_by), ...byRole("spectator", "engineer")];
    else if (k === "send_back") to = s === "draft" ? byId(report.created_by) : byRole("tech_director");
    else if (k === "recall") to = s === "draft" ? byRole("tech_director") : byRole("ops_director");
    else if (k === "reopen") to = [...byId(report.created_by), ...byRole("ops_director")];
    else if (k === "complete") to = [...byRole("tech_director", "ops_director", "spectator")];
    else if (k === "cancel") to = byRole("tech_director", "ops_director");
    else if (k === "comment") {
      const turn = { draft: [] as string[], tech_review: ["tech_director"], ops_review: ["ops_director"], approved: ["engineer"] }[s as "draft"] || [];
      to = [...byId(report.created_by), ...byRole(...turn)];
    }
    const emails = [...new Set(to.filter((m) => m.user_id !== user.id).map((m) => m.email))];
    if (!emails.length) return json({ sent: 0 });

    const link = `${String(appUrl || "").split("#")[0].split("?")[0]}?report=${report.id}`;
    const nums = (trials || []).map((t) => t.trial_no).join(", ");
    const subject = `${STATUS[s] || s}: ${report.title || "Trial report"}${nums ? ` (${nums})` : ""}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#202020;line-height:1.5">
      <p><b>${esc(last.actor_name)}</b> ${esc(WHAT[k] || k)}.</p>
      <p style="margin:0"><b>${esc(report.title)}</b><br>${esc(nums)}<br>Requested by ${esc(report.requester_name)} · Status: ${esc(STATUS[s] || s)}</p>
      ${last.body ? `<p style="border-left:3px solid #888;padding-left:10px;white-space:pre-wrap">${esc(last.body)}</p>` : ""}
      <p><a href="${esc(link)}" style="color:#202020">Open the report</a></p></div>`;
    await sendEmail(emails, subject, html);
    return json({ sent: emails.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
