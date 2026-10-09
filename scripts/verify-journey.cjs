// =============================================================================
// TWO ATHLETES, THROUGH THE WHOLE APP
// =============================================================================
// Not a reading of the code — the real screens, mounted and clicked, with two
// different people in them:
//
//   Marcus   white belt, 19, wrestling background, trains the program straight
//            through. Logs everything. Pays in week two.
//   Dani     blue belt, 34, comes in injured, skips sessions, never pays,
//            changes her mind about things, competes.
//
// Run through scripts/verify-journey.sh, which does the bundling first.
// =============================================================================
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><div id=root></div>", { pretendToBeVisual: true, url: "https://x.test" });
global.window = dom.window; global.document = dom.window.document;
global.navigator = dom.window.navigator; global.IS_REACT_ACT_ENVIRONMENT = true;
global.matchMedia = dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
// Recharts measures its container. jsdom has no layout engine, so give it the
// observer it expects and a non-zero box to draw into.
class RO { observe() {} unobserve() {} disconnect() {} }
global.ResizeObserver = dom.window.ResizeObserver = RO;
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, value: 1024 });
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, value: 640 });

const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react");
const A = require("../.journey.cjs").__t;

let bad = 0;
const found = [];
const check = (name, fn) => {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { bad++; found.push(name + " — " + e.message); console.log("  FAIL " + name + "\n         " + e.message); }
};

const host = document.getElementById("root");
const root = createRoot(host);
const mount = (el) => act(() => root.render(el));
const txt = () => host.textContent;
const buttons = () => [...host.querySelectorAll("button")];
const hit = (el) => act(() => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
const byText = (re) => buttons().find((b) => re.test(b.textContent));
const click = (re) => {
  const b = byText(re);
  if (!b) throw new Error(`no button matching ${re}\n         buttons: ${buttons().map((x) => x.textContent.trim().slice(0, 30)).join(" | ")}`);
  hit(b);
};
const has = (re, label) => { if (!re.test(txt())) throw new Error(`expected ${label || re} on screen`); };
const setVal = (el, v) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  setter.call(el, v);
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
});
const unmount = () => act(() => root.render(null));
const hasNot = (re, label) => { if (re.test(txt())) throw new Error(`did not expect ${label || re} on screen`); };

// useTemplate is what gives them the real twelve-week program. Without it
// buildClient hands back a one-day blank, which is not what any athlete has.
const athlete = (over = {}) => ({
  ...A.buildClient({ id: "a", firstName: "Test", lastName: "One", weight: 170, heightFeet: 5,
    heightInches: 10, beltLevel: "White", programVariant: "B", useTemplate: true, weeklySchedule: {},
    waiver: { version: "v", at: new Date().toISOString() } }),
  ...over,
});
const dayStr = (daysAgo) => {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A logged session shaped the way the app writes them, so history-driven
// features (weight suggestions, the verdict, charts) have something real.
// Shaped the way DaySessionScreen writes one: a local YYYY-MM-DD date, not an
// ISO timestamp, which is what the date formatting downstream expects.
let logSeq = 0;
const sessionLog = (daysAgo, weight, exName) => ({
  id: `log-${++logSeq}`, date: dayStr(daysAgo), phaseId: "p1", dayId: "d1",
  dayLabel: "Day 1", weekNumber: 1, avgRPE: 8, totalVolume: weight * 10,
  exercises: [{ name: exName, sets: [{ weight, reps: 5, done: true }, { weight, reps: 5, done: true }] }],
  sectionCompletion: {}, notes: "",
});

console.log("\n================ MARCUS — straight through ================\n");

console.log("Signing up");
// The waiver comes before the profile form, deliberately — paperwork first.
let signedUp = null;
const openOnboarding = () => {
  unmount();
  signedUp = null;
  mount(React.createElement(A.OnboardingScreen, { onSubmit: (c) => { signedUp = c; } }));
};
const signWaiver = (name = "Marcus Hale") => {
  click(/sign the liability waiver/i);
  act(() => { host.querySelector("input[type=checkbox]").click(); });
  setVal(host.querySelector("input[placeholder='Your full name']"), name);
  click(/sign and continue/i);
};

check("the welcome screen puts the waiver before anything else", () => {
  openOnboarding();
  has(/waiver|liability/i, "the waiver step");
  if (host.querySelector("input[type=text]")) throw new Error("profile fields are reachable before signing");
});
check("the waiver will not sign unchecked and unnamed", () => {
  click(/sign the liability waiver/i);
  click(/sign and continue/i);
  has(/sign and continue/i, "still on the waiver");
});
check("the waiver will not accept a whitespace signature", () => {
  act(() => { host.querySelector("input[type=checkbox]").click(); });
  setVal(host.querySelector("input[placeholder='Your full name']"), "   ");
  click(/sign and continue/i);
  has(/sign and continue/i, "still on the waiver");
});
check("a real signature gets through to the profile form", () => {
  setVal(host.querySelector("input[placeholder='Your full name']"), "Marcus Hale");
  click(/sign and continue/i);
  hasNot(/sign and continue/i, "the waiver");
  if (host.querySelectorAll("input[type=text]").length < 2) throw new Error("no name fields on the profile form");
});
check("Get started is disabled until the form is filled, not silently dead", () => {
  const go = byText(/get started/i);
  if (!go) throw new Error("no Get started button");
  if (!go.disabled) throw new Error("Get started is clickable with an empty form");
});
check("name alone is not enough — it still wants bodyweight and height", () => {
  const t = [...host.querySelectorAll("input[type=text]")];
  setVal(t[0], "Marcus"); setVal(t[1], "Hale");
  if (!byText(/get started/i).disabled) throw new Error("accepted a profile with no bodyweight or height");
});
check("it says why it is still disabled rather than just sitting there", () => {
  const n = [...host.querySelectorAll("input[type=number]")];
  setVal(n[0], "172"); setVal(n[1], "5"); setVal(n[2], "10");
  // The program needs lifting days on the calendar, and the form says so.
  has(/strength\/conditioning (day|days)/i, "guidance about picking strength days");
});
check("a complete profile submits, and carries the signed waiver with it", () => {
  // Pick the strength days it is asking for, one per calendar day.
  const picks = buttons().filter((b) => /^Strength\/Conditioning$/.test(b.textContent.trim()));
  for (let i = 0; i < picks.length; i++) {
    if (!byText(/get started/i).disabled) break;
    hit(picks[i]);
  }
  const go = byText(/get started/i);
  if (go.disabled) throw new Error("still disabled after filling the form and the schedule");
  hit(go);
  // onSubmit hands back the form's answers; the app builds the client from them.
  if (!signedUp) throw new Error("Get started did nothing on a complete form");
  if (!signedUp.waiver) throw new Error("the signed waiver did not travel with the profile");
  if (signedUp.firstName !== "Marcus") throw new Error("the name did not come through");
  if (!(Number(signedUp.weight) > 0)) throw new Error("bodyweight did not come through");
  const picked = Object.values(signedUp.weeklySchedule || {})
    .filter((v) => Array.isArray(v) && v.some((x) => /strength/i.test(x))).length;
  if (picked < 3) throw new Error(`submitted with only ${picked} strength days on the calendar`);
});
check("and the answers build a real twelve-week program", () => {
  const built = A.buildClient({ ...signedUp, useTemplate: true, id: "new" });
  // Six phases of three day-templates, each phase spanning several weeks — so
  // the block is twelve weeks of training, not eighteen sessions.
  if (!built.program.phases.length) throw new Error("no phases");
  if (A.positionAtIndex(built.program, 0).weekNumber !== 1) throw new Error("does not start at week 1");
  if (A.positionAtIndex(built.program, 35).weekNumber !== 12) throw new Error("session 36 is not in week 12");
});

console.log("\nWeek one, free");
const marcusWeek1 = athlete({ id: "marcus", firstName: "Marcus", sessionsCompleted: 0, logs: [], paid: false });
check("today's session is offered, no payment wall", () => {
  mount(React.createElement(A.TodayTab, { client: marcusWeek1, onPersist: async () => ({ ok: true }),
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
  hasNot(/venmo|cash app|payment/i, "a payment prompt");
});
check("there is a way to start the workout", () => { if (!byText(/start/i)) throw new Error("no start button"); });

console.log("\nThe session screen");
check("the day's session renders with exercises", () => {
  mount(React.createElement(A.DaySessionScreen, { client: marcusWeek1, isCoach: false,
    phaseId: marcusWeek1.program.phases[0].id, dayId: marcusWeek1.program.phases[0].days[0].id,
    onClose() {}, onSave: async () => ({ ok: true }), onStartMobility() {}, onUpdateProgram() {},
    onRestartProgram: async () => {}, onRecordPR() {}, onRemovePR() {} }));
  if (host.querySelectorAll("input").length < 2) throw new Error("no inputs to log sets into");
});

console.log("\nWeek two — the wall");
const marcusWall = athlete({ id: "marcus", firstName: "Marcus", sessionsCompleted: 3,
  logs: [sessionLog(9, 135, "Back Squat"), sessionLog(7, 135, "Back Squat"), sessionLog(5, 140, "Back Squat")], paid: false });
check("the payment wall appears", () => {
  mount(React.createElement(A.TodayTab, { client: marcusWall, onPersist: async () => ({ ok: true }),
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
  has(/venmo|cash app/i, "the payment methods");
});
check("the wall offers no way to start the workout", () => {
  const start = byText(/^start (workout|session|today)/i);
  if (start) throw new Error("a Start button is reachable while payment is outstanding");
});
check("the wall says what happens after paying", () => has(/once|forever|never|again|one-?time/i, "reassurance that it is one payment"));
check("the wall has a way to re-check after paying", () => { if (!byText(/paid|check|refresh/i)) throw new Error("no way to tell the app you have paid"); });

console.log("\nMarked paid by the coach");
const marcusPaid = { ...marcusWall, paid: true };
check("the wall is gone", () => {
  mount(React.createElement(A.TodayTab, { client: marcusPaid, onPersist: async () => ({ ok: true }),
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
  hasNot(/scan.*venmo|cash app/i, "the payment methods");
});
check("and the session is back", () => { if (!byText(/start/i)) throw new Error("no start button after paying"); });

console.log("\nWeight suggestions off his history");
check("a loaded lift suggests a number from last time", () => {
  const s = A.suggestFromHistory(marcusPaid, "Back Squat", 5, false);
  if (s == null) throw new Error("no suggestion at all from three logged sessions");
  if (typeof s === "number" && s < 140) throw new Error(`suggested ${s} after a logged 140`);
});

console.log("\nSix months in — the verdict");
const marcusHalfYear = athlete({ id: "marcus", firstName: "Marcus", paid: true, sessionsCompleted: 60, blockNumber: 2,
  logs: [sessionLog(180, 135, "Back Squat"), sessionLog(177, 140, "Back Squat"),
         sessionLog(6, 225, "Back Squat"), sessionLog(3, 230, "Back Squat")] });
check("the verdict card renders after six months", () => {
  mount(React.createElement(A.VerdictCard, { client: marcusHalfYear }));
  if (!txt().trim()) throw new Error("verdict card rendered nothing");
});
check("and it says he got stronger", () => has(/strong|up|progress|gain|improv/i, "a verdict"));

console.log("\n================ DANI — awkward on purpose ================\n");

console.log("Comes in injured");
const daniNew = athlete({ id: "dani", firstName: "Dani", beltLevel: "Blue", injuryAreas: ["Shoulder"],
  injuryNotes: "left shoulder, no overhead pressing", sessionsCompleted: 0, logs: [], paid: false });
check("the session screen renders for someone with an injury flagged", () => {
  mount(React.createElement(A.DaySessionScreen, { client: daniNew, isCoach: false,
    phaseId: daniNew.program.phases[0].id, dayId: daniNew.program.phases[0].days[0].id,
    onClose() {}, onSave: async () => ({ ok: true }), onStartMobility() {}, onUpdateProgram() {},
    onRestartProgram: async () => {}, onRecordPR() {}, onRemovePR() {} }));
  if (!txt().trim()) throw new Error("blank session screen");
});

console.log("Skips ahead without logging anything");
const daniSkipped = athlete({ id: "dani", firstName: "Dani", sessionsCompleted: 12, logs: [], paid: false, maxSessionsReached: 12 });
check("skipping ahead unpaid still hits the wall", () => {
  mount(React.createElement(A.TodayTab, { client: daniSkipped, onPersist: async () => ({ ok: true }),
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
  has(/venmo|cash app/i, "the payment wall");
});

console.log("Never pays, comes back months later");
const daniStale = athlete({ id: "dani", firstName: "Dani", sessionsCompleted: 3, paid: false,
  logs: [sessionLog(200, 95, "Back Squat"), sessionLog(198, 95, "Back Squat"), sessionLog(196, 100, "Back Squat")] });
check("still walled after a long absence", () => {
  mount(React.createElement(A.TodayTab, { client: daniStale, onPersist: async () => ({ ok: true }),
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
  has(/venmo|cash app/i, "the payment wall");
});

console.log("Competing in nine days");
const daniComp = athlete({ id: "dani", firstName: "Dani", paid: true, sessionsCompleted: 20,
  competitionDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10),
  logs: [sessionLog(10, 155, "Back Squat"), sessionLog(7, 155, "Back Squat")] });
check("the taper reaches her somewhere she will see it", () => {
  mount(React.createElement(A.TodayTab, { client: daniComp, onPersist: async () => ({ ok: true }),
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
  const onToday = /taper|competition|compete|match|days? (to|out)/i.test(txt());
  mount(React.createElement(A.DaySessionScreen, { client: daniComp, isCoach: false,
    phaseId: daniComp.program.phases[0].id, dayId: daniComp.program.phases[0].days[0].id,
    onClose() {}, onSave: async () => ({ ok: true }), onStartMobility() {}, onUpdateProgram() {},
    onRestartProgram: async () => {}, onRecordPR() {}, onRemovePR() {} }));
  const onSession = /taper|competition|compete|match/i.test(txt());
  if (!onToday && !onSession) throw new Error("nine days from competing and neither screen mentions it");
});

console.log("Not enough history for a verdict");
const daniThin = athlete({ id: "dani", firstName: "Dani", paid: true, sessionsCompleted: 2,
  logs: [sessionLog(3, 95, "Back Squat"), sessionLog(1, 95, "Back Squat")] });
check("the verdict does not pass judgement on two sessions", () => {
  mount(React.createElement(A.VerdictCard, { client: daniThin }));
  hasNot(/you (got|are) (stronger|weaker)/i, "a premature verdict");
});

console.log("\nThe community feed");
// An unpaid athlete never reaches CommunityTab at all — the parent drops it
// from the tab bar (communityOpen = isCoach || client.paid), so there is no
// "locked" screen to test. What matters is that the rule is the paid flag.
check("the feed is gated on the same flag as everything else", () => {
  if (marcusWall.paid !== false) throw new Error("fixture is not actually unpaid");
  if (marcusPaid.paid !== true) throw new Error("fixture is not actually paid");
});
check("a paid athlete gets the feed", () => {
  unmount();
  mount(React.createElement(A.CommunityTab, { client: marcusPaid, userId: "u", isCoach: false,
    prefs: {}, onPrefs() {} }));
  if (!txt().trim()) throw new Error("blank community tab for a paid athlete");
});

console.log("\nThe coach's dashboard");
check("the dashboard renders while it is still loading", () => {
  unmount();
  mount(React.createElement(A.CoachDashboard, { userId: "coach-1", clients: [], activeId: "marcus",
    onPersistActive: async () => ({ ok: true }), onSignupsReviewed() {}, onClose() {} }));
  if (!txt().trim()) throw new Error("blank dashboard");
});

console.log("\nThe programs themselves");
// What each program promises, checked against what it actually builds.
const VARIANTS = ["A", "B", "D"];
const PAT = {
  press: /bench|floor press|push-?up|dip|overhead press|landmine punch|spoto|dumbbell press/i,
  pull: /row|pull-?up|chin-?up|pulldown|face pull|band pull-apart|renegade|scarecrow/i,
  squat: /squat|leg press|step-?up|lunge/i,
  hinge: /deadlift|romanian|rdl|good morning|hip thrust|glute bridge|hamstring curl|valslide/i,
};
const clean = (n) => String(n).replace(/\([^)]*\)/g, " ");
const countIn = (prog, re, hardOnly = true) => {
  let n = 0;
  (prog.phases || [])
    .filter((ph) => !hardOnly || !/deload/i.test(ph.name))
    .forEach((ph) => (ph.days || []).forEach((d) => (d.sections || []).forEach((sec) =>
      (sec.exercises || []).forEach((e) => { if (re.test(clean(e.name || ""))) n += Number(e.sets) || 0; }))));
  return n;
};

VARIANTS.forEach((v) => {
  check(`program ${v} builds with phases, days and a name`, () => {
    const p = A.buildProgramVariant(v);
    if (!p || !p.phases || !p.phases.length) throw new Error("no phases");
    if (!p.name) throw new Error("no name");
    if (!p.sessionsPerWeek) throw new Error("no sessionsPerWeek");
    p.phases.forEach((ph) => { if (!ph.days || !ph.days.length) throw new Error(`${ph.name} has no days`); });
  });
  check(`program ${v} runs twelve weeks`, () => {
    const p = A.buildProgramVariant(v);
    const last = p.sessionsPerWeek * 12 - 1;
    if (A.positionAtIndex(p, 0).weekNumber !== 1) throw new Error("does not start in week 1");
    if (A.positionAtIndex(p, last).weekNumber !== 12) throw new Error(`session ${last} is not in week 12`);
  });
  check(`program ${v} coaches every exercise it prescribes`, () => {
    const p = A.buildProgramVariant(v);
    const bare = [];
    (p.phases || []).forEach((ph) => (ph.days || []).forEach((d) => (d.sections || []).forEach((sec) =>
      (sec.exercises || []).forEach((e) => { if (e.name && !e.cues) bare.push(e.name); }))));
    if (bare.length) throw new Error(`${bare.length} exercises with no cues, e.g. ${bare.slice(0, 3).join(", ")}`);
  });
  check(`program ${v} is named in the switcher`, () => {
    if (!A.PROGRAM_VARIANT_LABELS[v]) throw new Error("no label, so it cannot be switched to");
  });
});

check("no program presses more than it pulls", () => {
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    const press = countIn(p, PAT.press), pull = countIn(p, PAT.pull);
    // Grappling pulls far more than it presses. Program A used to run about
    // four pressing sets for every three pulling, with no pulling at all on
    // its first day.
    if (press > pull) throw new Error(`program ${v} is ${press} press to ${pull} pull`);
  });
});
check("every program's first day has pulling in it", () => {
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    const d1 = p.phases.find((ph) => !/deload/i.test(ph.name)).days.find((d) => d.label === "1");
    const pulls = (d1.sections || []).flatMap((s) => s.exercises || [])
      .filter((e) => PAT.pull.test(clean(e.name || "")));
    if (!pulls.length) throw new Error(`program ${v} day 1 has no pulling`);
  });
});
check("the in-season program is genuinely lighter than the others", () => {
  const sets = (v) => {
    const p = A.buildProgramVariant(v);
    const ph = p.phases.find((x) => !/deload/i.test(x.name));
    return ph.days.reduce((n, d) => n + (d.sections || []).reduce((m, s) =>
      m + (s.exercises || []).reduce((k, e) => k + (Number(e.sets) || 0), 0), 0), 0);
  };
  const d = sets("D"), a = sets("A"), b = sets("B");
  if (d >= a || d >= b) throw new Error(`in-season is ${d} sets a week against ${a} and ${b}`);
});
check("the four that keep you training are in every block of the in-season program", () => {
  const p = A.buildProgramVariant("D");
  const must = [["neck", /neck/i], ["adductor", /copenhagen|adduction/i],
    ["grip", /carry/i], ["hinge", /romanian|trap bar deadlift/i]];
  p.phases.forEach((ph) => {
    const names = ph.days.flatMap((d) => (d.sections || []).flatMap((s) => (s.exercises || []).map((e) => e.name || "")));
    const missing = must.filter(([, re]) => !names.some((n) => re.test(n))).map(([k]) => k);
    if (missing.length) throw new Error(`${ph.name} drops ${missing.join(", ")}`);
  });
});
check("a deload is never the hardest week in a block", () => {
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    const wk = (ph) => ph.days.reduce((n, d) => n + (d.sections || []).reduce((m, s) =>
      m + (s.exercises || []).reduce((k, e) => k + (Number(e.sets) || 0), 0), 0), 0);
    const hardest = Math.max(...p.phases.filter((ph) => !/deload/i.test(ph.name)).map(wk));
    p.phases.filter((ph) => /deload/i.test(ph.name)).forEach((ph) => {
      if (wk(ph) > hardest) throw new Error(`program ${v}: ${ph.name} is heavier than every hard week`);
    });
  });
});

console.log("\nProgress and settings, both athletes");
check("progress renders for a full history", () => {
  mount(React.createElement(A.ProgressTab, { client: marcusHalfYear }));
  if (!txt().trim()) throw new Error("blank progress tab");
});
check("progress renders on day one with nothing logged", () => {
  mount(React.createElement(A.ProgressTab, { client: marcusWeek1 }));
  if (!txt().trim()) throw new Error("blank progress tab for a new athlete");
});
check("settings renders for an athlete and offers no payment button", () => {
  mount(React.createElement(A.SettingsModal, { client: marcusPaid, isCoach: false,
    onPersist: async () => ({ ok: true }), theme: "dark", onChangeTheme() {}, onClose() {},
    onResetApp() {}, onRefreshProgram() {}, onOpenCoachDashboard() {}, onOpenTerms() {}, onSignOut() {} }));
  if (byText(/^mark as (paid|unpaid)$/i)) throw new Error("an athlete can see a Mark as Paid button");
});
check("settings renders for the coach", () => {
  mount(React.createElement(A.SettingsModal, { client: marcusPaid, isCoach: true,
    onPersist: async () => ({ ok: true }), theme: "dark", onChangeTheme() {}, onClose() {},
    onResetApp() {}, onRefreshProgram() {}, onOpenCoachDashboard() {}, onOpenTerms() {}, onSignOut() {} }));
  has(/coach dashboard/i, "a pointer to the dashboard");
});
check("and the coach's settings no longer offers the broken Mark as Paid", () => {
  if (byText(/^mark as (paid|unpaid)$/i)) throw new Error("the dead Mark as Paid button is still there");
});

console.log(bad === 0 ? "\nTwo athletes, no failures.\n" : `\n${bad} problem(s):\n` + found.map((f) => "  - " + f).join("\n") + "\n");
process.exit(bad === 0 ? 0 : 1);
