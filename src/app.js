// Gardian Trial Reports — app shell, Reports list, report editor, Activity, Users.
// Layout and behaviour follow the Load Diagram Tool: sign-in gate, Documents-
// style list with "needs your attention", editor with a sidebar and a sheet,
// one status button that turns into the approval menu, an Activity panel.
import { LINES, ART, DISP, REP, groupsOf, shown, letter, lineCode, lineLabel, lineShort } from "./lines.js";
import { LOAD_DIAGRAM_TOOL_URL } from "./config.js";

const params = new URLSearchParams(location.search);
const DEMO = window.TR_DEMO === true || params.get("demo") === "1";
const { api } = DEMO ? await import("./api-demo.js") : await import("./api-supabase.js");

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "");
const fmtWhen = (d) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const initials = (n) => String(n || "").trim().split(/[\s.]+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("");
const mmddyy = (d) => (d ? d.slice(5, 7) + d.slice(8, 10) + d.slice(2, 4) : "??????");
const pad = (n) => String(n).padStart(2, "0");

export const ROLE_LABELS = {
  requester: "Requester", engineer: "R&D Engineer", tech_director: "Director of Technology",
  ops_director: "Director of Operations", admin: "Admin", spectator: "Spectator",
};
const STATUS_LABELS = {
  draft: "Draft", tech_review: "Pending Technology Approval", ops_review: "Pending Operations Approval",
  approved: "Approved", completed: "Completed", cancelled: "Cancelled",
};
const statusLabel = (r) => (r.status === "draft" && r.last_action === "send_back" ? "Sent Back" : r.status === "draft" && r.last_action === "reopen" ? "Reopened" : r.status === "draft" && r.last_action === "recall" ? "Recalled" : STATUS_LABELS[r.status] || r.status);
const waitingOn = (r) => ({ draft: r.requester_name || "Author", tech_review: "Director of Technology", ops_review: "Director of Operations", approved: "R&D (run trial)" }[r.status] || "");

let me = null;

// ───────────────────────────── helpers: dialogs, toasts ─────────────────────
function toast(msg, isErr) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : ""); t.textContent = msg; t.setAttribute("role", "status");
  let box = document.querySelector(".toasts"); if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.appendChild(box); }
  box.appendChild(t); setTimeout(() => t.remove(), isErr ? 6000 : 3500);
}
// LDT-style dialog. options: {message, buttons:[{label,value,primary}], input:{placeholder, required}}
function dialog({ message, buttons, input }) {
  return new Promise((resolve) => {
    const back = document.createElement("div"); back.className = "modal-backdrop";
    back.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"><p class="modal-message">${esc(message)}</p>${input ? `<textarea rows="4" placeholder="${esc(input.placeholder || "")}"></textarea><p class="err" hidden></p>` : ""}<div class="modal-actions">${buttons.map((b, i) => `<button type="button" class="modal-btn${b.primary ? " primary" : ""}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
    document.body.appendChild(back);
    const ta = back.querySelector("textarea"), er = back.querySelector(".err");
    (ta || back.querySelector(".modal-btn.primary") || back.querySelector(".modal-btn")).focus();
    const close = (v) => { back.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("click", (e) => {
      if (e.target === back) return close(null);
      const b = e.target.closest("[data-i]"); if (!b) return;
      const btn = buttons[+b.dataset.i];
      if (ta && btn.value !== null && btn.value !== false && input.required && !ta.value.trim()) { er.textContent = "Add a comment first."; er.hidden = false; ta.focus(); return; }
      close(ta ? (btn.value === null || btn.value === false ? null : { value: btn.value, text: ta.value.trim() }) : btn.value);
    });
  });
}
const confirmBox = (message, ok = "OK") => dialog({ message, buttons: [{ label: "Cancel", value: false }, { label: ok, value: true, primary: true }] });

// ───────────────────────────── screens and menu ─────────────────────────────
const SCREENS = ["list-view", "editor-view", "users-view"];
function showScreen(id) {
  SCREENS.forEach((s) => ($(s).hidden = s !== id));
  if (id !== "editor-view") $("activity-panel").hidden = true;
  window.scrollTo(0, 0);
}
function buildMenu() {
  $$(".menu-mount").forEach((mount) => {
    mount.innerHTML = `<div class="menu-wrap"><button type="button" class="hamburger-btn" aria-label="Menu" aria-expanded="false"><span class="hamburger-bar"></span><span class="hamburger-bar"></span><span class="hamburger-bar"></span></button>
      <div class="hamburger-menu" hidden>
        <button type="button" class="hamburger-menu-item" data-go="list">Trial Reports</button>
        ${me?.role === "admin" ? `<button type="button" class="hamburger-menu-item" data-go="users">Users</button>` : ""}
        <a class="hamburger-menu-item" href="${LOAD_DIAGRAM_TOOL_URL}" target="_blank" rel="noopener">Load Diagram Tool ↗</a>
        ${DEMO ? `<button type="button" class="hamburger-menu-item" data-act="switch">Switch demo person</button><button type="button" class="hamburger-menu-item" data-act="reset">Reset demo data</button>` : ""}
        <button type="button" class="hamburger-menu-item" data-act="signout">Sign Out</button>
        <div class="hamburger-menu-note">${esc(me?.name || "")}${me?.role ? " · " + esc(ROLE_LABELS[me.role]) : ""}</div>
      </div></div>`;
  });
}
document.addEventListener("click", async (e) => {
  const ham = e.target.closest(".hamburger-btn");
  $$(".hamburger-menu").forEach((m) => { if (!ham || m !== ham.nextElementSibling) m.hidden = true; });
  if (ham) { const m = ham.nextElementSibling; m.hidden = !m.hidden; ham.setAttribute("aria-expanded", String(!m.hidden)); return; }
  const go = e.target.closest("[data-go]");
  if (go) { e.preventDefault(); return navigate(go.dataset.go === "users" ? "#/users" : "#/"); }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "signout" || act === "switch") { if (await leaveOk()) { E = null; history.replaceState(null, "", location.pathname + location.search); api.signOut(); } }
  if (act === "reset") { if (await confirmBox("Reset the demo to its sample reports? Everything you've entered in the demo is cleared.", "Reset")) api.reset(); }
});

// ───────────────────────────── routing ──────────────────────────────────────
// #/ list · #/new · #/r/<id> · #/users. Leaving a report with unsaved changes
// asks first (Save / Discard / Cancel), like the LDT's unsaved-changes dialog.
let lastHash = location.hash || "#/", ignoreHash = null;
function navigate(hash) { if ((location.hash || "#/") === hash) route(); else location.hash = hash; }
function setHashSilently(h) { lastHash = h; if (location.hash !== h) { ignoreHash = h; location.hash = h; } }
async function route() {
  if (!me) return;
  const h = location.hash || "#/";
  if (ignoreHash && h === ignoreHash) { ignoreHash = null; return; }
  if (E?.dirty && h !== lastHash) {
    if (!(await leaveOk())) { setHashSilently(lastHash); return; }
  }
  lastHash = h;
  if (h.startsWith("#/r/")) return openReport(h.slice(4));
  if (h === "#/new") return newReport();
  if (h === "#/users" && me.role === "admin") return showUsers();
  E = null;
  return showList();
}
window.addEventListener("hashchange", route);
async function leaveOk() {
  if (!E?.dirty) return true;
  const v = await dialog({ message: "You have unsaved changes to this report.", buttons: [{ label: "Cancel", value: null }, { label: "Discard", value: "discard" }, { label: "Save", value: "save", primary: true }] });
  if (v === "save") return save(false);
  if (v === "discard") { E.dirty = false; return true; }
  return false;
}
window.addEventListener("beforeunload", (e) => { if (E?.dirty) { e.preventDefault(); e.returnValue = ""; } });

// ───────────────────────────── auth gate (LDT) ──────────────────────────────
function initAuth() {
  const copy = $("auth-copy"), defaultCopy = copy.textContent, status = $("auth-status");
  const showStatus = (t, err) => { status.textContent = t; status.className = "auth-status" + (err ? " auth-status-error" : ""); status.hidden = false; };
  if (DEMO) {
    $("auth-form").hidden = true; $("auth-alt").hidden = true;
    copy.textContent = "Demo — pick who to sign in as.";
    $("demo-users").hidden = false;
    $("demo-users").innerHTML = api.users.map((u) => `<button type="button" class="btn-outline-sm" data-demo="${u.user_id}">${esc(u.full_name)} · ${esc(ROLE_LABELS[u.role])}</button>`).join("");
    $("demo-users").addEventListener("click", (e) => { const b = e.target.closest("[data-demo]"); if (b) api.signInAs(b.dataset.demo); });
    const badge = document.createElement("div"); badge.className = "demo-badge"; badge.textContent = "DEMO — SAVED IN THIS BROWSER ONLY"; document.body.appendChild(badge);
  }
  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("auth-email").value.trim(); if (!email) return;
    const b = $("auth-submit"); b.disabled = true; b.textContent = "Sending…"; status.hidden = true;
    try {
      await api.sendCode(email);
      $("auth-form").hidden = true; $("auth-alt").hidden = true; $("auth-code-form").hidden = false; $("auth-back").hidden = false;
      copy.textContent = `Enter the code we sent to ${email}.`; $("auth-code").value = ""; $("auth-code").focus();
    } catch (err) { showStatus(err.message || "Could not send the code. Try again.", true); }
    finally { b.disabled = false; b.textContent = "Send Code"; }
  });
  $("auth-code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("auth-verify"); b.disabled = true; b.textContent = "Verifying…"; status.hidden = true;
    try { await api.verifyCode($("auth-email").value.trim(), $("auth-code").value.trim()); }
    catch (err) { showStatus(err.message || "That code didn't work. Try again.", true); }
    finally { b.disabled = false; b.textContent = "Verify Code"; }
  });
  $("auth-back").addEventListener("click", () => { $("auth-code-form").hidden = true; $("auth-form").hidden = false; $("auth-alt").hidden = false; $("auth-back").hidden = true; copy.textContent = defaultCopy; status.hidden = true; });
  $("auth-microsoft").addEventListener("click", async () => { try { await api.signInMicrosoft(); } catch (err) { showStatus(err.message, true); } });
  const re = api.takeRedirectError(); if (re) showStatus(re, true);

  let wasSignedIn = false;
  api.onAuth(async (session) => {
    const signedIn = !!session;
    if (wasSignedIn && !signedIn) return window.location.reload();
    $("auth-gate").hidden = signedIn;
    if (signedIn && !wasSignedIn) {
      wasSignedIn = true;
      me = await api.me();
      buildMenu();
      // Email links use ?report=<id>, like the LDT's ?doc=<id>.
      const deep = params.get("report");
      if (deep) { history.replaceState(null, "", location.pathname + (DEMO ? "?demo=1" : "") + "#/r/" + deep); }
      route();
    }
  });
}

// ───────────────────────────── permissions (mirror the database) ─────────────
const canCreate = () => ["requester", "engineer", "tech_director", "ops_director", "admin"].includes(me?.role);
const isMine = (r) => r.created_by === me.id;
const canEdit = (r) => !r.id ? canCreate() : r.status === "draft" && !!me.role && me.role !== "spectator" && (isMine(r) || ["engineer", "admin"].includes(me.role));
const canComment = (r) => !!me.role && !(me.role === "requester" && !isMine(r));
const canDelete = (r) => r.id && (me.role === "admin" || (isMine(r) && r.status === "draft" && !r.submitted_at));
function actionsFor(r) {
  const a = [], ro = me.role, mine = isMine(r);
  if (!r.id) return a;
  if (r.status === "draft" && canEdit(r)) a.push({ action: "submit", label: r.last_action === "send_back" ? "Resubmit for Approval" : "Submit for Approval", msg: "Send this report to the Director of Technology for approval? It can't be edited while it's in review." });
  if (r.status === "tech_review" && ["tech_director", "admin"].includes(ro)) {
    a.push({ action: "approve", label: "Approve", msg: "Approve this trial plan and send it to the Director of Operations?" });
    a.push({ action: "approve", label: "Approve with Comments", comment: "required", msg: "Approve with comments. They go into the Activity log and the sign-off." });
    a.push({ action: "send_back", label: "Send Back with Comments", comment: "required", msg: "Send the report back to its author. Say what needs to change." });
  }
  if (r.status === "ops_review" && ["ops_director", "admin"].includes(ro)) {
    a.push({ action: "approve", label: "Approve (final)", msg: "Give final approval? The trial is then ready to run." });
    a.push({ action: "approve", label: "Approve with Comments", comment: "required", msg: "Give final approval with comments." });
    a.push({ action: "send_back", label: "Send Back to Technology", comment: "required", msg: "Send the report back to the Director of Technology. Say what needs to change." });
  }
  if ((r.status === "tech_review" && (mine || ["engineer", "admin"].includes(ro))) || (r.status === "ops_review" && ["tech_director", "admin"].includes(ro)))
    a.push({ action: "recall", label: "Recall Submission", msg: "Pull this report back while it's still waiting on the next person?" });
  if (r.status === "approved" && (mine || ["engineer", "admin"].includes(ro))) a.push({ action: "complete", label: "Mark Trial Completed", comment: "optional", msg: "Mark the trial as run and completed. Add any notes on how it went." });
  if (r.status === "approved" && ["tech_director", "admin"].includes(ro)) a.push({ action: "reopen", label: "Reopen for Edits", comment: "required", msg: "Reopen this approved report for edits? Both sign-offs are cleared and it goes through approval again." });
  if (["draft", "tech_review", "ops_review"].includes(r.status) && (mine || ro === "admin")) a.push({ action: "cancel", label: "Cancel Report", comment: "optional", msg: "Cancel this report? It stays in the list as Cancelled, with its history." });
  return a;
}
function needsAttention(r) {
  if (!me?.role) return false;
  if (r.status === "draft" && ["send_back", "reopen"].includes(r.last_action) && (isMine(r) || me.role === "engineer")) return true;
  if (r.status === "tech_review" && me.role === "tech_director") return true;
  if (r.status === "ops_review" && me.role === "ops_director") return true;
  if (r.status === "approved" && (isMine(r) || me.role === "engineer")) return true;
  return false;
}

// ───────────────────────────── Reports list ─────────────────────────────────
let LIST = [];
async function showList() {
  showScreen("list-view");
  $("btn-new").hidden = !canCreate();
  const rows = $("list-rows");
  if (!me.role) { rows.innerHTML = `<p class="docs-empty">Your account isn't set up for Trial Reports yet. Ask an admin to add you.</p>`; return; }
  rows.innerHTML = `<p class="docs-empty">Loading…</p>`;
  try { LIST = await api.listReports(); renderList(); }
  catch (e) { rows.innerHTML = `<p class="docs-empty">Couldn't load reports: ${esc(e.message)}</p>`; }
}
function renderList() {
  const q = $("list-search").value.trim().toLowerCase(), f = $("list-filter").value;
  const match = (r) => {
    if (f === "open" && ["completed", "cancelled"].includes(r.status)) return false;
    if (f === "review" && !["tech_review", "ops_review"].includes(r.status)) return false;
    if (!["all", "open", "review"].includes(f) && r.status !== f) return false;
    if (!q) return true;
    return [r.title, r.requester_name, r.project, statusLabel(r), ...r.trials.map((t) => t.trial_no)].join(" ").toLowerCase().includes(q);
  };
  const vis = LIST.filter(match), att = vis.filter(needsAttention), rest = vis.filter((r) => !needsAttention(r));
  const row = (r, a) => `<div class="docs-table-row${a ? " docs-table-row-attention" : ""}" data-open="${r.id}" tabindex="0" role="link">
    <span class="docs-col docs-col-title" title="${esc(r.title)}">${esc(r.title || "Untitled report")}</span>
    <span class="docs-col docs-col-trials">${r.trials.map((t) => `<span class="trial-chip">${esc(t.trial_no || "—")}</span>`).join("") || "—"}</span>
    <span class="docs-col docs-col-lines">${esc([...new Set(r.trials.map(lineShort))].join(", "))}</span>
    <span class="docs-col docs-col-date">${fmtDate(r.request_date)}</span>
    <span class="docs-col docs-col-status">${esc(statusLabel(r))}</span>
    <span class="docs-col docs-col-waiting">${esc(waitingOn(r))}</span></div>`;
  $("list-rows").innerHTML =
    (att.length ? `<div class="docs-attention-banner">Needs your attention</div>${att.map((r) => row(r, true)).join("")}<div class="docs-attention-divider"></div>` : "") +
    (rest.map((r) => row(r, false)).join("") || (att.length ? "" : `<p class="docs-empty">${LIST.length ? "No reports match." : canCreate() ? "No trial reports yet. Start one with + New Trial Report." : "No trial reports to show yet."}</p>`));
}
$("list-search").addEventListener("input", renderList);
$("list-filter").addEventListener("change", renderList);
$("btn-new").addEventListener("click", () => navigate("#/new"));
$("list-rows").addEventListener("click", (e) => { const r = e.target.closest("[data-open]"); if (r) navigate("#/r/" + r.dataset.open); });
$("list-rows").addEventListener("keydown", (e) => { if (e.key === "Enter") { const r = e.target.closest("[data-open]"); if (r) navigate("#/r/" + r.dataset.open); } });

// ───────────────────────────── Report editor ────────────────────────────────
let E = null; // { report, trials, activity, removed, cur, dirty, ro }
const blankData = () => ({ bg: "", safety: "", goals: "", deliv: "", crit: "", tests: [{}], samples: [{}], ships: [], disp: {} });
const newTrial = () => ({ id: null, line: null, line_no: null, lamp_n: 4, planned_date: "", shift: "", duration: "", crew: "", conditions: [{ name: "" }], seq: null, seq_day: null, trial_no: null });

function newReport() {
  if (!canCreate()) return navigate("#/");
  E = { report: { id: null, title: "", status: "draft", requester_name: me.role === "requester" ? me.name : "", request_date: today(), rd_lead: "", project: "", part_number: "", data: blankData(), created_by: me.id }, trials: [newTrial()], activity: [], removed: [], cur: 0, dirty: false };
  renderEditor();
}
async function openReport(id, keepTab) {
  showScreen("editor-view");
  try {
    const d = await api.getReport(id);
    d.report.data = { ...blankData(), ...(d.report.data || {}) };
    if (!d.trials.length) d.trials = [newTrial()];
    const cur = keepTab && E?.report.id === id ? Math.min(E.cur, d.trials.length - 1) : 0;
    E = { ...d, removed: [], cur, dirty: false };
    renderEditor();
  } catch (e) { toast(e.message, true); navigate("#/"); }
}

const T = () => E.trials[E.cur];
// Live trial number: the ending (01, 02…) comes from the database on save;
// until then it shows ##. Line and initials update as you type.
function trialNo(t) {
  const r = E.report;
  const end = t.seq && t.seq_day === r.request_date ? pad(t.seq) : "##";
  return [lineCode(t), initials(r.requester_name) || "??", mmddyy(r.request_date), end].join("-");
}
const setDirty = () => { if (!E.dirty) { E.dirty = true; renderSideStatus(); } };

function renderEditor() {
  showScreen("editor-view");
  E.ro = !canEdit(E.report);
  $("editor-view").classList.toggle("is-readonly", E.ro);
  renderSideFields(); renderSideStatus(); renderSideNav(); renderHeader(); renderBody(); renderTabs(); renderToolbar();
  $("comment-form").hidden = !E.report.id || !canComment(E.report);
  if (!$("activity-panel").hidden) renderActivity();
  lockIfReadonly();
}
function lockIfReadonly() {
  $$("#editor-view .panel-left input, #editor-view .panel-left select, #sheet-body input, #sheet-body select, #sheet-body textarea, #sheet-body .rep-del, #sheet-body .rep-add, #sheet-body .ch button, #sheet-body #btn-add-cond").forEach((el) => (el.disabled = E.ro));
}

const SIDE = [["title", "Report Title", "text", "Required"], ["requester_name", "Requested By", "text", "First and last name"], ["request_date", "Request Date", "date"], ["rd_lead", "R&D Lead", "text"], ["project", "Project / Customer", "text"], ["part_number", "Product / Part Number", "text"]];
function renderSideFields() {
  $("side-fields").innerHTML = SIDE.map(([k, l, type, ph]) => `<div class="field" data-field="${k}"><label for="sf-${k}">${l}</label><input id="sf-${k}" type="${type}" data-r="${k}" value="${esc(E.report[k] || "")}" placeholder="${esc(ph || "")}" /></div>`).join("");
}
function renderSideStatus() {
  const r = E.report;
  const nums = E.trials.map(trialNo);
  $("side-status").innerHTML = `<div><b>${esc(r.id ? statusLabel(r) : "New report")}</b>${waitingOn(r) && r.id ? ` · waiting on ${esc(waitingOn(r))}` : ""}</div>
    <div class="muted">${nums.map(esc).join("<br>")}</div>
    ${nums.some((n) => n.endsWith("##")) ? `<div class="muted">## is filled in when the report is saved.</div>` : ""}
    ${E.ro ? `<div class="muted">${r.status === "draft" ? "View only." : "Locked while " + esc(statusLabel(r).toLowerCase()) + "."}</div>` : `<div class="save-state${E.dirty ? " dirty" : ""}">${E.dirty ? "Unsaved changes" : r.id ? "All changes saved" : "Not saved yet"}</div>`}`;
}
const SECTIONS = [["bg", "Background"], ["goals", "Trial Goals & Deliverables"], ["trials", "Trials"], ["tests", "Testing After Trial"], ["samples", "Samples Needed"], ["ships", "Sample Delivery"], ["disp", "Material Disposition"], ["sign", "Sign-off"]];
function renderSideNav() {
  const count = { trials: E.trials.length, tests: E.report.data.tests.length, samples: E.report.data.samples.length, ships: E.report.data.ships.length };
  $("side-nav").innerHTML = SECTIONS.map(([k, l]) => `<a href="#sec-${k}" data-jump="${k}">${l}<small>${count[k] ?? ""}</small></a>`).join("");
}
$("side-nav").addEventListener("click", (e) => { const a = e.target.closest("[data-jump]"); if (!a) return; e.preventDefault(); $("sec-" + a.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); });

function renderHeader() {
  const r = E.report;
  $("sheet-header").innerHTML = `<span class="v title-v">${esc(r.title || "Untitled Trial Report")}</span><span class="v">${esc(r.requester_name || "—")}</span><span class="v">${E.trials.map((t) => esc(trialNo(t))).join(", ")}</span><span class="v">${esc(r.id ? statusLabel(r) : "Draft")}</span><span class="v">${fmtDate(r.request_date)}</span>
    <div class="sheet-divider"></div><span class="l">R&amp;D Pre-Trial Report</span><span class="l">Requested By</span><span class="l">Trial Numbers</span><span class="l">Status</span><span class="l">Request Date</span>`;
}

const ta = (path, label, ph = "", rows = 3) => `<div class="sheet-block"><label class="sheet-label" for="d-${path}">${label}</label><textarea id="d-${path}" class="sheet-textarea" rows="${rows}" data-d="${path}" placeholder="${esc(ph)}">${esc(getPath(E.report.data, path))}</textarea></div>`;
const fld = (attrs, label, value, type = "text") => `<div class="field"><label>${label}</label><input type="${type}" ${attrs} value="${esc(value ?? "")}" /></div>`;
const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o) ?? "";
const setPath = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };

function renderBody() {
  const D = E.report.data;
  $("sheet-body").innerHTML = `
  <section class="sheet-section" id="sec-bg"><h2>Background</h2><p class="sheet-hint">Why these trials are being run and what has been learned so far.</p>
    ${ta("bg", "Background and history", "", 4)}${ta("safety", "Safety, quality or special handling notes")}</section>
  <section class="sheet-section" id="sec-goals"><h2>Trial Goals &amp; Deliverables</h2><p class="sheet-hint">What success looks like and what will be handed over at the end.</p>
    ${ta("goals", "Trial goals / objectives", "", 4)}${ta("deliv", "Deliverables", "e.g. rolls for customer qualification, data report, process window")}${ta("crit", "Success criteria")}</section>
  <section class="sheet-section" id="sec-trials"><h2>Trials</h2><p class="sheet-hint">One trial per line run. Pick a trial with the tabs above the report. Each column in the settings table is one condition or material; "Copy" duplicates a column so you only change what differs.</p>
    ${E.trials.map((t, i) => `<div class="trial-panel${i === E.cur ? " active" : ""}${t.conditions.length > 4 ? " wide" : ""}" data-panel="${i}"><h3 class="print-only">Trial ${i + 1} · ${esc(trialNo(t))} · ${esc(lineLabel(t))}</h3>${trialPanel(t, i)}</div>`).join("")}</section>
  <section class="sheet-section" id="sec-tests"><h2>Testing Required After Trial</h2><p class="sheet-hint">Each test, the conditions it applies to and who runs it.</p><div id="rep-tests">${rep("tests")}</div></section>
  <section class="sheet-section" id="sec-samples"><h2>Samples Needed</h2><p class="sheet-hint">Number and size of samples to pull from each condition.</p><div id="rep-samples">${rep("samples")}</div></section>
  <section class="sheet-section" id="sec-ships"><h2>Sample Delivery</h2><p class="sheet-hint">A recipient for every location samples must be sent to. Leave empty if samples stay on site.</p><div id="rep-ships">${rep("ships")}</div></section>
  <section class="sheet-section" id="sec-disp"><h2>Material Disposition After Trial</h2><p class="sheet-hint">Default for all trial material. A different choice can be set per condition in the settings table.</p>
    <div class="disp">${DISP.map((d) => `<label><input type="radio" name="disp-choice" value="${esc(d)}" data-d="disp.choice"${D.disp?.choice === d ? " checked" : ""} />${esc(d)}</label>`).join("")}</div>
    <div class="sheet-grid">${fld('data-d="disp.loc"', "Hold / storage location", D.disp?.loc)}${fld('data-d="disp.until"', "Hold until", D.disp?.until, "date")}${fld('data-d="disp.label"', "Labeling requirements", D.disp?.label)}${fld('data-d="disp.who"', "Responsible for disposition", D.disp?.who)}</div>
    ${ta("disp.notes", "Disposition notes")}</section>
  <section class="sheet-section" id="sec-sign"><h2>Sign-off</h2><p class="sheet-hint">Filled in when each director approves in the app, with their name and the time. No typed signatures.</p>
    <div class="signs">${signCard("Director of Technology", E.report.sign_tech, E.report.status === "tech_review")}${signCard("Director of Operations", E.report.sign_ops, E.report.status === "ops_review")}</div></section>`;
}
function signCard(title, s, waiting) {
  if (!s) return `<div class="sign-card"><h3>${title}</h3><div class="muted">${waiting ? "Waiting for approval." : "Not signed yet."}</div></div>`;
  return `<div class="sign-card is-signed"><h3>${title} ✓</h3><div class="sig">${esc(s.name)}</div><div class="muted">${esc(s.decision)} · ${fmtWhen(s.at)}</div>${s.comment ? `<div class="cmt">${esc(s.comment)}</div>` : ""}</div>`;
}
function trialPanel(t, i) {
  return `<div class="line-cards" role="radiogroup" aria-label="Line for trial ${i + 1}">${Object.entries(LINES).map(([k, L]) => `<label class="line-card"><input type="radio" name="line-${i}" value="${k}" data-t="line" data-ti="${i}"${t.line === k ? " checked" : ""} /><span class="check-mark">Selected</span><b>${L.name}</b>${L.sub ? `<small>${L.sub}</small>` : "<small>&nbsp;</small>"}${ART[k]}</label>`).join("")}</div>
  <div class="sheet-grid">
    ${t.line === "tp" ? `<div class="field${!t.line_no ? " is-missing" : ""}"><label>Line number</label><select data-t="line_no" data-ti="${i}"><option value="">choose</option>${["1", "2", "3", "5"].map((o) => `<option${t.line_no === o ? " selected" : ""}>${o}</option>`).join("")}</select></div>` : ""}
    ${t.line === "psa" ? fld(`data-t="lamp_n" data-ti="${i}" inputmode="numeric"`, "UV lamps installed on line", t.lamp_n) : ""}
    ${fld(`data-t="planned_date" data-ti="${i}"`, "Planned trial date", t.planned_date, "date")}
    ${fld(`data-t="shift" data-ti="${i}"`, "Shift / start time", t.shift)}
    ${fld(`data-t="duration" data-ti="${i}" placeholder="e.g. 4 hours"`, "Estimated duration", t.duration)}
    ${fld(`data-t="crew" data-ti="${i}"`, "Operators / crew", t.crew)}
  </div>
  <div class="matrix-bar"><button type="button" class="btn-outline-sm" id="btn-add-cond" data-addcond="${i}"${t.line ? "" : " disabled"}>+ Add Condition</button><span class="hint">Conditions are numbered by trial, e.g. ${esc(trialNo(t).split("-").pop())}-A. Ranges such as 340–360 are fine.</span></div>
  <div class="mx-scroll" id="mx-${i}">${matrix(t, i)}</div>`;
}
function cell(fd, c, ci, ti) {
  if (fd.t === "calc") return `<span class="calc">${esc(fd.fn(c))}</span>`;
  if (!shown(fd, c)) return '<span class="na">n/a</span>';
  const v = c[fd.k] ?? "", a = `data-c="${ci}" data-f="${fd.k}" data-ti="${ti}" aria-label="${esc(fd.l)}, condition ${letter(ci)}"`;
  if (fd.t === "s") return `<select ${a}><option value=""></option>${fd.o.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  return `<input ${a} value="${esc(v)}"${fd.t === "n" ? ' inputmode="decimal"' : ""} />`;
}
function matrix(t, ti) {
  const gs = groupsOf(t), n = t.conditions.length;
  if (!gs.length) return '<p class="mx-empty">Choose a line above to load its stations and settings.</p>';
  let h = '<table class="mx"><thead><tr><th class="pl">Parameter</th><th class="un">Unit</th>' + t.conditions.map((c, i) => `<th><div class="ch"><span>${letter(i)}</span><button type="button" data-dup="${i}" data-ti="${ti}">Copy</button>${n > 1 ? `<button type="button" data-delc="${i}" data-ti="${ti}" aria-label="Remove condition ${letter(i)}">×</button>` : ""}</div></th>`).join("") + "</tr></thead><tbody>";
  for (const [g, fs] of gs) {
    h += `<tr class="gr"><th colspan="${n + 2}"><span>${esc(g)}</span></th></tr>`;
    for (const fd of fs) h += `<tr><th class="pl">${esc(fd.l)}</th><td class="un">${esc(fd.u)}</td>${t.conditions.map((c, i) => `<td>${cell(fd, c, i, ti)}</td>`).join("")}</tr>`;
  }
  return h + "</tbody></table>";
}
function rep(name) {
  const rows = E.report.data[name];
  const addLabel = { tests: "+ Add Test", samples: "+ Add Sample Request", ships: "+ Add Recipient" }[name];
  return (rows.map((r, i) => `<div class="rep-row">${REP[name].map(([k, l, t]) => t === "area"
    ? `<div class="sheet-block wide" style="margin:0"><label class="sheet-label">${l}</label><textarea class="sheet-textarea" rows="2" data-rep="${name}" data-i="${i}" data-f="${k}">${esc(r[k])}</textarea></div>`
    : `<div class="field"><label>${l}</label><input type="${t === "date" ? "date" : t === "email" ? "email" : "text"}"${t === "n" ? ' inputmode="numeric"' : ""} data-rep="${name}" data-i="${i}" data-f="${k}" value="${esc(r[k])}" /></div>`).join("")}
    <button type="button" class="link-btn rep-del" data-repdel="${name}" data-i="${i}">Remove</button></div>`).join("") || `<p class="rep-empty">None added.</p>`) +
    `<button type="button" class="btn-outline-sm rep-add" data-repadd="${name}">${addLabel}</button>`;
}
function renderTabs() {
  const ro = E.ro;
  $("trial-tabs").innerHTML = E.trials.map((t, i) => `<button type="button" class="load-pattern-tab${i === E.cur ? " active" : ""}" data-tab="${i}" aria-pressed="${i === E.cur}">Trial ${i + 1}<small>${esc(trialNo(t))}</small></button>`).join("") +
    (ro ? "" : `<button type="button" class="btn-outline-sm load-pattern-add" id="btn-add-trial"><span class="docs-new-plus">+</span> Add Trial</button>`) +
    (!ro && E.trials.length > 1 ? `<button type="button" class="load-pattern-remove-btn" id="btn-del-trial">Remove Trial ${E.cur + 1}</button>` : "");
}
function refreshNumbers() { renderTabs(); renderHeader(); renderSideStatus(); }
function renderTrialPanel(i) {
  const p = $$(`[data-panel="${i}"]`)[0]; if (!p) return;
  p.innerHTML = `<h3 class="print-only">Trial ${i + 1} · ${esc(trialNo(E.trials[i]))} · ${esc(lineLabel(E.trials[i]))}</h3>` + trialPanel(E.trials[i], i); lockIfReadonly();
}
function renderMatrix(i, focusEl) {
  const id = focusEl?.dataset ? `[data-c="${focusEl.dataset.c}"][data-f="${focusEl.dataset.f}"][data-ti="${i}"]` : null;
  $("mx-" + i).innerHTML = matrix(E.trials[i], i); lockIfReadonly();
  $$(`[data-panel="${i}"]`)[0]?.classList.toggle("wide", E.trials[i].conditions.length > 4);
  if (id) document.querySelector(id)?.focus();
}

// Toolbar: Save · status/approval button · Activity · Copy · Print
const ICON_SAVE = '<svg viewBox="0 0 18 18"><path d="M3 2h9.5L16 5.5V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1.5 1.5v3.5h7V3.5h-7ZM5 10.5V14.5h8v-4H5Z" fill="currentColor"/></svg>';
const ICON_PDF = '<svg viewBox="0 0 19.2 19.2"><g transform="translate(1.6 1.6)"><path d="M14 11V14H2V11H0V14C0 15.1 0.9 16 2 16H14C15.1 16 16 15.1 16 14V11H14ZM13 7L11.59 5.59L9 8.17V0H7V8.17L4.41 5.59L3 7L8 12L13 7Z" fill="currentColor"/></g></svg>';
const ICON_ACT = '<svg viewBox="0 0 16 16" fill="none"><path d="M3.73 13.28l1.02-.81c.21-.17.32-.26.44-.32.11-.05.22-.09.34-.12.13-.03.27-.03.55-.03h5.79c.75 0 1.12 0 1.4-.15.25-.13.46-.33.58-.58.15-.29.15-.66.15-1.4V4.8c0-.75 0-1.12-.15-1.41a1.33 1.33 0 0 0-.58-.58c-.28-.15-.66-.15-1.4-.15H4.13c-.75 0-1.12 0-1.4.15-.25.13-.46.33-.58.58C2 3.68 2 4.05 2 4.8v7.65c0 .71 0 1.07.15 1.25.12.16.32.25.52.25.23 0 .51-.22 1.06-.67Z" stroke="currentColor" stroke-width="1.375" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const mainActions = (r) => actionsFor(r).filter((a) => a.action !== "cancel");
function renderToolbar() {
  const r = E.report, acts = mainActions(r), cancel = actionsFor(r).find((a) => a.action === "cancel");
  const statusBtnLabel = acts.length === 1 ? acts[0].label : acts.length > 1 ? statusLabel(r) + " ▾" : r.id ? statusLabel(r) : "Submit for Approval";
  const comments = E.activity.filter((a) => a.kind === "comment").length;
  $("toolbar").innerHTML = `
    ${E.ro ? "" : `<button type="button" class="btn-outline-sm" id="btn-save">${ICON_SAVE} Save</button>`}
    <div class="menu-wrap"><button type="button" class="btn-outline-sm${acts.length ? " is-solid" : ""}" id="btn-status"${acts.length || !r.id ? "" : " disabled"}>${esc(statusBtnLabel)}</button><div class="hamburger-menu up left" id="status-menu" hidden></div></div>
    <button type="button" class="btn-outline-sm no-demo" id="btn-print" title="Opens the print dialog. Choose Save as PDF to get a file.">${ICON_PDF} Print / PDF</button>
    <button type="button" class="btn-outline-sm" id="btn-activity"${r.id ? "" : " disabled"}>${ICON_ACT} Activity${comments ? ` (${comments})` : ""}</button>
    <div class="menu-wrap"><button type="button" class="btn-outline-sm" id="btn-more">More ▾</button><div class="hamburger-menu up" id="more-menu" hidden>
      <button type="button" class="hamburger-menu-item" data-more="text">Copy Report as Text</button>
      <button type="button" class="hamburger-menu-item" data-more="tsv">Copy Settings for Excel</button>
      ${canCreate() ? `<button type="button" class="hamburger-menu-item" data-more="dup">Duplicate as New Report</button>` : ""}
      ${cancel ? `<button type="button" class="hamburger-menu-item" data-more="cancel">Cancel Report</button>` : ""}
      ${canDelete(r) ? `<button type="button" class="hamburger-menu-item" data-more="delete">Delete Report</button>` : ""}
    </div></div>`;
}

// Validation shared by Save and Submit (the database checks the same on submit).
function missingForSubmit() {
  const m = [];
  if (!E.report.title.trim()) m.push("Report Title");
  if (!E.report.requester_name.trim()) m.push("Requested By");
  E.trials.forEach((t, i) => { if (!t.line) m.push(`Trial ${i + 1}: line`); else if (t.line === "tp" && !t.line_no) m.push(`Trial ${i + 1}: line number`); });
  return m;
}
function markMissing() {
  $$("#side-fields .field").forEach((f) => f.classList.toggle("is-missing", ["title", "requester_name"].includes(f.dataset.field) && !E.report[f.dataset.field].trim()));
}
async function save(updateUrl = true) {
  if (!E || E.ro) return true;
  if (!E.report.title.trim()) { markMissing(); toast("Add a report title before saving.", true); $("sf-title").focus(); return false; }
  const b = $("btn-save"); if (b) { b.disabled = true; }
  try {
    const wasNew = !E.report.id, cur = E.cur;
    const d = await api.saveReport(E.report, E.trials, E.removed);
    d.report.data = { ...blankData(), ...(d.report.data || {}) };
    E = { ...d, removed: [], cur: Math.min(cur, d.trials.length - 1), dirty: false };
    if (wasNew && updateUrl) setHashSilently("#/r/" + E.report.id);
    renderEditor();
    toast("Saved. " + E.trials.map((t) => t.trial_no).join(", "));
    return true;
  } catch (e) { toast(e.message, true); if (b) b.disabled = false; return false; }
}
async function runAction(a) {
  const r = E.report;
  if (a.action === "submit") {
    const miss = missingForSubmit();
    if (miss.length) { markMissing(); await dialog({ message: "Fill these in before submitting:\n• " + miss.join("\n• "), buttons: [{ label: "OK", value: true, primary: true }] }); return; }
  }
  const res = a.comment
    ? await dialog({ message: a.msg, input: { required: a.comment === "required", placeholder: a.comment === "required" ? "Comment (required)" : "Comment (optional)" }, buttons: [{ label: "Cancel", value: null }, { label: a.label, value: true, primary: true }] })
    : (await confirmBox(a.msg, a.label)) && { text: "" };
  if (!res) return;
  if (E.dirty && !(await save())) return;
  try {
    await api.transition(r.id, a.action, res.text || "");
    const who = { submit: "The Director of Technology has been emailed.", approve: r.status === "tech_review" ? "The Director of Operations has been emailed." : "The author and spectators have been emailed.", send_back: "They've been emailed.", reopen: "The author has been emailed." }[a.action] || "";
    toast(`${a.label} — done. ${DEMO ? "" : who}`);
    await openReport(r.id, true);
  } catch (e) { toast(e.message, true); }
}

// Editor events
document.addEventListener("input", (e) => {
  if (!E || $("editor-view").hidden) return;
  const el = e.target, d = el.dataset;
  if (el.type === "radio" && !el.checked) return;
  if (d.r) {
    E.report[d.r] = el.value;
    el.closest(".field")?.classList.remove("is-missing");
    if (["requester_name", "request_date"].includes(d.r)) refreshNumbers();
    if (d.r === "title") renderHeader();
  } else if (d.d) setPath(E.report.data, d.d, el.value);
  else if (d.t) {
    const i = +d.ti, t = E.trials[i];
    t[d.t] = d.t === "lamp_n" ? el.value : el.value || null;
    if (d.t === "line") { if (el.value !== "tp") t.line_no = null; renderTrialPanel(i); refreshNumbers(); document.querySelector(`[name="line-${i}"]:checked`)?.focus(); }
    else if (d.t === "line_no") { renderTrialPanel(i); refreshNumbers(); }
    else if (d.t === "lamp_n") renderMatrix(i);
  } else if (d.c !== undefined) {
    const i = +d.ti; E.trials[i].conditions[+d.c][d.f] = el.value;
    if (el.tagName === "SELECT") renderMatrix(i, el);
  } else if (d.rep) E.report.data[d.rep][+d.i][d.f] = el.value;
  else return;
  setDirty();
});
document.addEventListener("click", async (e) => {
  if (!E || $("editor-view").hidden) return;
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (b.id !== "btn-status") $("status-menu") && ($("status-menu").hidden = true);
  if (b.id !== "btn-more") $("more-menu") && ($("more-menu").hidden = true);
  if (d.tab !== undefined) { E.cur = +d.tab; $$(".trial-panel").forEach((p) => p.classList.toggle("active", +p.dataset.panel === E.cur)); renderTabs(); $("sec-trials").scrollIntoView({ block: "start" }); return; }
  if (E.ro && !["btn-status", "btn-activity", "btn-more"].includes(b.id) && !d.more && d.acti === undefined) return;
  if (b.id === "btn-add-trial") { E.trials.push(newTrial()); E.cur = E.trials.length - 1; renderBody(); renderTabs(); refreshNumbers(); renderSideNav(); setDirty(); lockIfReadonly(); $("sec-trials").scrollIntoView({ block: "start" }); }
  else if (b.id === "btn-del-trial") {
    if (!b.classList.contains("confirming")) { b.classList.add("confirming"); b.textContent = `Click again to remove Trial ${E.cur + 1}`; return; }
    const [t] = E.trials.splice(E.cur, 1); if (t.id) E.removed.push(t.id);
    E.cur = Math.max(0, E.cur - 1); renderBody(); renderTabs(); refreshNumbers(); renderSideNav(); setDirty(); lockIfReadonly();
  }
  else if (d.addcond !== undefined) { const i = +d.addcond; E.trials[i].conditions.push({ name: "" }); renderMatrix(i); setDirty(); }
  else if (d.dup !== undefined) { const C = E.trials[+d.ti].conditions; C.splice(+d.dup + 1, 0, { ...C[+d.dup], name: "" }); renderMatrix(+d.ti); setDirty(); }
  else if (d.delc !== undefined) { E.trials[+d.ti].conditions.splice(+d.delc, 1); renderMatrix(+d.ti); setDirty(); }
  else if (d.repadd) { E.report.data[d.repadd].push({}); $("rep-" + d.repadd).innerHTML = rep(d.repadd); renderSideNav(); setDirty(); $(`#rep-${d.repadd} .rep-row:last-of-type input`)?.focus(); }
  else if (d.repdel) { E.report.data[d.repdel].splice(+d.i, 1); $("rep-" + d.repdel).innerHTML = rep(d.repdel); renderSideNav(); setDirty(); }
  else if (b.id === "btn-save") save();
  else if (b.id === "btn-status") {
    const acts = mainActions(E.report);
    if (!E.report.id) { if (await save()) { const a = actionsFor(E.report).find((x) => x.action === "submit"); if (a) runAction(a); } return; }
    if (acts.length === 1) return runAction(acts[0]);
    const m = $("status-menu"); m.innerHTML = acts.map((a, i) => `<button type="button" class="hamburger-menu-item" data-acti="${i}">${esc(a.label)}</button>`).join(""); m.hidden = !m.hidden;
  }
  else if (d.acti !== undefined) { $("status-menu").hidden = true; runAction(mainActions(E.report)[+d.acti]); }
  else if (d.more === "cancel") { const a = actionsFor(E.report).find((x) => x.action === "cancel"); if (a) runAction(a); }
  else if (b.id === "btn-activity") { $("activity-panel").hidden = !$("activity-panel").hidden; if (!$("activity-panel").hidden) renderActivity(); }
  else if (b.id === "btn-more") { $("more-menu").hidden = !$("more-menu").hidden; }
  else if (d.more === "text") copy(reportText(), "Report copied. Paste into email, Word or Teams.");
  else if (d.more === "tsv") copy(tsv(), "Settings copied for every trial. Paste into Excel.");
  else if (b.id === "btn-print") printReport();
  else if (d.more === "dup") { if (!(await leaveOk())) return; duplicate(); }
  else if (d.more === "delete") {
    if (!(await confirmBox("Delete this report and its history permanently? This can't be undone.", "Delete"))) return;
    try { await api.deleteReport(E.report.id); E = null; toast("Report deleted."); navigate("#/"); } catch (err) { toast(err.message, true); }
  }
});
function duplicate() {
  const src = E;
  E = { report: { ...src.report, id: null, status: "draft", last_action: null, sign_tech: null, sign_ops: null, submitted_at: null, created_by: me.id, title: (src.report.title || "") + " (copy)", request_date: today(), requester_name: me.role === "requester" ? me.name : src.report.requester_name, data: JSON.parse(JSON.stringify(src.report.data)) },
    trials: src.trials.map((t) => ({ ...newTrial(), line: t.line, line_no: t.line_no, lamp_n: t.lamp_n, shift: t.shift, duration: t.duration, crew: t.crew, conditions: JSON.parse(JSON.stringify(t.conditions)) })), activity: [], removed: [], cur: 0, dirty: true };
  setHashSilently("#/new");
  renderEditor(); toast("Copied into a new draft. Save it to get new trial numbers.");
}

// ───────────────────────────── Activity panel ───────────────────────────────
const EVENT_TITLES = { created: "Created the report", submit: "Submitted for approval", approved_tech: "Approved — Director of Technology", approved_ops: "Final approval — Director of Operations. Ready to run.", send_back: "Sent back", recall: "Recalled the submission", reopen: "Reopened for edits", complete: "Marked the trial completed", cancel: "Cancelled the report" };
function renderActivity() {
  const items = [...E.activity].reverse();
  $("activity-list").innerHTML = items.map((a) => a.kind === "comment"
    ? `<div class="comment-item"><div class="comment-item-meta">${esc(a.actor_name)} · ${fmtWhen(a.at)}</div><div class="comment-item-body">${esc(a.body)}</div></div>`
    : `<div class="comment-item comment-event comment-event-${esc(a.kind)}"><div class="comment-item-meta">${esc(a.actor_name)} · ${fmtWhen(a.at)}</div><div class="comment-event-title">${esc(EVENT_TITLES[a.kind] || a.kind)}</div>${a.body ? `<div class="comment-item-body">${esc(a.body)}</div>` : ""}</div>`).join("") || `<p class="activity-empty">No activity yet.</p>`;
}
$("btn-activity-close").addEventListener("click", () => ($("activity-panel").hidden = true));
$("comment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = $("comment-input").value.trim(); if (!body) return;
  try { await api.comment(E.report.id, body); $("comment-input").value = ""; const d = await api.getReport(E.report.id); E.activity = d.activity; renderActivity(); renderToolbar(); }
  catch (err) { toast(err.message, true); }
});

// ───────────────────────────── copy / export ────────────────────────────────
function copy(txt, ok) { navigator.clipboard.writeText(txt).then(() => toast(ok), () => toast("Copy was blocked by the browser.", true)); }
const val = (fd, c) => (fd.t === "calc" ? fd.fn(c) : c[fd.k] ?? "");
function reportText() {
  const R = E.report, I = R.data, o = [];
  const ln = (a, b) => { if (b) o.push(a + ": " + b); }, sec = (h, b) => { if (b) o.push("", h.toUpperCase(), b); };
  o.push("R&D PRE-TRIAL REPORT", "====================");
  ln("Report title", R.title); ln("Trial numbers", E.trials.map(trialNo).join(", ")); ln("Status", R.id ? statusLabel(R) : "Draft");
  ln("Requested by", R.requester_name); ln("Request date", R.request_date); ln("R&D lead", R.rd_lead); ln("Project / customer", R.project); ln("Product / part", R.part_number);
  sec("Background", I.bg); sec("Safety / special handling", I.safety); sec("Trial goals", I.goals); sec("Deliverables", I.deliv); sec("Success criteria", I.crit);
  E.trials.forEach((t) => {
    const no = trialNo(t);
    o.push("", "TRIAL " + no + " – " + lineLabel(t));
    ln("Planned date", t.planned_date); ln("Shift / start", t.shift); ln("Duration", t.duration); ln("Crew", t.crew);
    if (LINES[t.line]) t.conditions.forEach((c, i) => {
      o.push("", `Condition ${no.split("-").pop()}-${letter(i)}${c.name ? " – " + c.name : ""}`);
      for (const [g, fs] of groupsOf(t)) { const r = fs.filter((fd) => fd.k !== "name" && shown(fd, c) && val(fd, c)).map((fd) => `    ${fd.l}: ${val(fd, c)}${fd.u && fd.t !== "s" && fd.t !== "x" ? " " + fd.u : ""}`); if (r.length) o.push("  " + g, ...r); }
    });
  });
  const rl = (h, name, fmt) => { const rs = I[name].filter((r) => Object.values(r).some(Boolean)); if (rs.length) { o.push("", h.toUpperCase()); rs.forEach((r, i) => o.push(`${i + 1}. ` + fmt(r))); } };
  rl("Testing required after trial", "tests", (r) => [r.test, r.method && "(" + r.method + ")", r.conds && "conditions: " + r.conds, r.n && r.n + " samples/condition", r.who && "by " + r.who, r.due && "due " + r.due].filter(Boolean).join(", "));
  rl("Samples needed", "samples", (r) => [r.n && r.n + " samples", r.size, r.conds && "from " + r.conds, r.use && "for " + r.use].filter(Boolean).join(", "));
  rl("Sample delivery", "ships", (r) => [r.name, r.email, r.n && r.n + " samples", r.size, r.conds && "conditions " + r.conds, r.how, r.addr && "\n   Address: " + r.addr.replace(/\n/g, ", ")].filter(Boolean).join(" | "));
  const D = I.disp || {}; if (Object.values(D).some(Boolean)) { o.push("", "MATERIAL DISPOSITION"); ln("Default", D.choice); ln("Hold location", D.loc); ln("Hold until", D.until); ln("Labeling", D.label); ln("Responsible", D.who); ln("Notes", D.notes); }
  o.push("", "SIGN-OFF");
  [["Director of Technology", R.sign_tech], ["Director of Operations", R.sign_ops]].forEach(([role, s]) => o.push(s ? `${role}: ${s.name} — ${s.decision}, ${fmtWhen(s.at)}${s.comment ? "\n   Comments: " + s.comment : ""}` : `${role}: not signed yet`));
  return o.join("\n");
}
function tsv() {
  const cl = (v) => String(v ?? "").replace(/[\t\n]/g, " "), rows = [];
  E.trials.forEach((t, ti) => {
    const no = trialNo(t);
    if (ti) rows.push([]);
    rows.push(["Trial " + no, lineLabel(t)]);
    rows.push(["Parameter", "Unit", ...t.conditions.map((c, i) => "Condition " + no.split("-").pop() + "-" + letter(i))]);
    for (const [g, fs] of groupsOf(t)) { rows.push([g]); for (const fd of fs) rows.push([fd.l, fd.u, ...t.conditions.map((c) => (shown(fd, c) ? cl(val(fd, c)) : "n/a"))]); }
  });
  return rows.map((r) => r.join("\t")).join("\n");
}
// Print / PDF on US Letter (page size and layout are in styles.css @page).
// Text boxes grow to fit their text first, so nothing is cut off on paper,
// and the PDF's suggested file name is the trial numbers + title.
function sizeTextareasForPrint() {
  $$("#sheet-body textarea").forEach((t) => { t.style.height = "auto"; t.style.height = t.scrollHeight + 4 + "px"; });
  $$("#sheet-body input").forEach((i) => i.classList.toggle("is-empty", !i.value));
}
function printReport() {
  if (E.dirty) toast("Printing what's on screen. Unsaved changes are included but not saved.");
  sizeTextareasForPrint();
  const prev = document.title;
  document.title = [E.trials.map(trialNo).join(" "), E.report.title].filter(Boolean).join(" – ") || "Trial Report";
  window.addEventListener("afterprint", () => { document.title = prev; $$("#sheet-body textarea").forEach((t) => (t.style.height = "")); }, { once: true });
  window.print();
}
window.addEventListener("beforeprint", sizeTextareasForPrint);

// ───────────────────────────── Users (admin) ────────────────────────────────
let MEMBERS = [];
const roleOptions = (sel) => Object.entries(ROLE_LABELS).map(([k, l]) => `<option value="${k}"${k === sel ? " selected" : ""}>${l}</option>`).join("");
async function showUsers() {
  showScreen("users-view");
  $("invite-role").innerHTML = roleOptions("requester");
  $("users-rows").innerHTML = `<p class="docs-empty">Loading…</p>`;
  try { MEMBERS = await api.listMembers(); renderUsers(); } catch (e) { $("users-rows").innerHTML = `<p class="docs-empty">${esc(e.message)}</p>`; }
}
function renderUsers() {
  const q = $("user-search").value.trim().toLowerCase();
  const vis = MEMBERS.filter((m) => !q || (m.email + " " + m.full_name).toLowerCase().includes(q));
  $("users-rows").innerHTML = vis.map((m) => `<div class="docs-table-row docs-table-row-static">
    <span class="docs-col docs-col-name">${esc(m.full_name || "—")}</span>
    <span class="docs-col docs-col-email">${esc(m.email)}</span>
    <span class="docs-col docs-col-role"><select class="role-select" data-member="${m.user_id}" aria-label="Role for ${esc(m.email)}">${roleOptions(m.active ? m.role : "")}<option value="__removed"${m.active ? "" : " selected"}>Removed (no access)</option></select></span>
    <span class="docs-col docs-col-joined">${fmtDate(m.created_at)}</span></div>`).join("") || `<p class="docs-empty">No users match.</p>`;
}
$("user-search").addEventListener("input", renderUsers);
$("users-rows").addEventListener("change", async (e) => {
  const s = e.target.closest("[data-member]"); if (!s) return;
  const m = MEMBERS.find((x) => x.user_id === s.dataset.member), removed = s.value === "__removed";
  try { await api.setMember(m.user_id, removed ? m.role : s.value, !removed); MEMBERS = await api.listMembers(); renderUsers(); toast(removed ? "Access removed. Their history is kept." : "Role updated."); }
  catch (err) { toast(err.message, true); renderUsers(); }
});
$("btn-user-add").addEventListener("click", () => { $("invite-row").hidden = false; $("invite-email").focus(); });
$("btn-invite-cancel").addEventListener("click", () => ($("invite-row").hidden = true));
$("btn-invite-send").addEventListener("click", async () => {
  const email = $("invite-email").value.trim(), name = $("invite-name").value.trim(), role = $("invite-role").value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Enter a valid email address.", true);
  const b = $("btn-invite-send"); b.disabled = true;
  try {
    const res = await api.inviteMember(email, name, role);
    toast(res.invited ? "Added. They've been emailed an invitation." : res.restored ? "Access restored." : "Added. They can sign in with their existing account.");
    $("invite-row").hidden = true; $("invite-email").value = ""; $("invite-name").value = "";
    MEMBERS = await api.listMembers(); renderUsers();
  } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
});

initAuth();
