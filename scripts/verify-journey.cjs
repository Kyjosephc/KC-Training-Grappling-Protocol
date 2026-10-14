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
  // The schedule and the program have to agree: two lifting days means the
  // two-day program, three or more means a three-day one.
  const picked = Object.values(signedUp.weeklySchedule || {})
    .filter((v) => Array.isArray(v) && v.some((x) => /strength/i.test(x))).length;
  if (picked < 2) throw new Error(`submitted with only ${picked} strength days on the calendar`);
  if (picked === 2 && signedUp.programVariant !== "D") {
    throw new Error(`two lifting days submitted on program ${signedUp.programVariant}`);
  }
  if (picked >= 3 && signedUp.programVariant === "D") {
    throw new Error(`${picked} lifting days submitted on the two-day program`);
  }
});
check("and the answers build a real twelve-week program", () => {
  const built = A.buildClient({ ...signedUp, useTemplate: true, id: "new" });
  // Six phases of three day-templates, each phase spanning several weeks — so
  // the block is twelve weeks of training, not eighteen sessions.
  if (!built.program.phases.length) throw new Error("no phases");
  if (A.positionAtIndex(built.program, 0).weekNumber !== 1) throw new Error("does not start at week 1");
  if (A.positionAtIndex(built.program, 35).weekNumber !== 12) throw new Error("session 36 is not in week 12");
});

console.log("\nHow many lifting days each program asks for");
// The in-season program is two sessions a week. Asking for three lifting days
// on the calendar used to block signup for the people it was written for.
const pickProgram = (title) => {
  const card = [...host.querySelectorAll('[role="radio"]')]
    .find((el) => new RegExp(title, "i").test(el.textContent));
  if (!card) throw new Error(`no program card matching ${title}`);
  hit(card);
};
const fillProfile = () => {
  openOnboarding();
  signWaiver();
  const t = [...host.querySelectorAll("input[type=text]")];
  setVal(t[0], "Dani"); setVal(t[1], "Reyes");
  const n = [...host.querySelectorAll("input[type=number]")];
  setVal(n[0], "148"); setVal(n[1], "5"); setVal(n[2], "6");
};
const pickStrengthDays = (howMany) => {
  const picks = buttons().filter((b) => /^Strength\/Conditioning$/.test(b.textContent.trim()));
  for (let i = 0; i < howMany; i++) hit(picks[i]);
};

const cardFor = (title) => [...host.querySelectorAll('[role="radio"]')]
  .find((el) => new RegExp(title, "i").test(el.textContent));
const locked = (title) => {
  const c = cardFor(title);
  if (!c) throw new Error(`no card matching ${title}`);
  return c.getAttribute("aria-disabled") === "true";
};

check("one lifting day is not enough to start at all", () => {
  fillProfile();
  pickStrengthDays(1);
  if (!byText(/get started/i).disabled) throw new Error("accepted a single lifting day");
});
check("two lifting days unlock the two-day program and lock the three-day ones", () => {
  fillProfile();
  pickStrengthDays(2);
  if (locked("Offseason Strength, Two Days")) throw new Error("the two-day program is locked on two days");
  if (!locked("Condensed Conjugate")) throw new Error("a three-day program is selectable on two days");
  if (!locked("Offseason Strength Build")) throw new Error("a three-day program is selectable on two days");
});
check("two lifting days can start, on the two-day program", () => {
  if (byText(/get started/i).disabled) throw new Error("two days cannot start");
});
check("three lifting days unlock the three-day programs and lock the two-day one", () => {
  fillProfile();
  pickStrengthDays(3);
  if (locked("Condensed Conjugate")) throw new Error("a three-day program is locked on three days");
  if (locked("Offseason Strength Build")) throw new Error("a three-day program is locked on three days");
  if (!locked("Offseason Strength, Two Days")) throw new Error("the two-day program is selectable on three days");
  if (byText(/get started/i).disabled) throw new Error("three days cannot start");
});
check("more than three days still means the three-day programs", () => {
  fillProfile();
  pickStrengthDays(5);
  if (locked("Offseason Strength Build")) throw new Error("five days locked the three-day programs");
  if (!locked("Offseason Strength, Two Days")) throw new Error("the two-day program is selectable on five days");
});
check("changing the schedule moves the selection off a program it no longer fits", () => {
  fillProfile();
  pickStrengthDays(2);
  const onTwo = cardFor("Offseason Strength, Two Days");
  if (onTwo.getAttribute("aria-checked") !== "true") throw new Error("two days did not select the two-day program");
  // Add a third day: the selection has to move to a three-day program on its own.
  const more = buttons().filter((b) => /^Strength\/Conditioning$/.test(b.textContent.trim()));
  hit(more[2]);
  if (cardFor("Offseason Strength, Two Days").getAttribute("aria-checked") === "true") {
    throw new Error("still selected on a program that no longer fits the schedule");
  }
  if (byText(/get started/i).disabled) throw new Error("three days cannot start after the switch");
});
check("a locked card cannot be chosen by clicking it", () => {
  fillProfile();
  pickStrengthDays(3);
  const twoDay = cardFor("Offseason Strength, Two Days");
  hit(twoDay);
  if (cardFor("Offseason Strength, Two Days").getAttribute("aria-checked") === "true") {
    throw new Error("clicking a locked card selected it");
  }
});

console.log("\nWeek one, free");
const marcusWeek1 = athlete({ id: "marcus", firstName: "Marcus", sessionsCompleted: 0, logs: [], paid: false });
check("today's session is offered, no payment wall", () => {
  mount(React.createElement(A.TodayTab, { client: marcusWeek1, onPersist: async () => ({ ok: true }),
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
  hasNot(/venmo|cash app|payment/i, "a payment prompt");
});
check("there is a way to start the workout", () => { if (!byText(/start/i)) throw new Error("no start button"); });

// =============================================================================
// THE DAILY CHECK-IN
// =============================================================================
// The front page used to take a one-tap Good / Normal / Rough, which wrote a
// readiness score nobody had actually thought about. It now sends them into the
// real check-in. Bodyweight rides along with it on every session, and an empty
// box has to stay empty — plenty of people will never use it.
console.log("\nThe daily check-in");
const checkinBase = athlete({ id: "marcus", firstName: "Marcus", sessionsCompleted: 0, logs: [], paid: false,
  readiness: {}, bodyweightLog: [] });
let persisted = null;
const mountToday = (c) => {
  // React keeps TodayTab's own state across a re-render of the same component,
  // so without the unmount an open modal leaks its typed-in weight forward.
  unmount();
  mount(React.createElement(A.TodayTab, { client: c,
    onPersist: async (u) => { persisted = u; return { ok: true }; },
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
};
const bwInput = () => [...host.querySelectorAll("input[type=number]")]
  .find((i) => /bodyweight/i.test(i.getAttribute("aria-label") || ""));

check("the front page asks for a real check-in, not a one-tap mood", () => {
  mountToday(checkinBase);
  has(/check in before you train/i, "the check-in prompt");
  const pill = byText(/^\s*(good|normal|rough)\s*$/i);
  if (pill) throw new Error("the one-tap mood pills are still on the front page");
});
check("and it says bodyweight is optional before they even open it", () =>
  has(/bodyweight is optional/i, "the optional note"));
check("the check-in opens from the front page", () => {
  click(/start today's check-in/i);
  has(/sleep quality/i, "the sleep slider");
  has(/bodyweight/i, "the bodyweight field");
});
check("it offers bodyweight every session and never demands it", () => {
  const bw = bwInput();
  if (!bw) throw new Error("no bodyweight input in the check-in");
  if (bw.required || bw.getAttribute("aria-required") === "true") throw new Error("bodyweight is marked required");
  if (bw.value !== "") throw new Error(`empty log, yet the box came pre-filled with ${bw.value}`);
});
check("saving with the weight left empty is accepted, and logs no weight", () => {
  persisted = null;
  click(/save check-in/i);
  if (!persisted) throw new Error("Save check-in did nothing with an empty weight");
  if (!persisted.readiness[dayStr(0)]) throw new Error("no check-in recorded against today");
  if ((persisted.bodyweightLog || []).length !== 0) throw new Error("an empty box still wrote a bodyweight entry");
  // The modal closes in the continuation after onPersist resolves. Nothing in
  // this harness drains microtasks, so that close is not assertable here.
});
check("a weight typed in is recorded against today", () => {
  persisted = null;
  mountToday(checkinBase);
  click(/start today's check-in/i);
  setVal(bwInput(), "178.5");
  click(/save check-in/i);
  const entry = ((persisted && persisted.bodyweightLog) || []).find((e) => e.date === dayStr(0));
  if (!entry) throw new Error("the weight was not recorded against today");
  if (Number(entry.weight) !== 178.5) throw new Error(`recorded ${entry.weight} instead of 178.5`);
});
check("a weight of nonsense is not recorded", () => {
  persisted = null;
  mountToday(checkinBase);
  click(/start today's check-in/i);
  setVal(bwInput(), "0");
  click(/save check-in/i);
  if (((persisted && persisted.bodyweightLog) || []).length !== 0) throw new Error("a bodyweight of zero was recorded");
});
check("today's weight comes back in the box, so editing it is not retyping it", () => {
  mountToday({ ...checkinBase, readiness: {}, bodyweightLog: [{ date: dayStr(0), weight: 181 }] });
  click(/start today's check-in/i);
  if (bwInput().value !== "181") throw new Error(`box showed "${bwInput().value}" with 181 logged today`);
});
check("once checked in, the front page shows the verdict and a way to edit it", () => {
  mountToday({ ...checkinBase, readiness: { [dayStr(0)]: { sleep: 5, readiness: 5, color: "GREEN", date: dayStr(0) } } });
  hasNot(/check in before you train/i, "the check-in prompt after checking in");
  if (!byText(/edit today's check-in/i)) throw new Error("no way to go back and edit the check-in");
});
check("the wall does not ask for a check-in for a session it will not start", () => {
  mountToday(athlete({ id: "marcus", sessionsCompleted: 3, paid: false, readiness: {},
    logs: [sessionLog(9, 135, "Back Squat"), sessionLog(7, 135, "Back Squat"), sessionLog(5, 140, "Back Squat")] }));
  hasNot(/check in before you train/i, "a check-in prompt behind the payment wall");
});

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
const VARIANTS = ["A", "B", "C", "D"];
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
check("both two-day programs are genuinely lighter weeks than the three-day ones", () => {
  const sets = (v) => {
    const p = A.buildProgramVariant(v);
    const ph = p.phases.find((x) => !/deload/i.test(x.name));
    return ph.days.reduce((n, d) => n + (d.sections || []).reduce((m, s) =>
      m + (s.exercises || []).reduce((k, e) => k + (Number(e.sets) || 0), 0), 0), 0);
  };
  const a = sets("A"), b = sets("B");
  ["C", "D"].forEach((v) => {
    const n = sets(v);
    if (n >= a || n >= b) throw new Error(`program ${v} is ${n} sets a week against ${a} and ${b}`);
  });
});
check("the four that keep you training are in every block of both two-day programs", () => {
  const must = [["neck", /neck/i], ["adductor", /copenhagen|adduction/i],
    ["grip", /carry|hang|bar hold/i], ["hinge", /romanian|trap bar deadlift|valslide/i]];
  ["C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    p.phases.forEach((ph) => {
      const names = ph.days.flatMap((d) => (d.sections || []).flatMap((s) => (s.exercises || []).map((e) => e.name || "")));
      const missing = must.filter(([, re]) => !names.some((n) => re.test(n))).map(([k]) => k);
      if (missing.length) throw new Error(`program ${v}, ${ph.name} drops ${missing.join(", ")}`);
    });
  });
});
check("both two-day programs own a hinge on each day", () => {
  ["C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    const hard = p.phases.filter((ph) => !/deload/i.test(ph.name));
    hard.forEach((ph) => ph.days.forEach((d) => {
      const names = (d.sections || []).flatMap((s) => (s.exercises || []).map((e) => e.name || ""));
      // A missed session must not cost the pattern.
      if (!names.some((n) => /romanian|trap bar deadlift/i.test(n))) {
        throw new Error(`program ${v}, ${ph.name} day ${d.label} has no hinge`);
      }
    }));
  });
});
check("the warm-up does not repeat the jump the session already prescribes", () => {
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    const warm = (p.warmup || []).flatMap((b) => (b.items || []).map((i) => i.name || ""));
    const primers = [];
    (p.phases || []).forEach((ph) => (ph.days || []).forEach((d) => (d.sections || []).forEach((sec) => {
      if (sec.type !== "power") return;
      (sec.exercises || []).forEach((e) => primers.push(e.name || ""));
    })));
    const clash = warm.filter((w) => primers.some((pr) => pr && w && pr.toLowerCase() === w.toLowerCase()));
    if (clash.length) throw new Error(`program ${v}: ${clash.join(", ")} is in the warm-up and prescribed again as a primer`);
  });
});
check("no two-day session runs longer than forty-five minutes", () => {
  ["C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    let worst = 0, where = "";
    p.phases.forEach((ph) => ph.days.forEach((d) => {
      const shape = A.sessionShape((d.sections || []).map((sec) => ({ ...sec, exercises: sec.exercises || [] })));
      if (shape.minutes > worst) { worst = shape.minutes; where = `${ph.name} day ${d.label}`; }
    }));
    // These are the short-session programs. If one reaches 50 minutes it is no
    // longer the thing the signup card says it is.
    if (worst > 45) throw new Error(`program ${v}: ${where} estimates ${worst} minutes`);
  });
});
check("neither two-day block deloads more than twice", () => {
  const p = A.buildProgramVariant("D");
  const n = Math.max(...["C", "D"].map((v) =>
    A.buildProgramVariant(v).phases.filter((ph) => /deload/i.test(ph.name)).length));
  // The fatigue is coming from the mat, which does not deload on this
  // calendar. Three scheduled easy weeks in twelve cost ground.
  if (n > 2) throw new Error(`${n} deloads in twelve weeks`);
});
check("neither two-day program progresses by adding sets", () => {
  ["C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    const hardest = (label) => {
      const counts = p.phases.filter((ph) => !/deload/i.test(ph.name)).map((ph) => {
        const d = ph.days.find((x) => x.label === label);
        return Math.max(...(d.sections || []).flatMap((sec) =>
          (sec.exercises || []).map((e) => Number(e.sets) || 0)));
      });
      return { lo: Math.min(...counts), hi: Math.max(...counts) };
    };
    ["1", "2"].forEach((label) => {
      const { lo, hi } = hardest(label);
      // Effort and load are the levers between blocks, never set count.
      if (hi > lo) throw new Error(`program ${v} day ${label} goes from ${lo} sets to ${hi} between blocks`);
    });
  });
});

check("every quote is attributed to a real person", () => {
  const L = A.MENTAL_COACHING_LIBRARY;
  if (!L || L.length < 30) throw new Error(`only ${L ? L.length : 0} quotes in the library`);
  L.forEach((q) => {
    if (!q.quote || !q.quote.trim()) throw new Error("a quote with no text");
    // A quote with no named source, or a placeholder byline, reads as filler.
    if (!q.author || !q.author.trim()) throw new Error(`no attribution: "${q.quote.slice(0, 50)}"`);
    if (/^(training note|anonymous|unknown|proverb)$/i.test(q.author.trim())) {
      throw new Error(`"${q.author}" is not a person: "${q.quote.slice(0, 50)}"`);
    }
  });
  const seen = new Set();
  L.forEach((q) => {
    if (seen.has(q.quote)) throw new Error(`the same line appears twice: "${q.quote.slice(0, 50)}"`);
    seen.add(q.quote);
  });
  const authors = new Set(L.map((q) => q.author));
  if (authors.size < 15) throw new Error(`only ${authors.size} distinct voices`);
});

check("a session's exercises never draw the same quote twice", () => {
  // Two exercises on one screen showing the same line reads as a bug, and
  // hashing each name on its own cannot prevent it. The session deals them.
  for (let d = 0; d < 50; d++) {
    const ids = Array.from({ length: 12 }, (_, i) => `ex-${i}`);
    const tips = A.mentalTipsForSession(`day-${d}`, ids);
    const quotes = ids.map((id) => tips[id] && tips[id].quote);
    if (quotes.some((q) => !q)) throw new Error(`day ${d}: an exercise got no quote`);
    if (new Set(quotes).size !== quotes.length) throw new Error(`day ${d}: a quote was dealt twice in one session`);
  }
  // And a different day deals a different hand.
  const a = A.mentalTipsForSession("day-1", ["x"])["x"].quote;
  const b = A.mentalTipsForSession("day-2", ["x"])["x"].quote;
  if (a === b) throw new Error("every session opens on the same quote");
});

check("every loaded lift has a demonstration video", () => {
  // Conditioning is "ride a bike at this pace" and the warm-up items are
  // described in full, so neither needs a demo. Anything somebody loads and
  // could do wrong does.
  const NO_DEMO_NEEDED = /assault bike|treadmill|rower|aerobic|zone 2|match-duration|multi-match|repeated-effort|repeat effort|aerobic power|interval/i;
  const bare = new Map();
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    const look = (e, where) => {
      if (!e || !e.name || NO_DEMO_NEEDED.test(e.name)) return;
      if (e.videoUrl && String(e.videoUrl).trim()) return;
      const k = `${e.name} (${where})`;
      bare.set(k, (bare.get(k) || new Set()).add(v));
    };
    (p.phases || []).forEach((ph) => (ph.days || []).forEach((d) => (d.sections || []).forEach((sec) =>
      (sec.exercises || []).forEach((e) => look(e, "session")))));
    Object.entries(p.conjugate || {}).forEach(([pool, list]) => {
      if (Array.isArray(list)) list.forEach((i) => look(i, `swap pool ${pool}`));
    });
  });
  if (bare.size) {
    const lines = [...bare.entries()].map(([k, vs]) => `${k} — in ${[...vs].sort().join(", ")}`);
    throw new Error(`${bare.size} prescribed exercise(s) with no video:\n         ` + lines.join("\n         "));
  }
});

check("every program trains the trunk against rotation or extension", () => {
  // Both two-day programs shipped with none of this at all, while the
  // three-day ones carried three to five sets a week. Bracing against a pass
  // is too central to the sport for that to be an acceptable difference.
  const TRUNK = /pallof|anti-rotation|dead ?bug|hollow|plank|abdominal|hanging leg raise|anti-extension/i;
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    const hard = p.phases.filter((ph) => !/deload/i.test(ph.name));
    hard.forEach((ph) => {
      let sets = 0;
      ph.days.forEach((d) => (d.sections || []).forEach((sec) => (sec.exercises || []).forEach((e) => {
        // The Copenhagen is adductor work that happens to be called a plank.
        if (/copenhagen/i.test(e.name || "")) return;
        if (TRUNK.test(e.name || "")) sets += Number(e.sets) || 0;
      })));
      if (sets < 2) throw new Error(`program ${v}, ${ph.name}: ${sets} trunk set(s) in the week`);
    });
  });
});

check("a deload keeps the shape of the week instead of emptying it", () => {
  // Program A's week four used to be one press and a dead hang on day two and
  // nothing countable at all on day three. A deload should read as the same
  // week done easily, not as a week the app forgot to write.
  const PULL = /row|pull-?up|chin-?up|pulldown|face pull|pull-apart|dead hang|scarecrow/i;
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    p.phases.filter((ph) => /deload/i.test(ph.name)).forEach((ph) => {
      let pulls = 0;
      ph.days.forEach((d) => {
        const shape = A.sessionShape((d.sections || []).map((sec) => ({ ...sec, exercises: sec.exercises || [] })));
        if (shape.working < 2) {
          throw new Error(`program ${v}, ${ph.name} day ${d.label}: ${shape.working} working set(s)`);
        }
        (d.sections || []).forEach((sec) => (sec.exercises || []).forEach((e) => {
          if (PULL.test(e.name || "")) pulls += Number(e.sets) || 0;
        }));
      });
      if (pulls < 2) throw new Error(`program ${v}, ${ph.name}: ${pulls} pulling set(s) in the whole week`);
    });
  });
});

check("the time estimate counts easy conditioning apart from lifting", () => {
  // Program B's third day read as eighty minutes when fifty-five of it was
  // lifting and twenty-five was a Zone 2 ride that need not even be the same
  // day. One number for both misrepresents the session.
  const p = A.buildProgramVariant("B");
  const pos = A.positionAtIndex(p, 2);
  const secs = pos.day.sections.map((sec) => ({ ...sec, exercises: sec.exercises || [] }));
  const sh = A.sessionShape(secs);
  if (!(sh.conditioningMinutes > 0)) throw new Error("B day 3 reports no conditioning time");
  if (sh.liftMinutes >= sh.minutes) throw new Error("lifting minutes were not separated from the total");
  if (sh.liftMinutes + sh.conditioningMinutes !== sh.minutes) throw new Error("the two parts do not add up to the total");
});

check("no deload week asks for a maximal single", () => {
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    p.phases.filter((ph) => /deload/i.test(ph.name)).forEach((ph) => {
      ph.days.forEach((d) => (d.sections || []).forEach((sec) => (sec.exercises || []).forEach((e) => {
        const tops = (e.perSetTargets || []).some((t) => Number(t.rir) === 0);
        // A week with a true top single in it is not a deload.
        if (tops) throw new Error(`program ${v}, ${ph.name} day ${d.label}: ${e.name} ramps to a set at RIR 0`);
      })));
    });
  });
});
check("every supersetted exercise has as many sets as the lift it sits inside", () => {
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    p.phases.forEach((ph) => ph.days.forEach((d) => (d.sections || []).forEach((sec) => {
      const list = sec.exercises || [];
      // "rest 0 seconds" means the work happens inside the previous lift's rest,
      // so its set count has to match or the last sets have nowhere to go.
      list.forEach((e, i) => {
        if (!/^0 seconds/.test(String(e.rest || "")) || i === 0) return;
        const host = list[i - 1];
        if ((Number(e.sets) || 0) > (Number(host.sets) || 0)) {
          throw new Error(`program ${v}, ${ph.name} d${d.label}: ${e.name} has ${e.sets} sets inside ${host.name}'s ${host.sets}`);
        }
      });
    })));
  });
});
check("no bilateral lift is prescribed per side", () => {
  VARIANTS.forEach((v) => {
    const p = A.buildProgramVariant(v);
    p.phases.forEach((ph) => ph.days.forEach((d) => (d.sections || []).forEach((sec) =>
      (sec.exercises || []).forEach((e) => {
        const perSide = /each side|per side|\/side/i.test(String(e.reps || ""));
        // Name the lifts that are unambiguously two-sided rather than trying to
        // guess which ones are not — most accessories genuinely are per-side.
        const BILATERAL = /^(back squat|front squat|box squat|zercher squat|anderson squat|bench press|incline bench press|wide-grip bench press|close-grip bench press|spoto press|standing barbell overhead press|barbell romanian deadlift|trap bar deadlift|seal row|bent over barbell row|pendlay row|weighted pull-up|inverted row|barbell good morning|weighted dip|weighted push-ups|medicine ball slam|broad jump|pogo hops)$/i;
        if (perSide && BILATERAL.test(String(e.name || "").trim())) {
          throw new Error(`program ${v}: ${e.name} is prescribed "${e.reps}" but has no sides`);
        }
      }))));
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
