// Demo backend: the same interface as api-supabase.js, kept in this browser.
// It follows the database rules in supabase/migrations/0001_trial_reports.sql
// (numbering, roles, the 8-step route) so the demo behaves like the real thing.
import { STEPS, STEP, stepNo, nextStep, prevStep, OPEN, FILL, isOwner } from "./route.js";
const KEY = "tr-demo-v2";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const now = () => new Date().toISOString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const clone = (x) => JSON.parse(JSON.stringify(x));

export const DEMO_USERS = [
  { user_id: "u-rd", email: "rita.research@gardian.com", full_name: "Rita Research", role: "requester" },
  { user_id: "u-eng", email: "ed.engineer@gardian.com", full_name: "Ed Engineer", role: "engineer" },
  { user_id: "u-ops", email: "oscar.ops@gardian.com", full_name: "Oscar Ops", role: "ops_director" },
  { user_id: "u-tech", email: "tina.tech@gardian.com", full_name: "Tina Tech", role: "tech_director" },
  { user_id: "u-pm", email: "pat.plant@gardian.com", full_name: "Pat Plant", role: "plant_manager" },
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
  const d = today();
  // 1) Waiting on the Director of Operations
  const r1 = mkReport("u-rd", { title: "PET film coating window", requester_name: "Rita Research", request_date: d, rd_lead: "Rita Research", project: "Ty-Gard® Air", part_number: "TG-AIR-513",
    data: { bg: "Zone coating on PET film at two steam settings.", goals: "Find the coat window at 25 psi / 260°F vs 65 psi / 310°F.", deliv: "Two rolls per condition and a data summary.", tests: [{ test: "Peel adhesion", method: "ASTM D3330", conds: "01-A, 01-B", n: "5", who: "R&D lab" }], samples: [{ conds: "01-A, 01-B", n: "10", size: "12 in x 12 in", use: "Peel and shear" }], ships: [], disp: { choice: "Hold for R&D evaluation", loc: "R&D cage" }, after: {} } });
  mkTrial(r1, 0, { line: "tp", line_no: "2", conditions: [{ name: "Low steam", mat: "PET 2 mil" }, { name: "High steam", mat: "PET 2 mil" }] });
  as("u-rd", () => transition(r1.id, "advance", ""));
  r1Settings(r1);
  as("u-eng", () => transition(r1.id, "advance", "Settings from the September PET plan."));
  // 2) A Shock-Gard draft the requester is still writing
  const r2 = mkReport("u-rd", { title: "Shock-Gard® riser magnet trial", requester_name: "Rita Research", request_date: d, project: "Rail customer", data: { goals: "Confirm the magnet holds the riser through lamination.", tests: [], samples: [], ships: [], disp: {}, after: {} } });
  mkTrial(r2, 0, { line: "sg", conditions: [{ name: "Magnet A" }] });
  s.session = null;
  return s;
}
function r1Settings(r) {
  const t = db.trials.find((x) => x.report_id === r.id);
  t.conditions = [{ name: "Low steam", mat: "PET 2 mil", speed: "120", hc_psi: "25", can1: "260" }, { name: "High steam", mat: "PET 2 mil", speed: "120", hc_psi: "65", can1: "310" }];
}
function mkReport(by, fields) {
  const m = db.members.find((x) => x.user_id === by);
  const r = { id: uid(), title: "", status: "draft", last_action: null, acks: {}, requester_name: "", requester_initials: "", request_date: today(), rd_lead: "", project: "", part_number: "", data: {}, sign_tech: null, sign_ops: null, created_by: by, created_at: now(), updated_at: now(), submitted_at: null, approved_at: null, completed_at: null, ...fields };
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
  const t = { id: uid(), report_id: r.id, position, line: null, line_no: null, lamp_n: 4, planned_date: null, shift: "", duration: "", crew: "", run_notes: "", conditions: [{ name: "" }], seq: null, seq_day: null, trial_no: null, created_at: now(), ...f };
  number(t); db.trials.push(t); return t;
}

let current = null; // signed-in member
const listeners = [];
function as(userId, fn) { const prev = current; current = db.members.find((m) => m.user_id === userId); try { return fn(); } finally { current = prev; } }
const role = () => (current && current.active ? current.role : null);
const meObj = () => ({ id: current?.user_id, role: role() });
const canSee = () => !!role();
const canEdit = (r) => FILL.includes(r.status) && isOwner(r, meObj());
const err = (m) => { throw new Error(m); };
const getR = (id) => { const r = db.reports.find((x) => x.id === id); if (!r || !canSee(r)) err("Report not found."); return r; };
const SKIP = ["name", "mat", "run", "disp", "note", "asrun", "result"];

function transition(id, action, comment, target = "previous") {
  const r = getR(id), c = String(comment || "").trim(), prev = r.status;
  let nxt;
  if (action === "advance") {
    if (!OPEN.includes(r.status)) err("This report has no next step.");
    if (!isOwner(r, meObj())) err("This step isn't yours.");
    const ts = db.trials.filter((t) => t.report_id === id);
    if (r.status === "draft") {
      if (!r.title.trim() || !r.requester_name.trim()) err("Add a report title and the requester first.");
      if (!ts.length) err("Add at least one trial first.");
      if (ts.some((t) => !t.line || (t.line === "tp" && !t.line_no))) err("Every trial needs a line (and a line number for Ty-Gard lines).");
    } else if (r.status === "settings") {
      const bad = ts.flatMap((t) => t.conditions).filter((cd) => !Object.entries(cd).some(([k, v]) => !SKIP.includes(k) && String(v ?? "").trim())).length;
      if (bad) err(`Every condition needs its line settings before it goes to the Director of Operations (${bad} condition(s) still empty).`);
    } else if (r.status === "scheduling") {
      if (ts.some((t) => !t.planned_date)) err("Set a planned trial date for every trial first.");
    }
    nxt = nextStep(r.status);
  } else if (action === "send_back") {
    if (!OPEN.includes(r.status) || r.status === "draft") err("This report can't be sent back from here.");
    if (!isOwner(r, meObj())) err("This step isn't yours.");
    if (!c) err("Add a comment saying what needs to change.");
    nxt = target === "requester" ? "draft" : prevStep(r.status);
  } else if (action === "cancel") {
    if (!OPEN.includes(r.status)) err(`This report is already ${r.status}.`);
    if (!(r.created_by === current.user_id || role() === "admin")) err("Only the report's author or an admin can cancel it.");
    nxt = "cancelled";
  } else err("Unknown action " + action);
  const ack = { name: current.full_name, user: current.user_id, at: now(), comment: c };
  r.acks = r.acks || {};
  if (action === "advance") {
    r.acks[prev] = ack;
    if (prev === "ops_review") r.sign_ops = { ...ack, decision: c ? "Approved with comments" : "Approved" };
    if (prev === "tech_review") { r.sign_tech = { ...ack, decision: c ? "Approved with comments" : "Approved" }; r.approved_at = now(); }
    if (prev === "draft") r.submitted_at = now();
  } else if (action === "send_back") {
    for (const k of Object.keys(r.acks)) if (stepNo(k) >= stepNo(nxt)) delete r.acks[k];
    if (!r.acks.ops_review) r.sign_ops = null;
    if (!r.acks.tech_review) { r.sign_tech = null; r.approved_at = null; }
  }
  r.closed_at = nxt === "closed" ? now() : null;
  r.status = nxt; r.last_action = action; r.updated_at = now();
  db.activity.push({ id: db.seq++, report_id: id, at: now(), actor: current.user_id, actor_name: current.full_name, kind: action, body: c, from_status: prev, to_status: nxt });
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
      if (!["requester", "engineer", "tech_director", "ops_director", "plant_manager", "admin"].includes(role())) err("Your role can't create reports.");
      r = mkReport(current.user_id, pick(report));
    } else {
      r = getR(report.id);
      if (!canEdit(r)) err("This report can't be edited right now.");
      if (r.status !== "draft" && (r.request_date !== report.request_date || r.requester_name !== report.requester_name)) err("The requester and request date set the trial numbers, so they can only change while the report is a draft.");
      if (!["draft", "settings"].includes(r.status) && (removedIds.length || trials.some((t) => !t.id))) err("Trials can only be added or removed while the report is a draft or in settings entry.");
      const dateOrNameChanged = r.request_date !== report.request_date || initials(r.requester_name) !== initials(report.requester_name);
      Object.assign(r, pick(report)); r.requester_initials = initials(r.requester_name); r.updated_at = now();
      if (dateOrNameChanged) db.trials.filter((t) => t.report_id === r.id).sort((a, b) => a.position - b.position).forEach(number);
    }
    db.trials = db.trials.filter((t) => !removedIds.includes(t.id));
    trials.forEach((t, i) => {
      const f = { position: i, line: t.line || null, line_no: t.line === "tp" ? t.line_no || null : null, lamp_n: +t.lamp_n || 4, planned_date: t.planned_date || null, shift: t.shift || "", duration: t.duration || "", crew: t.crew || "", run_notes: t.run_notes || "", conditions: clone(t.conditions?.length ? t.conditions : [{ name: "" }]) };
      const ex = t.id && db.trials.find((x) => x.id === t.id);
      if (ex) { Object.assign(ex, f); number(ex); } else mkTrial(r, i, f);
    });
    save();
    return this.getReport(r.id);
  },
  async transition(id, action, comment, target) { await tick(); transition(id, action, comment, target); save(); },
  async comment(id, body) {
    await tick(); const r = getR(id);
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
