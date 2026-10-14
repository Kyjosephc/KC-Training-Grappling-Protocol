// =============================================================================
// CAN SOMEONE ACTUALLY USE THIS
// =============================================================================
// Every screen an athlete touches, mounted for real, then interrogated the way
// a screen reader would: does every control have a name, does every image say
// what it is, is anything nested inside something it should not be. Plus the
// colour maths, read out of the real theme tokens rather than guessed at.
//
// Run through scripts/verify-a11y.sh, which does the bundling first.
// =============================================================================
const fs = require("fs");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><div id=root></div>", { pretendToBeVisual: true, url: "https://x.test" });
global.window = dom.window; global.document = dom.window.document;
global.navigator = dom.window.navigator; global.IS_REACT_ACT_ENVIRONMENT = true;
global.matchMedia = dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
class RO { observe() {} unobserve() {} disconnect() {} }
global.ResizeObserver = dom.window.ResizeObserver = RO;
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, value: 1024 });
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, value: 640 });

const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react");
const A = require("../.a11y.cjs").__t;

const host = document.getElementById("root");
const root = createRoot(host);
const mount = (el) => act(() => root.render(el));
const unmount = () => act(() => root.render(null));

const snip = (el) => el.outerHTML.replace(/\s+/g, " ").slice(0, 110);

// Placeholder text technically names a field, but it vanishes the moment
// someone types, so it is reported separately rather than counted as a name.
function accName(el) {
  const direct = (el.getAttribute("aria-label") || "").trim();
  if (direct) return direct;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.textContent : ""; }).join(" ").trim();
    if (t) return t;
  }
  const title = (el.getAttribute("title") || "").trim();
  if (title) return title;
  if (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button") {
    const t = el.textContent.trim();
    if (t) return t;
    const img = el.querySelector("img[alt]");
    if (img && img.getAttribute("alt").trim()) return img.getAttribute("alt").trim();
    const st = el.querySelector("svg title");
    if (st && st.textContent.trim()) return st.textContent.trim();
    return "";
  }
  if (el.id) {
    const lab = document.querySelector(`label[for="${el.id}"]`);
    if (lab && lab.textContent.trim()) return lab.textContent.trim();
  }
  const wrap = el.closest("label");
  if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
  return "";
}

const findings = [];
function audit(screen) {
  const out = { screen, buttons: 0, controls: 0, problems: [] };
  const add = (kind, el) => out.problems.push({ kind, snip: snip(el) });

  const hidden = (el) => !!el.closest('[aria-hidden="true"], .sr-only');
  const btns = [...host.querySelectorAll('button, a[href], [role="button"]')].filter((b) => !hidden(b));
  out.buttons = btns.length;
  btns.forEach((b) => {
    if (!accName(b)) add("control with no name a screen reader can read", b);
    if (b.tagName !== "BUTTON" && b.getAttribute("role") === "button" && b.tabIndex < 0) add("role=button that keyboard focus cannot reach", b);
    if (b.querySelector("button, a[href]")) add("interactive element nested inside another", b);
  });

  const ctrls = [...host.querySelectorAll("input, select, textarea")].filter((c) => c.type !== "hidden" && !hidden(c));
  out.controls = ctrls.length;
  ctrls.forEach((c) => {
    if (accName(c)) return;
    const ph = (c.getAttribute("placeholder") || "").trim();
    if (ph) add(`named only by its placeholder ("${ph.slice(0, 32)}")`, c);
    else add("field with no name a screen reader can read", c);
  });

  [...host.querySelectorAll("img")].forEach((i) => {
    if (i.getAttribute("alt") === null) add("image with no alt attribute at all", i);
  });

  [...host.querySelectorAll("[tabindex]")].forEach((e) => {
    if (Number(e.getAttribute("tabindex")) > 0) add("positive tabindex, which reorders the whole page", e);
  });

  const ids = {};
  [...host.querySelectorAll("[id]")].forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
  Object.entries(ids).filter(([, n]) => n > 1).forEach(([id, n]) => out.problems.push({ kind: `id "${id}" used ${n} times`, snip: "" }));

  findings.push(out);
  unmount();
}

const athlete = (over = {}) => ({
  ...A.buildClient({ id: "a", firstName: "Test", lastName: "One", weight: 170, heightFeet: 5,
    heightInches: 10, beltLevel: "White", programVariant: "B", useTemplate: true, weeklySchedule: {},
    waiver: { version: "v", at: new Date().toISOString() } }),
  ...over,
});
const noop = () => {};
const ok = async () => ({ ok: true });
const c = athlete({ paid: true, sessionsCompleted: 4,
  logs: [{ id: "l1", date: "2026-01-02", phaseId: "p", dayId: "d", dayLabel: "Day 1", weekNumber: 1, avgRPE: 8, totalVolume: 1850, sectionCompletion: {}, notes: "",
    exercises: [{ name: "Back Squat", sets: [{ weight: 185, reps: 5, done: true }, { weight: 185, reps: 5, done: true }] }] }],
  prLog: [{ date: "2026-01-02", lift: "Back Squat", weight: 225, reps: 3 }],
  bodyweightLog: [{ date: "2026-01-01", weight: 170 }, { date: "2026-01-08", weight: 172 }],
  readiness: { "2026-01-08": { sleep: 4, readiness: 4, color: "GREEN", date: "2026-01-08" } } });

const screens = [
  ["Sign-up", () => React.createElement(A.OnboardingScreen, { onSubmit: noop })],
  ["Sign-in", () => React.createElement(A.AuthScreen, {})],
  ["Waiver", () => React.createElement(A.WaiverModal, { onClose: noop, onAccept: noop, accepted: false, defaultName: "Test One" })],
  ["Tutorial", () => React.createElement(A.TutorialModal, { onClose: noop, variant: "today" })],
  ["Today", () => React.createElement(A.TodayTab, { client: c, onPersist: ok, onStartLog: noop, onStartMobility: noop, onRefreshProgram: noop, onReloadClient: ok, userId: "u" })],
  ["Daily check-in", () => React.createElement(A.ReadinessModal, { existing: null, existingWeight: "", onClose: noop, onSave: noop })],
  ["Session", () => React.createElement(A.DaySessionScreen, { client: c, isCoach: false, phaseId: c.program.phases[0].id, dayId: c.program.phases[0].days[0].id, onClose: noop, onSave: ok, onStartMobility: noop, onUpdateProgram: noop, onRestartProgram: ok, onRecordPR: noop, onRemovePR: noop })],
  ["Recovery session", () => React.createElement(A.MobilitySession, { client: c, isCoach: false, onClose: noop, onSave: ok, onUpdateProgram: noop })],
  ["Progress", () => React.createElement(A.ProgressTab, { client: c })],
  ["Personal records", () => React.createElement(A.PRsTab, { client: c })],
  ["History", () => React.createElement(A.HistoryTab, { client: c, onPersist: ok })],
  ["Schedule", () => React.createElement(A.ScheduleTab, { client: c })],
  ["Program", () => React.createElement(A.ProgramTab, { client: c, isCoach: false, onPersist: ok })],
  ["Jiu-jitsu notes", () => React.createElement(A.BJJNotesTab, { client: c, onPersist: ok })],
  ["Accomplishments", () => React.createElement(A.AccomplishmentsPage, { client: c, onClose: noop })],
  ["1RM calculator", () => React.createElement(A.OneRepMaxCalculator, { onClose: noop })],
  ["Settings", () => React.createElement(A.SettingsModal, { client: c, isCoach: false, onPersist: ok, theme: "dark", onChangeTheme: noop, onClose: noop, onResetApp: noop, onRefreshProgram: noop, onOpenCoachDashboard: noop, onOpenTerms: noop, onSignOut: noop })],
  ["Bottom navigation", () => React.createElement(A.BottomNav, { tab: "today", setTab: noop, unread: 2 })],
  ["Community", () => React.createElement(A.CommunityTab, { client: c, userId: "u", isCoach: false, prefs: {}, onPrefs: noop })],
  ["Leaderboard", () => React.createElement(A.LeaderboardTab, { client: c, userId: "u" })],
  ["Coach dashboard", () => React.createElement(A.CoachDashboard, { userId: "coach-1", onClose: noop })],
];

console.log("=== every screen, as a screen reader sees it ===\n");
for (const [name, make] of screens) {
  try { mount(make()); audit(name); }
  catch (e) { findings.push({ screen: name, buttons: 0, controls: 0, crashed: e.message }); unmount(); }
}

let total = 0;
for (const f of findings) {
  if (f.crashed) { console.log(`  !!   ${f.screen} — would not even render: ${f.crashed}`); total++; continue; }
  const n = f.problems.length;
  total += n;
  const head = `${f.screen} — ${f.buttons} control(s), ${f.controls} field(s)`;
  if (!n) { console.log(`  ok   ${head}`); continue; }
  console.log(`  ${n} problem(s)   ${head}`);
  const seen = {};
  f.problems.forEach((p) => {
    seen[p.kind] = (seen[p.kind] || 0) + 1;
    if (seen[p.kind] <= 2) console.log(`         ${p.kind}\n           ${p.snip}`);
  });
  Object.entries(seen).filter(([, n2]) => n2 > 2).forEach(([k, n2]) => console.log(`         ...and ${n2 - 2} more: ${k}`));
}

// --- colour, from the real tokens ----------------------------------------
const src = fs.readFileSync("src/App.jsx", "utf8");
function tokens(theme) {
  const m = src.match(new RegExp(`data-theme="${theme}"\\] \\{([^}]*)\\}`));
  const t = {};
  (m ? m[1] : "").split(";").forEach((p) => {
    const kv = p.split(":");
    if (kv.length === 2 && kv[0].trim().startsWith("--")) t[kv[0].trim().slice(2)] = kv[1].trim();
  });
  return t;
}
const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
function lum(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const pairs = [
  ["body text", "text", "bg", 4.5], ["body text on a card", "text", "card", 4.5],
  ["secondary text", "text-dim", "bg", 4.5], ["secondary text on a card", "text-dim", "card", 4.5],
  ["accent text", "accent", "bg", 4.5], ["accent text on a card", "accent", "card", 4.5],
  ["button label on the main button", "accent-text", "cta", 4.5],
  ["green readiness", "green", "bg", 3], ["amber readiness", "amber", "bg", 3], ["red readiness", "red", "bg", 3],
  ["info blue", "info", "bg", 4.5], ["gold highlight", "neon-gold", "bg", 4.5],
  // --border draws card edges and divider lines. Those carry no information
  // on their own, so WCAG does not hold them to 3:1; --field-border is the
  // one that outlines fields and icon-only buttons, where the box IS the
  // control, and that one has to clear it.
  ["field and icon-button outlines", "field-border", "bg", 3],
  ["field and icon-button outlines on a card", "field-border", "card", 3],
];
console.log("\n=== colour contrast, both themes ===");
let colourFails = 0;
["dark", "light"].forEach((theme) => {
  const t = tokens(theme);
  console.log(`\n  ${theme}`);
  pairs.forEach(([label, fg, bg, need]) => {
    if (!t[fg] || !t[bg]) { console.log(`    ?    ${label} — token missing`); return; }
    const r = ratio(t[fg], t[bg]);
    const pass = r >= need;
    if (!pass) colourFails++;
    console.log(`    ${pass ? "ok  " : "LOW "} ${label}: ${r.toFixed(2)}:1 (needs ${need}:1)`);
  });
});

// --- type size, out of the stylesheet ------------------------------------
// Uppercase Oswald at wide tracking reads fine below 12px, which is why the
// micro-labels sit at 10px. 9.5px is the floor; anything under it is a bug.
const FLOOR = 9.5;
const sizes = [...src.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
const small = sizes.filter((n) => n < 12);
const under = sizes.filter((n) => n < FLOOR);
console.log(`\n=== type size ===\n  ${small.length} rule(s) set text under 12px, smallest ${Math.min(...sizes)}px`);
console.log(`  ${under.length} rule(s) under the ${FLOOR}px floor`);
if (under.length) process.exitCode = 1;

// --- stylesheet rules nothing can reach -----------------------------------
// Rules left behind by a redesign are not harmless: the next person to read
// the stylesheet cannot tell which half of it is live.
const g0 = src.indexOf("function GlobalStyle"), g1 = src.indexOf("function AuthScreen");
const sheet = src.slice(g0, g1);
const jsx = src.slice(0, g0) + src.slice(g1) + fs.readFileSync("src/RulesGame.jsx", "utf8");
// Classes assembled at runtime (`tone-${t}`) never appear whole in the source.
const COMPOSED = [/^tone-/, /^toast-/];
const declared = new Set([...sheet.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
const unreachable = [...declared].filter((cl) =>
  !COMPOSED.some((re) => re.test(cl)) &&
  !new RegExp(`(?<![\\w-])${cl.replace(/[-]/g, "-")}(?![\\w-])`).test(jsx));
console.log(`\n=== stylesheet ===\n  ${declared.size} classes declared, ${unreachable.length} that no JSX can reach`);
unreachable.slice(0, 12).forEach((cl) => console.log(`    .${cl}`));
if (unreachable.length) process.exitCode = 1;

console.log(`\n${total} accessibility problem(s), ${colourFails} colour pair(s) under the bar.`);
if (total || colourFails) process.exitCode = 1;
else console.log("Every screen names every control, and both themes clear the contrast bar.");
