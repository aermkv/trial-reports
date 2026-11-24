// The 8-step route from the "R&D Trial Report Routing Roadmap" (Nov 24, 2026).
// Mirrors supabase/migrations/0005_routing_roadmap.sql; the database is the
// real gate, this file drives the app's labels, buttons and editable fields.
export const STEPS = [
  { key: "draft",       n: 1, name: "Draft",            owner: "Trial Requester",        roles: ["requester"], author: true,
    advance: "Send to Engineering", does: "Writes the request" },
  { key: "settings",    n: 2, name: "Settings Entry",   owner: "Engineering",            roles: ["engineer"],
    advance: "Send to Director of Operations", does: "Enters line settings" },
  { key: "ops_review",  n: 3, name: "Operations Review", owner: "Director of Operations", roles: ["ops_director"], approval: true,
    advance: "Approve – Send to Director of Technology", does: "Reviews and signs off" },
  { key: "tech_review", n: 4, name: "Final Approval",   owner: "Director of Technology", roles: ["tech_director"], approval: true,
    advance: "Final Approval – Send to Plant Manager", does: "Gives final approval" },
  { key: "scheduling",  n: 5, name: "Scheduling",       owner: "Plant Manager",          roles: ["plant_manager"],
    advance: "Schedule Set – Send to Engineering", does: "Schedules each trial" },
  { key: "execution",   n: 6, name: "Execution",        owner: "Engineering",            roles: ["engineer"],
    advance: "Trials Run – Send to R&D", does: "Runs trials, pulls samples" },
  { key: "testing",     n: 7, name: "Testing",          owner: "R&D",                    roles: ["requester"], author: true,
    advance: "Close & Send After-Trial Package", does: "Tests, ships samples" },
  { key: "closed",      n: 8, name: "Closed",           owner: "—",                      roles: [],
    does: "After-trial package sent" },
];
export const STEP = Object.fromEntries(STEPS.map((s) => [s.key, s]));
export const stepNo = (k) => STEP[k]?.n ?? 0;
export const nextStep = (k) => STEPS[stepNo(k)]?.key;          // n is 1-based
export const prevStep = (k) => (stepNo(k) > 1 ? STEPS[stepNo(k) - 2].key : null);
export const OPEN = ["draft", "settings", "ops_review", "tech_review", "scheduling", "execution", "testing"];
export const FILL = ["draft", "settings", "scheduling", "execution", "testing"]; // steps where the form is filled in

// Is this person an owner of the report's current step? (admins always are)
export function isOwner(r, me, { includeAdmin = true } = {}) {
  if (!me?.role || !OPEN.includes(r.status)) return false;
  if (includeAdmin && me.role === "admin") return true;
  const s = STEP[r.status];
  return s.roles.includes(me.role) || (s.author && r.created_by === me.id);
}

// Which parts of the form each step fills in (per the roadmap's
// "Form sections they complete" column).
const EDIT = {
  draft:      ["info", "bg", "trials", "cond", "settings", "plan_disp", "tests", "samples", "ships", "disp"],
  settings:   ["trials", "cond", "settings"],
  scheduling: ["schedule"],
  execution:  ["run", "plan_disp"],
  testing:    ["tests", "samples", "ships", "results", "shipped", "after"],
};
export const editableSections = (status) => EDIT[status] || [];
