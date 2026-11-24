// Line definitions carried over from the Pre-Trial Report form: which stations
// and settings each line type shows, in order. One condition = one column.
// f(key, label, unit, type, options, showIf)
//   type: 'n' number-ish text, 'x' free text, 's' select, 'calc' computed
//   showIf: [otherKey, value] -> only shown when that setting has that value
const f = (k, l, u = "", t = "n", o = null, iff = null) => ({ k, l, u, t, o, iff });
const OU = ["Over", "Under"], OO = ["On", "Off"], YN = ["Yes", "No"];

export const DISP = ["Hold for R&D evaluation", "Ship to customer", "Return to inventory", "Rework", "Scrap", "Other (see notes)"];

const unw = (p, n) => [n, [f(p + "_t", "Tension", "lb"), f(p + "_o", "Orientation", "", "s", OU), f(p + "_w", "Web width", "in"), f(p + "_type", "Web type", "", "x")]];

export const LINES = {
  tp: {
    name: "Ty-Gard® Coating Lines", sub: "Lines 1, 2, 3, 5", code: "TG",
    groups: () => [
      ["Line", [f("speed", "Line speed", "ft/min")]],
      ["Film unwind", [f("fu_t", "Tension", "lb"), f("fu_w", "Web width", "in"), f("fu_type", "Web type", "", "x"), f("fu_o", "Orientation", "", "s", OU)]],
      ["Fiber unwind", [f("fb_sup", "Supplier", "", "x"), f("fb_ends", "Number of ends", "ends"), f("fb_beams", "Number of beams", "beams")]],
      ["Adhesive coating station", [f("ac_glue", "Glue type", "", "x"), f("ac_nip", "Nip gap", "mil"), f("ac_comb", "Comb type", "", "x"), f("ac_t", "Tension", "lb"), f("ac_w", "Coating width or pattern", "", "x"), f("ac_fp", "Fiber pattern", "", "x")]],
      ["Hot cans", [f("hc_psi", "Steam pressure", "psi"), ...[1, 2, 3, 4].map((i) => f("can" + i, "Can " + i + " temperature", "°F"))]],
      ["Print station", [f("pr_plate", "Print plate", "", "x"), f("pr_ink", "Ink type", "", "x"), f("pr_gap", "Gap", "mil")]],
      ["Winder", [f("wd_t", "Tension", "lb"), f("wd_o", "Orientation", "", "s", OU)]],
    ],
  },
  psa: {
    name: "PSA Coating", sub: "Line 7", code: "L7",
    groups: (t) => {
      const n = Math.min(20, Math.max(1, +t.lamp_n || 4)), lamps = [];
      for (let i = 1; i <= n; i++) lamps.push(f("l" + i + "_s", "Lamp " + i, "", "s", OO), f("l" + i + "_p", "Lamp " + i + " power", "%", "n", null, ["l" + i + "_s", "On"]));
      return [
        ["Line", [f("speed", "Overall line speed", "ft/min")]],
        unw("pu", "Primary unwind"),
        ["Adhesive coating station", [f("ac_type", "Adhesive type", "", "x"), f("ac_gap", "Gap", "mil"), f("ac_cw", "Coat weight", "g/m²"), f("ac_temp", "Adhesive temperature", "°F"), f("ac_die", "Die temperature", "°F"), f("ac_mix", "In-line mixing", "", "s", OO), f("ac_w", "Overall coating width", "in"), f("ac_shim", "Coating pattern shim", "", "x")]],
        ["UV curing", [f("uv_cure", "Cure dose", "mJ/cm²"),
          { k: "uv_cnt", l: "Lamps on / off", u: "", t: "calc", fn: (c) => { let a = 0, b = 0; for (let i = 1; i <= n; i++) { if (c["l" + i + "_s"] === "On") a++; else if (c["l" + i + "_s"] === "Off") b++; } return a + " on / " + b + " off"; } },
          ...lamps]],
        ["Secondary unwind", [...unw("su", "")[1], f("su_cor", "Corona treatment", "", "s", OO), f("su_side", "Sides treated", "", "s", ["1 side", "2 sides"], ["su_cor", "On"]), f("su_kw", "Treat power", "kW", "n", null, ["su_cor", "On"])]],
        ["Primary winder", [f("pw_t", "Tension", "lb"), f("pw_o", "Orientation", "", "s", OU), f("pw_lp", "Lay-on roll pressure", "psi"), f("pw_ls", "Lay-on roll speed", "ft/min")]],
      ];
    },
  },
  sg: {
    name: "Shock-Gard® Line", sub: "", code: "SG",
    groups: () => [
      ["Line", [f("speed", "Machine speed", "ft/min")]],
      ["Incoming EPS panel", [f("eps_l", "Length", "in"), f("eps_w", "Width", "in"), f("eps_th", "Thickness", "in"), f("eps_d", "Density", "lb/ft³")]],
      ["Plasma treaters", [f("pl1", "Treater 1", "", "s", OO), f("pl1_kw", "Treater 1 power", "kW", "n", null, ["pl1", "On"]), f("pl2", "Treater 2", "", "s", OO), f("pl2_kw", "Treater 2 power", "kW", "n", null, ["pl2", "On"])]],
      ...[1, 2].map((i) => ["Face unwind " + i, [f("f" + i + "_w", "Web width", "in"), f("f" + i + "_t", "Tension", "lb"), f("f" + i + "_o", "Web orientation", "", "s", OU)]]),
      ["Robots", [f("rb_feed", "Feeding robot", "", "s", OO), f("rb_fin", "Finishing robot", "", "s", OO)]],
      ["Thermoset adhesive coater", [f("tc_type", "Adhesive type", "", "x"), f("tc_gap", "Gap", "mil"), f("tc_cw", "Coat weight", "g/m²"), f("tc_temp", "Adhesive temperature", "°F"), f("tc_lam", "Lamination pressure", "psi")]],
      ["Saw cut and assembly", [f("saw", "Saw cut section", "", "s", OO), f("side", "Side channels", "", "s", YN), f("caps", "End caps", "", "s", YN),
        f("mag", "Magnet", "", "s", YN), f("mag_sz", "Magnet size", "", "x", null, ["mag", "Yes"]), f("mag_pw", "Magnet power / grade", "", "x", null, ["mag", "Yes"]),
        f("riser", "Riser", "", "s", YN), f("ri_sz", "Riser filling size", "", "x", null, ["riser", "Yes"]), f("ri_d", "Riser filling density", "lb/ft³", "n", null, ["riser", "Yes"]), f("ri_bond", "Riser bonding material", "", "x", null, ["riser", "Yes"])]],
    ],
  },
};

const HEAD = ["Condition", [f("name", "Condition name", "", "x"), f("mat", "Material / product", "", "x"), f("run", "Planned quantity", "ft, rolls or panels", "x")]];
const TAIL = ["After trial", [f("disp", "Disposition", "", "s", ["Per disposition section", ...DISP]), f("note", "Condition notes", "", "x")]];
const ASRUN = ["As run", [f("asrun", "Changes from approved settings", "", "x")]];
const RESULTS = ["Test results", [f("result", "Results", "", "x")]];
const STEP_ORDER = ["draft", "settings", "ops_review", "tech_review", "scheduling", "execution", "testing", "closed"];
const tag = ([g, fs], sec) => [g, fs.map((fd) => ({ ...fd, sec: typeof sec === "function" ? sec(fd) : sec }))];

// Groups for a trial's settings table. Each field carries the form section
// it belongs to, so the app knows which step fills it in. "As run" appears
// from Execution on, "Test results" from Testing on.
export const groupsOf = (t, status = "draft") => {
  if (!LINES[t.line]) return [];
  const at = STEP_ORDER.indexOf(status);
  return [
    tag(HEAD, "cond"),
    ...LINES[t.line].groups(t).map((g) => tag(g, "settings")),
    tag(TAIL, (fd) => (fd.k === "disp" ? "plan_disp" : "run")),
    ...(at >= 5 ? [tag(ASRUN, "run")] : []),
    ...(at >= 6 ? [tag(RESULTS, "results")] : []),
  ];
};
export const shown = (fd, c) => !fd.iff || c[fd.iff[0]] === fd.iff[1];
export const letter = (i) => String.fromCharCode(65 + i);
export const lineCode = (t) => (t.line === "tp" ? "TG" + (t.line_no || "?") : LINES[t.line]?.code || "??");
export const lineLabel = (t) => (LINES[t.line] ? LINES[t.line].name + (t.line === "tp" && t.line_no ? ", Line " + t.line_no : "") : "Line not chosen");
export const lineShort = (t) => (t.line === "tp" ? "Ty-Gard L" + (t.line_no || "?") : t.line === "psa" ? "PSA L7" : t.line === "sg" ? "Shock-Gard" : "—");

// Repeating sections: [key, label, type, section, shown from step]
// Planned in Draft; results and ship dates filled in at Testing.
export const REP = {
  tests: [["test", "Test", "x"], ["method", "Method / standard", "x"], ["conds", "Trial-condition(s), e.g. 01-A", "x"], ["n", "Samples per condition", "n"], ["who", "Lab / responsible", "x"], ["due", "Results due", "date"], ["result", "Result", "area", "results", "testing"]],
  samples: [["conds", "Trial-condition(s), e.g. 01-A", "x"], ["n", "Number of samples", "n"], ["size", "Sample size", "x"], ["use", "Purpose / test", "x"]],
  ships: [["name", "Recipient name", "x"], ["email", "Email", "email"], ["n", "Number of samples", "n"], ["size", "Sample size", "x"], ["conds", "Trial-condition(s), e.g. 01-A", "x"], ["how", "Ship method / notes", "x"], ["shipped", "Date shipped", "date", "shipped", "testing"], ["addr", "Shipping address", "area"]],
};

// Line schematics (ink drawings; --glue = adhesive, --uv = UV light, --bg = card).
const roll = (x, y, r, o = 0.9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" opacity="${o}"/><circle cx="${x}" cy="${y}" r="${Math.max(2, r * 0.28)}" fill="var(--bg)"/>`;
const idler = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--bg)" stroke="currentColor" stroke-width="1.6"/>`;
export const ART = {
  tp: `<svg viewBox="0 0 240 80" aria-hidden="true">
  ${[12, 28, 44].map((x) => `<rect x="${x - 7}" y="3" width="14" height="9" rx="2" fill="currentColor" opacity=".8"/>`).join("")}
  <g stroke="currentColor" stroke-width=".7" opacity=".7">${[8, 12, 16, 24, 28, 32, 40, 44, 48].map((x, i) => `<path d="M${x} 12 L70 ${35 + i * 0.6}"/>`).join("")}</g>
  ${roll(16, 62, 12)}<path d="M27 58 L64 50" stroke="currentColor" stroke-width="1.6"/>
  <path d="M64 24 l6 8 l6 -8z" fill="var(--glue)"/>
  ${idler(70, 37, 6)}${idler(70, 55, 6)}
  ${[[108, 52], [136, 30], [164, 52]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12" fill="currentColor" opacity=".22" stroke="currentColor" stroke-width="1.6"/>`).join("")}
  <path d="M77 46 L99.5 60.5 A12 12 0 0 0 116.5 60.5 L127.5 21.5 A12 12 0 0 1 144.5 21.5 L155.5 60.5 A12 12 0 0 0 172.5 60.5 L189 58 L214 46" fill="none" stroke="currentColor" stroke-width="2.2"/>
  <g fill="none" stroke="currentColor" stroke-width="1" opacity=".55">${[[104, 44], [110, 44], [160, 44], [166, 44]].map(([x, y]) => `<path d="M${x} ${y} q-3 -4 0 -7 q3 -3 0 -7"/>`).join("")}</g>
  ${idler(195, 64, 6)}<rect x="186" y="70" width="18" height="4" rx="1" fill="currentColor" opacity=".5"/>
  ${roll(224, 48, 13)}
 </svg>`,
  psa: `<svg viewBox="0 0 240 80" aria-hidden="true">
  ${roll(16, 58, 13)}
  <path d="M16 45 L52 41 A11 11 0 0 1 72 41 L186 41 L214 36" fill="none" stroke="currentColor" stroke-width="1.8"/>
  ${idler(62, 48, 9)}
  <path d="M30 12 h18 v10 l-6 9 h-6 l-6 -9z" fill="currentColor" opacity=".85"/>
  <path d="M39 31 l12 9" stroke="var(--glue)" stroke-width="3" stroke-linecap="round"/>
  <path d="M73 39.5 H186" stroke="var(--glue)" stroke-width="2"/>
  ${[86, 110, 134, 158].map((x) => `<rect x="${x}" y="8" width="18" height="11" rx="2" fill="currentColor" opacity=".85"/><g stroke="var(--uv)" stroke-width="1.3" opacity=".9">${[3, 9, 15].map((d) => `<path d="M${x + d} 21 L${x + d + (d - 9) * 0.4} 36"/>`).join("")}</g>`).join("")}
  ${roll(196, 12, 9, 0.55)}<path d="M196 21 L192 35" stroke="currentColor" stroke-width="1.4"/>
  ${idler(192, 35, 5)}${idler(192, 47, 5)}
  ${roll(224, 48, 13)}
 </svg>`,
  sg: `<svg viewBox="0 0 240 80" aria-hidden="true">
  <path d="M2 50 H90 M182 50 H238" stroke="currentColor" stroke-width="1.4"/>
  <g fill="currentColor" opacity=".5">${[10, 30, 50, 70, 190, 212, 234].map((x) => `<circle cx="${x}" cy="53" r="2.2"/>`).join("")}</g>
  ${[[4, 34], [44, 34]].map(([x, w]) => `<rect x="${x}" y="33" width="${w}" height="14" rx="1.5" fill="currentColor" opacity=".18" stroke="currentColor" stroke-width="1.4"/>`).join("")}
  <path d="M82 40 h8 m-3 -3 l3 3 l-3 3" fill="none" stroke="currentColor" stroke-width="1.4"/>
  ${idler(98, 9, 6)}${idler(114, 24, 9)}<path d="M102 15 q3 -3 6 0 q-1 3 -4 3z" fill="var(--glue)"/>
  ${idler(98, 71, 6)}${idler(114, 56, 9)}<path d="M102 65 q3 3 6 0 q-1 -3 -4 -3z" fill="var(--glue)"/>
  <rect x="100" y="33" width="44" height="14" rx="1.5" fill="currentColor" opacity=".18" stroke="currentColor" stroke-width="1.4"/>
  <rect x="100" y="30.5" width="44" height="2.5" fill="var(--glue)"/><rect x="100" y="47" width="44" height="2.5" fill="var(--glue)"/>
  ${roll(164, 10, 9)}<path d="M172 14 L176 23" stroke="currentColor" stroke-width="1.4"/>${idler(178, 27, 5)}
  ${roll(164, 70, 9)}<path d="M172 66 L176 57" stroke="currentColor" stroke-width="1.4"/>${idler(178, 53, 5)}
  ${[[186, 24], [214, 24]].map(([x, w]) => `<rect x="${x}" y="33" width="${w}" height="14" rx="1.5" fill="currentColor" opacity=".18" stroke="currentColor" stroke-width="1.4"/><rect x="${x}" y="30" width="${w}" height="3" fill="currentColor"/><rect x="${x}" y="47" width="${w}" height="3" fill="currentColor"/>`).join("")}
 </svg>`,
};
