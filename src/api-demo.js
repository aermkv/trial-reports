// Demo backend: the same interface as api-supabase.js, kept in this browser.
// It follows the database rules in supabase/migrations/0001_trial_reports.sql
// (numbering, roles, statuses) so the demo behaves like the real thing.
const KEY = "tr-demo-v1";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const now = () => new Date().toISOString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const clone = (x) => JSON.parse(JSON.stringify(x));

export const DEMO_USERS = [
  { user_id: "u-req", email: "rita.requester@gardian.com", full_name: "Rita Requester", role: "requester" },
  { user_id: "u-eng", email: "joe.meckler@gardian.com", full_name: "Joe Meckler", role: "engineer" },
  { user_id: "u-tech", email: "tina.tech@gardian.com", full_name: "Tina Tech", role: "tech_director" },
  { user_id: "u-ops", email: "oscar.ops@gardian.com", full_name: "Oscar Ops", role: "ops_director" },
  { user_id: "u-admin", email: "anton@gardian.com", full_name: "Anton Ermakov", role: "admin" },
  { user_id: "u-spec", email: "sam.spectator@gardian.com", full_name: "Sam Spectator", role: "spectator" },
];

const initials = (n) => String(n || "").trim().split(/[\s.]+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("");
const code = (t) => (t.line === "tp" ? "TG" + (t.line_no || "?") : t.line === "psa" ? "L7" : t.line === "sg" ? "SG" : "??");
const mmddyy = (d) => (d ? d.slice(5, 7) + d.slice(8, 10) + d.slice(2, 4) : "??????");

let db, memOnly = false;
function load() {
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; memOnly = true; }
  if (!db) { db = seed(); save(); }
}
function save() { if (memOnly) return; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { memOnly = true; } }

function seed() {
  const s = { members: DEMO_USERS.map((u) => ({ ...u, active: true, created_at: now() })), reports: [], trials: [], activity: [], counters: {}, session: null, seq: 1 };
  db = s;
  // One approved report and one waiting on the Director of Technology.
  const d = today();
  const r1 = mkReport("u-eng", { title: "PET film coating window", requester_name: "Joe Meckler", request_date: d, rd_lead: "Joe Meckler", project: "Ty-Gard® Air", part_number: "TG-AIR-513",
    data: { bg: "Zone coating on PET film at two steam settings.", goals: "Find the coat window at 25 psi / 260°F vs 65 psi / 310°F.", deliv: "Two rolls per condition and a data summary.", tests: [{ test: "Peel adhesion", method: "ASTM D3330", conds: "01-A, 01-B", n: "5", who: "R&D lab" }], samples: [{ conds: "01-A, 01-B", n: "10", size: "12 in x 12 in", use: "Peel and shear" }], ships: [], disp: { choice: "Hold for R&D evaluation", loc: "R&D cage" } } });
  mkTrial(r1, 0, { line: "tp", line_no: "2", planned_date: d, crew: "Line 2 crew", conditions: [{ name: "Low steam", hc_psi: "25", can1: "260", speed: "120" }, { name: "High steam", hc_psi: "65", can1: "310", speed: "120" }] });
  mkTrial(r1, 1, { line: "psa", lamp_n: 4, conditions: [{ name: "Baseline", ac_cw: "25", speed: "200", l1_s: "On", l1_p: "80", l2_s: "On", l2_p: "80", l3_s: "Off", l4_s: "Off" }] });
  as("u-eng", () => transition(r1.id, "submit", ""));
  as("u-tech", () => transition(r1.id, "approve", ""));
  as("u-ops", () => transition(r1.id, "approve", "Run on second shift."));
  const r2 = mkReport("u-req", { title: "Shock-Gard® riser magnet trial", requester_name: "Rita Requester", request_date: d, project: "Rail customer", data: { goals: "Confirm magnet holds riser through lamination.", tests: [], samples: [], ships: [], disp: {} } });
  mkTrial(r2, 0, { line: "sg", conditions: [{ name: "Magnet A", mag: "Yes", mag_sz: '1" x 0.25"', riser: "Yes" }] });
  as("u-req", () => transition(r2.id, "submit", ""));
  s.session = null;
  return s;
}

function mkReport(by, fields) {
  const m = db.members.find((x) => x.user_id === by);
  const r = { id: uid(), title: "", status: "draft", last_action: null, requester_name: "", requester_initials: "", request_date: today(), rd_lead: "", project: "", part_number: "", data: {}, sign_tech: null, sign_ops: null, created_by: by, created_at: now(), updated_at: now(), submitted_at: null, approved_at: null, completed_at: null, ...fields };
  r.requester_initials = initials(r.requester_name);
  db.reports.push(r);
  db.activity.push({ id: db.seq++, report_id: r.id, at: now(), actor: by, actor_name: m?.full_name || "", kind: "created", body: "", from_status: null, to_status: "draft" });
  return r;
}
function number(t) {
  const r = db.reports.find((x) => x.id === t.report_id);
  if (!t.seq || t.seq_day !== r.request_date) { db.counters[r.request_date] = (db.counters[r.request_date] || 0) + 1; t.seq = db.counters[r.request_date]; t.seq_day = r.request_date; }
  t.trial_no = [code(t), r.requester_initials || "??", mmddyy(r.request_date), String(t.seq).padStart(2, "0")].join("-");
}
function mkTrial(r, position, f) {
  const t = { id: uid(), report_id: r.id, position, line: null, line_no: null, lamp_n: 4, planned_date: null, shift: "", duration: "", crew: "", conditions: [{ name: "" }], seq: null, seq_day: null, trial_no: null, created_at: now(), ...f };
  number(t); db.trials.push(t); return t;
}

let current = null; // signed-in member
const listeners = [];
function as(userId, fn) { const prev = current; current = db.members.find((m) => m.user_id === userId); try { return fn(); } finally { current = prev; } }
const role = () => (current && current.active ? current.role : null);
const canSee = (r) => ["engineer", "tech_director", "ops_director", "admin", "spectator"].includes(role()) || r.created_by === current?.user_id || (role() === "requester" && ["approved", "completed"].includes(r.status));
const canEdit = (r) => r.status === "draft" && role() && (r.created_by === current.user_id || ["engineer", "admin"].includes(role()));
const err = (m) => { throw new Error(m); };
const getR = (id) => { const r = db.reports.find((x) => x.id === id); if (!r || !canSee(r)) err("Report not found."); return r; };

function transition(id, action, comment) {
  const r = getR(id), me = role(), c = String(comment || "").trim(), mine = r.created_by === current.user_id, prev = r.status;
  let nxt;
  if (action === "submit") {
    if (r.status !== "draft") err("Only drafts can be submitted.");
    if (!(mine || ["engineer", "admin"].includes(me))) err("Only the report's author or R&D can submit it.");
    if (!r.title.trim() || !r.requester_name.trim()) err("Add a report title and the requester before submitting.");
    const ts = db.trials.filter((t) => t.report_id === id);
    if (!ts.length || ts.some((t) => !t.line || (t.line === "tp" && !t.line_no))) err("Every trial needs a line (and a line number for Ty-Gard lines) before submitting.");
    nxt = "tech_review";
  } else if (action === "recall") {
    if (r.status === "tech_review" && (mine || ["engineer", "admin"].includes(me))) nxt = "draft";
    else if (r.status === "ops_review" && ["tech_director", "admin"].includes(me)) nxt = "tech_review";
    else err("This report can't be recalled by you right now.");
  } else if (action === "approve") {
    if (r.status === "tech_review" && ["tech_director", "admin"].includes(me)) nxt = "ops_review";
    else if (r.status === "ops_review" && ["ops_director", "admin"].includes(me)) nxt = "approved";
    else err("It isn't your turn to approve this report.");
  } else if (action === "send_back") {
    if (!c) err("Add a comment saying what needs to change.");
    if (r.status === "tech_review" && ["tech_director", "admin"].includes(me)) nxt = "draft";
    else if (r.status === "ops_review" && ["ops_director", "admin"].includes(me)) nxt = "tech_review";
    else err("It isn't your turn to send this report back.");
  } else if (action === "reopen") {
    if (!c) err("Add a comment saying why it's being reopened.");
    if (r.status === "approved" && ["tech_director", "admin"].includes(me)) nxt = "draft"; else err("Only the Director of Technology can reopen an approved report.");
  } else if (action === "complete") {
    if (r.status === "approved" && (mine || ["engineer", "admin"].includes(me))) nxt = "completed"; else err("Only R&D or the report's author can mark an approved report completed.");
  } else if (action === "cancel") {
    if (["draft", "tech_review", "ops_review"].includes(r.status) && (mine || me === "admin")) nxt = "cancelled"; else err("This report can't be cancelled by you right now.");
  } else err("Unknown action " + action);
  const sig = { name: current.full_name, user: current.user_id, at: now(), decision: c ? "Approved with comments" : "Approved", comment: c };
  if (action === "approve" && prev === "tech_review") r.sign_tech = sig; else if (["draft", "tech_review"].includes(nxt)) r.sign_tech = null;
  if (action === "approve" && prev === "ops_review") r.sign_ops = sig; else if (["draft", "tech_review", "ops_review"].includes(nxt)) r.sign_ops = null;
  if (action === "submit") r.submitted_at = now();
  if (nxt === "approved") r.approved_at = now(); else if (["draft", "tech_review", "ops_review"].includes(nxt)) r.approved_at = null;
  if (nxt === "completed") r.completed_at = now();
  r.status = nxt; r.last_action = action; r.updated_at = now();
  db.activity.push({ id: db.seq++, report_id: id, at: now(), actor: current.user_id, actor_name: current.full_name, kind: action === "approve" ? (nxt === "approved" ? "approved_ops" : "approved_tech") : action, body: c, from_status: prev, to_status: nxt });
}

const listRow = (r) => ({ ...clone(r), trials: db.trials.filter((t) => t.report_id === r.id).sort((a, b) => a.position - b.position).map((t) => ({ trial_no: t.trial_no, line: t.line, line_no: t.line_no, planned_date: t.planned_date, conditions: t.conditions.length })) });
const tick = () => new Promise((res) => setTimeout(res, 120));

export const api = {
  mode: "demo",
  users: DEMO_USERS,
  takeRedirectError: () => null,
  onAuth(cb) { listeners.push(cb); const s = db.session && db.members.find((m) => m.user_id === db.session); current = s || null; cb(s ? { user: { id: s.user_id } } : null); },
  async signInAs(userId) { db.session = userId; save(); current = db.members.find((m) => m.user_id === userId); listeners.forEach((cb) => cb({ user: { id: userId } })); },
  async sendCode() { err("Demo mode: pick a demo person below instead."); },
  async verifyCode() {},
  async signInMicrosoft() { err("Demo mode: pick a demo person below instead."); },
  async signOut() { db.session = null; save(); current = null; window.location.reload(); },
  async reset() { try { localStorage.removeItem(KEY); } catch {} window.location.reload(); },
  async me() { return current ? { id: current.user_id, email: current.email, name: current.full_name, role: role() } : null; },
  async listReports() { await tick(); return db.reports.filter(canSee).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(listRow); },
  async getReport(id) {
    await tick(); const r = getR(id);
    return { report: clone(r), trials: clone(db.trials.filter((t) => t.report_id === id).sort((a, b) => a.position - b.position)), activity: clone(db.activity.filter((a) => a.report_id === id)) };
  },
  async saveReport(report, trials, removedIds = []) {
    await tick();
    const pick = (x) => ({ title: x.title || "", requester_name: x.requester_name || "", request_date: x.request_date || today(), rd_lead: x.rd_lead || "", project: x.project || "", part_number: x.part_number || "", data: clone(x.data || {}) });
    let r;
    if (!report.id) {
      if (!["requester", "engineer", "tech_director", "ops_director", "admin"].includes(role())) err("Your role can't create reports.");
      r = mkReport(current.user_id, pick(report));
    } else {
      r = getR(report.id);
      if (!canEdit(r)) err("This report can't be edited right now.");
      const dateOrNameChanged = r.request_date !== report.request_date || initials(r.requester_name) !== initials(report.requester_name);
      Object.assign(r, pick(report)); r.requester_initials = initials(r.requester_name); r.updated_at = now();
      if (dateOrNameChanged) db.trials.filter((t) => t.report_id === r.id).sort((a, b) => a.position - b.position).forEach(number);
    }
    db.trials = db.trials.filter((t) => !removedIds.includes(t.id));
    trials.forEach((t, i) => {
      const f = { position: i, line: t.line || null, line_no: t.line === "tp" ? t.line_no || null : null, lamp_n: +t.lamp_n || 4, planned_date: t.planned_date || null, shift: t.shift || "", duration: t.duration || "", crew: t.crew || "", conditions: clone(t.conditions?.length ? t.conditions : [{ name: "" }]) };
      const ex = t.id && db.trials.find((x) => x.id === t.id);
      if (ex) { Object.assign(ex, f); number(ex); } else mkTrial(r, i, f);
    });
    save();
    return this.getReport(r.id);
  },
  async transition(id, action, comment) { await tick(); transition(id, action, comment); save(); },
  async comment(id, body) {
    await tick(); const r = getR(id);
    if (role() === "requester" && r.created_by !== current.user_id) err("You can view this report but not comment on it.");
    if (!String(body).trim()) err("The comment is empty.");
    db.activity.push({ id: db.seq++, report_id: id, at: now(), actor: current.user_id, actor_name: current.full_name, kind: "comment", body: String(body).trim(), from_status: null, to_status: r.status });
    save();
  },
  async deleteReport(id) {
    const r = getR(id);
    if (!(role() === "admin" || (r.created_by === current.user_id && r.status === "draft" && !r.submitted_at))) err("You can't delete this report.");
    db.reports = db.reports.filter((x) => x.id !== id); db.trials = db.trials.filter((t) => t.report_id !== id); db.activity = db.activity.filter((a) => a.report_id !== id); save();
  },
  async listMembers() { return clone(db.members).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
  async setMember(userId, r, active, name) {
    if (role() !== "admin") err("Only admins can manage users.");
    if (userId === current.user_id && (r !== "admin" || !active)) err("You can't remove your own admin access.");
    const m = db.members.find((x) => x.user_id === userId); m.role = r; m.active = active; if (name != null) m.full_name = name; save();
  },
  async inviteMember(email, name, r) {
    if (role() !== "admin") err("Only admins can manage users.");
    email = String(email).trim().toLowerCase();
    let m = db.members.find((x) => x.email === email);
    if (m) { m.active = true; m.role = r; if (name) m.full_name = name; save(); return { restored: true }; }
    db.members.push({ user_id: uid(), email, full_name: name || email, role: r, active: true, created_at: now() }); save();
    return { invited: true };
  },
  notify() {},
};
load();
