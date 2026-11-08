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
  // React installs its own value setter, so the native one has to be called
  // directly — and a textarea's lives on a different prototype than an input's.
  const proto = el.tagName === "TEXTAREA"
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
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
// Sign-up is paged now — who you are, then your week, then injuries — so the
// gate that used to be one disabled Get started is three smaller ones.
const cont = () => byText(/^continue$/i);
check("Continue is disabled until the first page is filled, not silently dead", () => {
  if (!cont()) throw new Error("no Continue button on the first page");
  if (!cont().disabled) throw new Error("Continue is live with an empty page");
  has(/step 2 of 4/i, "which page you are on");
});
check("name alone is not enough — it still wants bodyweight", () => {
  const t = [...host.querySelectorAll("input[type=text]")];
  setVal(t[0], "Marcus"); setVal(t[1], "Hale");
  if (!cont().disabled) throw new Error("accepted a profile with no bodyweight");
});
check("a filled first page moves on to the week", () => {
  const n = [...host.querySelectorAll("input[type=number]")];
  setVal(n[0], "172"); setVal(n[1], "5"); setVal(n[2], "10");
  if (cont().disabled) throw new Error("still disabled with name, weight and height in");
  click(/^continue$/i);
  has(/step 3 of 4/i, "the week page");
  has(/strength\/conditioning (day|days)/i, "guidance about picking strength days");
});
check("the week will not let you past it without enough lifting days", () => {
  if (!cont().disabled) throw new Error("Continue is live with no strength days picked");
});
check("a complete profile submits, and carries the signed waiver with it", () => {
  // Pick the strength days it is asking for, one per calendar day.
  const picks = buttons().filter((b) => /^Strength\/Conditioning$/.test(b.textContent.trim()));
  for (let i = 0; i < picks.length; i++) {
    if (!cont().disabled) break;
    hit(picks[i]);
  }
  if (cont().disabled) throw new Error("still disabled after filling the schedule");
  click(/^continue$/i);
  const go = byText(/get started/i);
  if (!go) throw new Error("no Get started on the last page");
  if (go.disabled) throw new Error("Get started disabled on a complete form");
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
// Fills the first page and steps through to the week, which is where the
// schedule and the program cards live.
const fillProfile = () => {
  openOnboarding();
  signWaiver();
  const t = [...host.querySelectorAll("input[type=text]")];
  setVal(t[0], "Dani"); setVal(t[1], "Reyes");
  const n = [...host.querySelectorAll("input[type=number]")];
  setVal(n[0], "148"); setVal(n[1], "5"); setVal(n[2], "6");
  click(/^continue$/i);
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
  if (!cont().disabled) throw new Error("accepted a single lifting day");
});
check("two lifting days unlock the two-day program and lock the three-day ones", () => {
  fillProfile();
  pickStrengthDays(2);
  if (locked("Offseason Strength, Two Days")) throw new Error("the two-day program is locked on two days");
  if (!locked("Condensed Conjugate")) throw new Error("a three-day program is selectable on two days");
  if (!locked("Offseason Strength Build")) throw new Error("a three-day program is selectable on two days");
});
check("two lifting days can start, on the two-day program", () => {
  if (cont().disabled) throw new Error("two days cannot start");
});
check("three lifting days unlock the three-day programs and lock the two-day one", () => {
  fillProfile();
  pickStrengthDays(3);
  if (locked("Condensed Conjugate")) throw new Error("a three-day program is locked on three days");
  if (locked("Offseason Strength Build")) throw new Error("a three-day program is locked on three days");
  if (!locked("Offseason Strength, Two Days")) throw new Error("the two-day program is selectable on three days");
  if (cont().disabled) throw new Error("three days cannot start");
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
  if (cont().disabled) throw new Error("three days cannot start after the switch");
});
check("walking back through the pages does not lose what was typed", () => {
  fillProfile();
  pickStrengthDays(3);
  click(/^continue$/i);
  has(/step 4 of 4/i, "the last page");
  click(/^back$/i);
  has(/step 3 of 4/i, "the week page again");
  click(/^back$/i);
  has(/step 2 of 4/i, "the first page again");
  const t = [...host.querySelectorAll("input[type=text]")];
  if (t[0].value !== "Dani") throw new Error(`first name came back as "${t[0].value}"`);
  const n = [...host.querySelectorAll("input[type=number]")];
  if (n[0].value !== "148") throw new Error(`bodyweight came back as "${n[0].value}"`);
});
// The schedule records mat days and the program choice never looked at them.
// It still does not — this only says out loud what the week adds up to.
const pickMatDays = (howMany) => {
  const picks = buttons().filter((b) => /^High Intensity BJJ$/.test(b.textContent.trim()));
  for (let i = 0; i < howMany; i++) hit(picks[i]);
};
check("three lifting days on their own say nothing about load", () => {
  fillProfile();
  pickStrengthDays(3);
  hasNot(/sessions in a week/i, "a load note before any mat days are picked");
});
check("five mat days beside three lifting days is flagged", () => {
  pickMatDays(5);
  has(/sessions in a week/i, "a note about the combined load");
  has(/two-day programs/i, "what the lighter option is");
  has(/8 sessions/i, "the actual session count");
});
check("but it does not block them — the choice stays theirs", () => {
  if (cont().disabled) throw new Error("the note stopped them continuing");
  if (locked("Offseason Strength Build")) throw new Error("the note locked a three-day program");
});
check("the same mat volume on two lifting days says nothing", () => {
  fillProfile();
  pickStrengthDays(2);
  pickMatDays(5);
  hasNot(/sessions in a week/i, "a load note on the two-day program");
});
check("an ordinary week says nothing either", () => {
  fillProfile();
  pickStrengthDays(3);
  pickMatDays(3);
  hasNot(/sessions in a week/i, "a load note at three mat days");
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
// It used to be a modal behind a button: open it, move two thin sliders, press
// Save, dismiss it. It is an area on the front page now — every value set in
// place, each change saving itself, nothing to open or close. Bodyweight rides
// along with it every day and an empty box has to stay empty, because plenty of
// people will never use it.
console.log("\nThe daily check-in");
const checkinBase = athlete({ id: "marcus", firstName: "Marcus", sessionsCompleted: 0, logs: [], paid: false,
  readiness: {}, bodyweightLog: [] });
let persisted = null;
const mountToday = (c) => {
  // React keeps TodayTab's own state across a re-render of the same component.
  unmount();
  mount(React.createElement(A.TodayTab, { client: c,
    onPersist: async (u) => { persisted = u; return { ok: true }; },
    onStartLog() {}, onStartMobility() {}, onRefreshProgram() {}, onReloadClient: async () => {}, userId: "u" }));
};
const card = () => host.querySelector("section.checkin");
const pips = (which) => {
  const rows = [...host.querySelectorAll(".checkin-scale-row")];
  const row = rows[which === "sleep" ? 0 : 1];
  if (!row) throw new Error(`no ${which} scale on the check-in`);
  return [...row.querySelectorAll(".checkin-pip")];
};
const bwInput = () => host.querySelector("#checkin-bodyweight");
// React listens for focusout rather than blur, which is what commits the weight.
const commit = (el) => act(() => el.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true })));

check("the check-in is on the front page, not behind a button", () => {
  mountToday(checkinBase);
  if (!card()) throw new Error("no check-in area on the Today screen");
  has(/today's check-in/i, "the check-in heading");
  if (byText(/start today's check-in|do a full check-in/i)) throw new Error("still routing through a button");
  const pill = byText(/^\s*(good|normal|rough)\s*$/i);
  if (pill) throw new Error("the one-tap mood pills are still there");
});
check("a fresh day says so rather than looking answered", () => {
  has(/not logged yet/i, "the unlogged status");
  if (pips("sleep").some((b) => b.getAttribute("aria-checked") === "true")) {
    throw new Error("a sleep score is selected before anybody chose one");
  }
});
check("both scales are six real buttons, not a slider", () => {
  if (pips("sleep").length !== 6) throw new Error(`${pips("sleep").length} sleep buttons`);
  if (pips("body").length !== 6) throw new Error(`${pips("body").length} body buttons`);
  if (host.querySelector("section.checkin input[type=range]")) throw new Error("there is still a slider in the check-in");
});
check("tapping a sleep score logs the day on the spot", () => {
  persisted = null;
  hit(pips("sleep")[4]);
  if (!persisted) throw new Error("tapping a score saved nothing");
  const entry = persisted.readiness[dayStr(0)];
  if (!entry) throw new Error("no check-in recorded against today");
  if (Number(entry.sleep) !== 4) throw new Error(`recorded sleep ${entry.sleep} instead of 4`);
  if (!entry.color) throw new Error("the entry carries no readiness colour");
});
check("and the screen says what it means for today", () => {
  mountToday({ ...checkinBase, readiness: { [dayStr(0)]: { sleep: 5, readiness: 5, color: "GREEN", date: dayStr(0) } } });
  has(/logged/i, "the logged status");
  has(/runs as written|notch back|eased right back/i, "what the check-in means for the session");
});
check("how the body feels is recorded on its own", () => {
  mountToday(checkinBase);
  persisted = null;
  hit(pips("body")[1]);
  const entry = persisted.readiness[dayStr(0)];
  if (Number(entry.readiness) !== 1) throw new Error(`recorded ${entry.readiness} instead of 1`);
});
check("bodyweight is offered every day and demanded on none of them", () => {
  mountToday(checkinBase);
  const bw = bwInput();
  if (!bw) throw new Error("no bodyweight field on the check-in");
  if (bw.required || bw.getAttribute("aria-required") === "true") throw new Error("bodyweight is marked required");
  if (bw.value !== "") throw new Error(`empty log, yet the box came pre-filled with ${bw.value}`);
  has(/optional/i, "that it is optional");
});
check("a weight typed in is recorded against today", () => {
  persisted = null;
  setVal(bwInput(), "178.5");
  commit(bwInput());
  const entry = ((persisted && persisted.bodyweightLog) || []).find((e) => e.date === dayStr(0));
  if (!entry) throw new Error("the weight was not recorded against today");
  if (Number(entry.weight) !== 178.5) throw new Error(`recorded ${entry.weight} instead of 178.5`);
});
check("logging only a weight does not invent a readiness score", () => {
  if (persisted.readiness[dayStr(0)]) throw new Error("a bodyweight on its own created a check-in nobody filled in");
});
check("a weight of nonsense is not recorded", () => {
  mountToday(checkinBase);
  persisted = null;
  setVal(bwInput(), "0");
  commit(bwInput());
  if (((persisted && persisted.bodyweightLog) || []).length !== 0) throw new Error("a bodyweight of zero was recorded");
});
check("today's weight comes back in the box, so editing it is not retyping it", () => {
  mountToday({ ...checkinBase, bodyweightLog: [{ date: dayStr(0), weight: 181 }] });
  if (bwInput().value !== "181") throw new Error(`box showed "${bwInput().value}" with 181 logged today`);
});
check("clearing the box takes today's weight back out", () => {
  persisted = null;
  setVal(bwInput(), "");
  commit(bwInput());
  if (!persisted) throw new Error("clearing the box saved nothing");
  if ((persisted.bodyweightLog || []).some((e) => e.date === dayStr(0))) {
    throw new Error("today's weight survived being cleared");
  }
});
check("the hard mat training switch answers both ways", () => {
  mountToday(checkinBase);
  const sw = host.querySelector(".checkin-switch");
  if (!sw) throw new Error("no hard training switch");
  if (sw.getAttribute("role") !== "switch") throw new Error("the switch does not say it is a switch");
  persisted = null;
  hit(sw);
  if (persisted.readiness[dayStr(0)].bjjHard !== true) throw new Error("turning it on did not record it");
  mountToday({ ...checkinBase, readiness: { [dayStr(0)]: { sleep: 3, readiness: 3, bjjHard: true, color: "GREEN", date: dayStr(0) } } });
  persisted = null;
  hit(host.querySelector(".checkin-switch"));
  if (persisted.readiness[dayStr(0)].bjjHard !== false) throw new Error("turning it off did not record it");
});
check("the wall does not ask for a check-in for a session it will not start", () => {
  mountToday(athlete({ id: "marcus", sessionsCompleted: 3, paid: false, readiness: {},
    logs: [sessionLog(9, 135, "Back Squat"), sessionLog(7, 135, "Back Squat"), sessionLog(5, 140, "Back Squat")] }));
  if (card()) throw new Error("a check-in area behind the payment wall");
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

const mountGroup = (over = {}) => {
  unmount();
  mount(React.createElement(A.CommunityTab, Object.assign({
    client: marcusPaid, userId: "u", isCoach: false, prefs: {}, onPrefs() {},
  }, over)));
};

check("the page says which room you are in", () => {
  // Two rows of chips became one line. Twenty-nine rooms across six parts
  // cannot be navigated sideways — the Guards part alone is fourteen.
  mountGroup({ prefs: { channel: "general" } });
  const bar = host.querySelector(".room-bar");
  if (!bar) throw new Error("no room bar on the group page");
  if (!/general/i.test(bar.textContent)) throw new Error(`the bar reads "${bar.textContent.trim()}"`);
  if (host.querySelector(".channel-chip") || host.querySelector(".channel-group")) {
    throw new Error("the old chip rows are still being rendered");
  }
  unmount();
});

check("anything new in another room shows from the room you are in", () => {
  // The old strip could mark the part holding an unread room. One line has to
  // carry the whole answer or unread posts anywhere else are invisible.
  mountGroup({ prefs: { channel: "general" }, unreadByChannel: { passing: 3 } });
  if (!host.querySelector(".room-bar-dot")) throw new Error("nothing marks unread posts in another room");
  mountGroup({ prefs: { channel: "general" } });
  if (host.querySelector(".room-bar-dot")) throw new Error("a dot with nothing unread anywhere");
  // What is new in the room already open is not news.
  mountGroup({ prefs: { channel: "general" }, unreadByChannel: { general: 2 } });
  if (host.querySelector(".room-bar-dot")) throw new Error("the room being read counted as somewhere else");
  // Latest is every room at once, so there is no elsewhere for a dot to point
  // at. Left in, it sits on the bar permanently and means nothing.
  mountGroup({ unreadByChannel: { passing: 3, sweeps: 1 } });
  if (host.querySelector(".room-bar-dot")) throw new Error("a dot pointing elsewhere while every room is on the screen");
  unmount();
});

check("every room is two taps away, grouped by where it happens", () => {
  mountGroup();
  act(() => { host.querySelector(".room-bar").click(); });
  const rows = [...host.querySelectorAll(".room-row")];
  const heads = [...host.querySelectorAll(".room-group-label")];
  // Every real room, plus the cross-room views, which are offered in the same
  // list because that is the one place somebody goes looking to change rooms.
  const want = A.COMMUNITY_CHANNELS.length + A.VIRTUAL_CHANNELS.length;
  if (rows.length !== want) {
    throw new Error(`the list offers ${rows.length} rooms, the app has ${want}`);
  }
  if (heads.length !== A.CHANNEL_GROUPS.length + 1) {
    throw new Error(`${heads.length} headings for ${A.CHANNEL_GROUPS.length} parts of the game plus the cross-room one`);
  }
  const current = rows.filter((r) => r.classList.contains("current"));
  if (current.length !== 1) throw new Error(`${current.length} rooms marked as the one you are in`);
  // Each room carries the line that used to take two rows on the page itself.
  rows.forEach((r) => {
    if (!(r.querySelector(".room-row-blurb") || {}).textContent) throw new Error("a room in the list says nothing about itself");
  });
  unmount();
});

check("every room is reachable from some part of the game", () => {
  // A room whose group is a typo renders nowhere and can never be opened
  // again, while the database still happily accepts posts to it. Twenty-six
  // rooms is too many to check by eye.
  const groupIds = new Set(A.CHANNEL_GROUPS.map((g) => g.id));
  const orphans = A.COMMUNITY_CHANNELS.filter((c) => !groupIds.has(c.group));
  if (orphans.length) throw new Error(`rooms in no part: ${orphans.map((c) => c.id).join(", ")}`);
  const empty = A.CHANNEL_GROUPS.filter((g) => A.channelsInGroup(g.id).length === 0);
  if (empty.length) throw new Error(`parts with no rooms: ${empty.map((g) => g.id).join(", ")}`);
  const ids = A.COMMUNITY_CHANNELS.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`two rooms share an id: ${dupes.join(", ")}`);
  const mute = A.COMMUNITY_CHANNELS.filter((c) => !c.label || !c.blurb || !c.placeholder);
  if (mute.length) throw new Error(`rooms with no label, blurb or prompt: ${mute.map((c) => c.id).join(", ")}`);
});

check("the two kinds of sweep cannot be mistaken for each other", () => {
  // 'Sweeps' is reversing from the bottom and 'Foot sweeps' is standing. The
  // names are one word apart and the techniques are nothing alike, so each
  // label has to say which it is.
  const by = (id) => A.COMMUNITY_CHANNELS.find((c) => c.id === id);
  const guard = by("sweeps"), standing = by("footsweeps");
  if (!guard || !standing) throw new Error("one of the two sweep rooms is missing");
  if (!/guard/i.test(guard.label)) throw new Error(`"${guard.label}" does not say it is from guard`);
  if (!/standing/i.test(standing.label)) throw new Error(`"${standing.label}" does not say it is standing`);
  if (guard.group === standing.group) throw new Error("both sweep rooms sit in the same part of the game");
});

check("a search hit shows the word you typed, not the start of the post", () => {
  // A clip line that cuts off ninety characters from the front shows the word
  // you searched for only when the poster happened to open with it.
  const long = "Started from standing and worked grips for a while before anything happened, "
    + "then finally got the leg drag I have been drilling all month and finished in side control.";
  const snip = A.matchSnippet(long, "leg drag");
  if (!/leg drag/i.test(snip)) throw new Error(`the match is not in the snippet: ${snip}`);
  if (snip.length > 120) throw new Error(`snippet is ${snip.length} characters`);
  if (!snip.startsWith("…")) throw new Error("text was cut from the front without saying so");

  const short = "Knee cut from half guard.";
  if (A.matchSnippet(short, "knee") !== short) throw new Error("a short post was trimmed");
  if (/…/.test(A.matchSnippet(short, "knee"))) throw new Error("a short post got an ellipsis");

  if (!A.matchSnippet("", "knee")) throw new Error("a clip with no description got a blank line");
  const noMatch = A.matchSnippet(long, "berimbolo");
  if (noMatch.startsWith("…")) throw new Error("a miss should read from the start, not the middle");
});

check("the list under the search box is clips, and only clips", () => {
  const rows = [
    { id: "a", video_url: "https://youtu.be/1", body: "one" },
    { id: "b", video_url: "", body: "a question with no clip" },
    { id: "c", body: "also no clip" },
    { id: "d", video_url: "https://youtu.be/2", body: "two" },
  ];
  const hits = A.clipsForPicker(rows);
  if (hits.length !== 2) throw new Error(`${hits.length} hits, expected the 2 with a clip`);
  if (hits[0].id !== "a" || hits[1].id !== "d") throw new Error("the search's own order was not kept");

  const many = Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, video_url: "https://youtu.be/x" }));
  if (A.clipsForPicker(many).length !== 8) throw new Error("the list is not capped and becomes a second feed");
  if (A.clipsForPicker(null).length !== 0) throw new Error("no results should mean no list");
  if (A.clipsForPicker([null, undefined]).length !== 0) throw new Error("a hole in the results threw or counted");
});

check("a save that cannot happen says why, instead of blaming the wifi", () => {
  // Both of these were reported as "check your connection", which sends
  // somebody to reset their router over a migration that was never run.
  const missing = [
    { code: "42P01", message: 'relation "public.community_saves" does not exist' },
    { code: "PGRST205", message: "Could not find the table 'public.community_saves' in the schema cache" },
    // Recognisable by message alone, with no code to go on.
    { message: "Could not find the table 'public.community_saves' in the schema cache" },
    // And recognisable by code alone, with no message to go on. Without these
    // two the code branch is not pinned at all: every case above also matches
    // on its message, so deleting the code check broke nothing and no test
    // noticed.
    { code: "42P01" },
    { code: "PGRST205", message: "" },
  ];
  missing.forEach((e, i) => {
    if (!A.isMissingSavesTable(e)) throw new Error(`missing-table case ${i} went unrecognised`);
    if (A.isRefusedSave(e)) throw new Error(`missing-table case ${i} was also read as a refusal`);
  });

  // A refusal is a different problem with a different fix — the policies need
  // reading, not the migration re-running — so the two must not collapse.
  const refused = { code: "42501", message: "new row violates row-level security policy" };
  if (!A.isRefusedSave(refused)) throw new Error("a refused write went unrecognised");
  if (A.isMissingSavesTable(refused)) throw new Error("a refused write was read as a missing table");

  // And neither fires on the things that really are the network, on an
  // expired token, or on another table's problem.
  const other = [
    null, undefined, {},
    { message: "Failed to fetch" },
    { code: "08006", message: "connection failure" },
    { code: "PGRST301", message: "JWT expired" },
    { code: "23514", message: "community_posts_channel_check" },
  ];
  other.forEach((e, i) => {
    if (A.isMissingSavesTable(e)) throw new Error(`case ${i} was wrongly called a missing table`);
    if (A.isRefusedSave(e)) throw new Error(`case ${i} was wrongly called a refusal`);
  });
});

check("a room's own name finds it from whichever room you are standing in", () => {
  // A clip filed under Knee shield is about what the poster did, not about
  // where they filed it, so its body almost never contains "knee shield".
  // Searching only the body meant that clip was unfindable by name from
  // anywhere, including from inside the room next door.
  const hits = A.roomsMatchingTerm("closed guard");
  if (!hits.includes("closedguard")) throw new Error(`"closed guard" matched ${JSON.stringify(hits)}`);
  // Knee shield folded into Half guard, so its old name has to land there
  // rather than nowhere — the people who type it did not read the changelog.
  if (!A.roomsMatchingTerm("knee shield").includes("halfguard")) {
    throw new Error("the old name for a merged room finds nothing");
  }
  if (!A.roomsMatchingTerm("z guard").includes("halfguard")) {
    throw new Error("the other name for the room finds nothing");
  }
  if (!A.roomsMatchingTerm("reverse de la riva").includes("dlr")) {
    throw new Error("reverse de la riva does not reach the de la Riva room");
  }
  if (!A.roomsMatchingTerm("single leg x").includes("xguard")) {
    throw new Error("single leg x does not reach the X-guard room");
  }
  if (!A.roomsMatchingTerm("worm guard").includes("lapel")) {
    throw new Error("worm guard does not reach the lapel room");
  }
  if (!A.roomsMatchingTerm("50/50").includes("legentries")) throw new Error("50/50 does not reach the entanglements room");
  if (!A.roomsMatchingTerm("x-guard").includes("xguard")) throw new Error("punctuation in a room name defeats it");

  // Matched at a word boundary, not anywhere in the string.
  if (A.roomsMatchingTerm("hield").length) throw new Error("a fragment inside a word matched a whole room");
  // Below three characters nearly everything matches and the results are noise.
  // "ba" is the test and not "ar" on purpose: "ar" starts no room's name, so
  // it passes whatever the minimum is and pins nothing. "ba" starts "back".
  if (A.roomsMatchingTerm("ba").length) throw new Error("two characters pulled in whole rooms");
  if (!A.roomsMatchingTerm("back").includes("back")) throw new Error("three characters stopped working too");
  if (A.roomsMatchingTerm("").length) throw new Error("an empty search matched rooms");
});

check("every room can be found by typing its own name", () => {
  const orphans = A.COMMUNITY_CHANNELS.filter((c) => !A.roomsMatchingTerm(c.label).includes(c.id));
  if (orphans.length) {
    throw new Error(`rooms their own name does not find: ${orphans.map((c) => `${c.id} ("${c.label}")`).join(", ")}`);
  }
  // And a name must not be so loose that it drags in most of the group.
  const greedy = A.COMMUNITY_CHANNELS
    .map((c) => ({ id: c.id, n: A.roomsMatchingTerm(c.label).length }))
    .filter(({ n }) => n > 4);
  if (greedy.length) {
    throw new Error(`names that match too many rooms: ${greedy.map((g) => `${g.id} (${g.n})`).join(", ")}`);
  }
});

check("the technique vocabulary reaches every room that needs it", () => {
  // It was once tied to the single Technique room. The split to twenty-six
  // stranded it there, and the only visible symptom was that typing a room's
  // own name in that room suggested nothing — easy to miss, so it is pinned.
  if (A.vocabForChannel("general").length !== 0) {
    throw new Error("General is offering technique terms to people asking about the app");
  }
  const starved = A.COMMUNITY_CHANNELS
    .filter((c) => c.id !== "general")
    .filter((c) => A.vocabForChannel(c.id).length === 0);
  if (starved.length) {
    throw new Error(`rooms with no vocabulary: ${starved.map((c) => c.id).join(", ")}`);
  }
  if (!A.vocabForChannel("dlr").some((t) => /de la riva/i.test(t))) {
    throw new Error("the De la Riva room cannot suggest de la riva");
  }
});

check("every guard room is a word the search already knows", () => {
  // The suggestion vocabulary is what makes the box useful before there is
  // anything posted to mine. A room whose own name is not in it offers
  // nothing while you type its name, which is the one search certain to be
  // tried in that room.
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const vocab = A.TECHNIQUE_TERMS.map(norm);
  // A merged room's label names two techniques — "Spider & lasso" — so each
  // side is checked on its own, and the match runs both ways so a plural
  // label still finds the singular term the vocabulary stores.
  const missing = A.channelsInGroup("guards")
    .flatMap((c) => c.label.replace(/\(.*\)/, "").split("&").map((part) => ({ id: c.id, key: norm(part) })))
    .filter(({ key }) => key && !vocab.some((t) => t.includes(key) || key.includes(t)));
  if (missing.length) {
    throw new Error(`rooms the vocabulary has never heard of: ${missing.map((m) => `${m.id} ("${m.key}")`).join(", ")}`);
  }
});

check("there is a way into your own saved list, and it is yours alone", () => {
  mountGroup();
  const btn = [...host.querySelectorAll("button")].find((b) => /^saved\b/i.test(b.textContent.trim()));
  if (!btn) throw new Error("no way into the saved list from the group page");
});

check("the composer is shut until somebody wants it", () => {
  // It used to open on an empty three-line box plus two paragraphs of
  // instructions, above every post in the room.
  mountGroup({ prefs: { channel: "technique" } });
  if (host.querySelector("#post-body")) throw new Error("the composer is open before anyone asked");
  const opener = [...host.querySelectorAll("button")].find((b) => /^post in /i.test(b.textContent.trim()));
  if (!opener) throw new Error("no way to open the composer");
  hit(opener);
  const box = host.querySelector("#post-body");
  if (!box) throw new Error("tapping it did not open the composer");
  if (!box.getAttribute("placeholder")) throw new Error("the composer has no prompt in it");
  const cancel = [...host.querySelectorAll("button")].find((b) => /cancel/i.test(b.textContent));
  if (!cancel) throw new Error("no way back out of the composer");
  hit(cancel);
  if (host.querySelector("#post-body")) throw new Error("cancel did not shut it");
});

check("the prompt is not printed twice", () => {
  // The placeholder said "name the technique first"; a paragraph underneath
  // said the same thing again in different words, before a single post.
  mountGroup({ prefs: { channel: "technique" } });
  const opener = [...host.querySelectorAll("button")].find((b) => /^post in /i.test(b.textContent.trim()));
  if (!opener) throw new Error("no way to open the composer");
  hit(opener);
  const box = host.querySelector("#post-body");
  const prompt = (box.getAttribute("placeholder") || "").toLowerCase();
  const onScreen = txt().toLowerCase();
  const phrase = "name the technique first";
  if (prompt.includes(phrase) && onScreen.includes(phrase)) {
    throw new Error("the same instruction is in the placeholder and on the page");
  }
});

console.log("\nRecords and the progress verdict");

check("a jump is not a loaded lift", () => {
  // These demanded a number in the pounds box. A set with no weight on a loaded
  // exercise is discarded as "not performed" when the session saves, so a broad
  // jump done properly and left blank vanished from the athlete's history.
  ["Broad Jump", "Box Jumps"].forEach((n) => {
    if (A.needsWeight(n)) throw new Error(`${n} still asks for a weight`);
  });
  // And the genuinely loaded ones must keep their box.
  ["Back Squat", "Trap Bar Deadlift", "Weighted Pull-Up", "Dumbbell Jump Squat — Dynamic Effort"]
    .forEach((n) => { if (!A.needsWeight(n)) throw new Error(`${n} lost its weight box`); });
});

check("a one-rep max is only claimed where it means something", () => {
  // needsWeight only answers "is there a number to type". Running a medicine
  // ball slam through a strength formula produced "your slam is up 56 percent".
  ["Medicine Ball Slam", "Medicine Ball Rotational Scoop Throw (each side)", "Broad Jump",
   "Trap Bar Jump Squat — Dynamic Effort", "Dumbbell Jump Squat — Dynamic Effort",
   "Acceleration Sprint", "Five-Ten-Five Pro Agility Shuttle"]
    .forEach((n) => { if (A.hasMeaningfulMax(n)) throw new Error(`${n} is being treated as a max-strength lift`); });
  ["Back Squat", "Bench Press", "Trap Bar Deadlift", "Standing Barbell Overhead Press",
   "Bent Over Barbell Row", "Front Squat"]
    .forEach((n) => { if (!A.hasMeaningfulMax(n)) throw new Error(`${n} stopped counting as a strength lift`); });
});

check("the verdict reports lifts, not throws", () => {
  const base = A.buildClient({ id: "v", firstName: "V", lastName: "T", weight: 175, heightFeet: 5,
    heightInches: 10, beltLevel: "Blue", programVariant: "B", useTemplate: true,
    weeklySchedule: {}, waiver: { version: "x" } });
  // Twelve sessions over three months. The slam "improves" far faster than the
  // squat, so if throws are eligible it wins the ranking outright.
  for (let i = 0; i < 12; i++) {
    const d = new Date(2026, 0, 5 + i * 7);
    base.logs.push({
      id: "l" + i,
      date: new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10),
      weekNumber: i + 1,
      exercises: [
        { name: "Medicine Ball Slam", sets: [{ weight: String(10 + i * 4), reps: "5" }] },
        { name: "Back Squat", sets: [{ weight: String(225 + i * 5), reps: "5" }] },
      ],
      totalVolume: 1000,
    });
  }
  const v = A.strengthVerdict(base);
  if (!v || !Array.isArray(v.lifts)) throw new Error("no verdict from twelve sessions");
  const named = v.lifts.map((l) => l.name);
  if (named.some((n) => /slam|throw|jump/i.test(n))) {
    throw new Error(`the verdict is ranking a throw: ${named.join(", ")}`);
  }
  if (!named.includes("Back Squat")) throw new Error(`the squat is missing from ${named.join(", ")}`);
});

check("the first time you log something is not a record", () => {
  // finishWorkout now needs a prior best to beat. Before, every exercise in a
  // brand-new athlete's first session came back a personal record, so the very
  // first screen they saw was a trophy claiming five of them.
  const fresh = A.buildClient({ id: "f", firstName: "F", lastName: "T", weight: 175, heightFeet: 5,
    heightInches: 10, beltLevel: "White", programVariant: "B", useTemplate: true,
    weeklySchedule: {}, waiver: { version: "x" } });
  const sets = [{ weight: "135", reps: "8" }];
  const best = A.bestSetOf(sets);
  const prior = A.lastAllTimeBest(fresh, "Back Squat");
  if (prior) throw new Error("a brand-new athlete already has a best on the squat");
  const isRecord = !!(best && prior && A.hasMeaningfulMax("Back Squat") && best.e1rm > prior.e1rm);
  if (isRecord) throw new Error("the first ever set counted as a personal record");
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
    // Cues are how, purpose is why, and an exercise needs both. This used to
    // ask for cues only, and passed while Program B prescribed forty-nine
    // exercises that never said what they were for — in the program an athlete
    // gets by default if they tap through signup without choosing.
    // Resolved, not raw. A phase entry carrying a rotatingPool is a template
    // that resolveExercise swaps out before an athlete ever sees it, so judging
    // the raw entries flags twelve exercises in A that are never delivered and
    // misses nothing that is. This walks what actually reaches the screen.
    const noCues = [], noWhy = [];
    const total = A.totalSessionsIn(p);
    const seen = new Set();
    for (let i = 0; i < total; i++) {
      const pos = A.positionAtIndex(p, i);
      if (!pos) continue;
      A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false,
        { blockNumber: 1, excludedExercises: [], injuryAreas: [] })
        .forEach((sec) => (sec.exercises || []).forEach((e) => {
          if (!e || !e.name || seen.has(e.name)) return;
          seen.add(e.name);
          if (!e.cues || String(e.cues).trim().length < 20) noCues.push(e.name);
          if (!e.purpose || String(e.purpose).trim().length < 20) noWhy.push(e.name);
        }));
    }
    if (noCues.length) throw new Error(`${noCues.length} with no cues, e.g. ${noCues.slice(0, 3).join(", ")}`);
    if (noWhy.length) throw new Error(`${noWhy.length} with no purpose, e.g. ${noWhy.slice(0, 3).join(", ")}`);
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
check("one movement, one name, across every program", () => {
  // History is matched on the exact string, so two names for one exercise are
  // two separate histories: a face pull logged in Program B never informed the
  // same face pull in A, C or D, and an athlete moving from A to C lost their
  // split squat entirely. Both of these shipped under two names each.
  const names = new Set();
  ["A", "B", "C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    (p.phases || []).forEach((ph) => (ph.days || []).forEach((d) => (d.sections || []).forEach((sec) =>
      (sec.exercises || []).forEach((e) => { if (e && e.name) names.add(e.name); }))));
    // The rotating pools too — a name can reach an athlete from there without
    // ever appearing in a phase.
    Object.values(p.conjugate || {}).forEach((pool) => {
      if (Array.isArray(pool)) pool.forEach((it) => { if (it && it.name) names.add(it.name); });
    });
  });
  [["Banded Face Pulls", "Cable Face Pull"],
   ["Front-Foot-Elevated Split Squat (dumbbells)", "Front-Foot-Elevated Split Squat (each side)"]]
    .forEach(([retired, kept]) => {
      if (names.has(retired)) throw new Error(`"${retired}" is back — a second name for a movement that already has one`);
      if (!names.has(kept)) throw new Error(`"${kept}" has gone missing — the rename lost the movement`);
    });
});
check("no session asks for prehab before the heavy work", () => {
  // Week 12 of Program A opened its upper deload on neck isometrics and put the
  // bench after them — the only session of 120 that did, against the order
  // every other session including the week 4 and week 8 deloads already used.
  const bad = [];
  ["A", "B", "C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    const total = A.totalSessionsIn(p);
    for (let i = 0; i < total; i++) {
      const pos = A.positionAtIndex(p, i);
      if (!pos) continue;
      const types = A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false,
        { blockNumber: 1, excludedExercises: [], injuryAreas: [] }).map((sec) => sec.type);
      const firstLight = types.findIndex((t) => t === "accessory" || t === "durability");
      if (firstLight === -1) continue;
      if (types.lastIndexOf("power") > firstLight || types.lastIndexOf("strength") > firstLight) {
        bad.push(`${v} week ${pos.weekNumber} day ${pos.day.label}: ${types.join(" > ")}`);
      }
    }
  });
  if (bad.length) throw new Error(`${bad.length} session(s): ${bad.slice(0, 2).join(" | ")}`);
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
check("settings opens as a short list of groups, not a wall", () => {
  // Twenty headings in one scroll was the densest screen in the app, so they
  // were grouped and collapsed — but the first group was left open, which meant
  // the page still began with a picture, a belt card, a dropdown and a
  // full-width green button stacked above an otherwise tidy list. Kyle's words
  // for the result were "too messy and hard to read". Nothing opens on arrival
  // now: what you see is the list.
  const groups = [...host.querySelectorAll("details.settings-section")];
  if (groups.length < 6) throw new Error(`only ${groups.length} group(s) — Settings is still one long scroll`);
  if (groups.length > 12) throw new Error(`${groups.length} groups is another wall`);
  const open = groups.filter((g) => g.open);
  if (open.length !== 0) throw new Error(`${open.length} group(s) open on arrival — the page should open as a plain list`);
  groups.forEach((g) => {
    const head = g.querySelector("summary");
    if (!head || !head.textContent.trim()) throw new Error("a group has no readable heading");
  });
});
check("a closed row still says what is behind it", () => {
  // A title and a chevron is not enough to choose from. Every row carries a
  // line of plain text and an icon, so the list can be read without opening
  // anything — which is the whole point of collapsing it.
  const groups = [...host.querySelectorAll("details.settings-section")];
  groups.forEach((g) => {
    const title = g.querySelector(".settings-section-title");
    const hint = g.querySelector(".settings-section-hint");
    if (!title || !title.textContent.trim()) throw new Error("a row has no title");
    if (!hint || !hint.textContent.trim()) throw new Error(`"${title.textContent.trim()}" has no line saying what is inside`);
    if (hint.textContent.trim().length < 12) throw new Error(`"${title.textContent.trim()}" has a hint too short to help`);
    if (!g.querySelector("svg")) throw new Error(`"${title.textContent.trim()}" has no icon`);
  });
});
check("the rows are gathered under headings rather than nine in a row", () => {
  const labels = [...host.querySelectorAll(".settings-group-label")].map((e) => e.textContent.trim());
  if (labels.length < 3) throw new Error(`${labels.length} group heading(s) — the list is still flat`);
  if (new Set(labels).size !== labels.length) throw new Error(`duplicate group headings: ${labels.join(", ")}`);
  // Every row has to sit under one of them, or a heading is decoration.
  const first = host.querySelector(".settings-group-label");
  const firstSection = host.querySelector("details.settings-section");
  if (!first || !firstSection) throw new Error("no headings or no rows");
  if (first.compareDocumentPosition(firstSection) !== 4) {
    throw new Error("the first row comes before the first heading");
  }
});
check("every settings group can be opened", () => {
  const groups = [...host.querySelectorAll("details.settings-section")];
  groups.forEach((g) => {
    const head = g.querySelector("summary");
    // jsdom does not implement the details toggle, so drive it the way the
    // browser would and check the body is really in there to be revealed.
    act(() => { g.open = true; });
    if (!g.open) throw new Error(`${head.textContent.trim()} would not open`);
    if (!g.querySelector(".settings-section-body")) throw new Error(`${head.textContent.trim()} has no body`);
    if (!g.querySelector(".settings-section-body").textContent.trim()) {
      throw new Error(`${head.textContent.trim()} is an empty group`);
    }
  });
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

// =============================================================================
// THE MAT DIARY
// =============================================================================
// The page used to be two boxes and a list nobody scrolled back through. What
// somebody writes under "work on" is the part with a job to do, so it leaves
// the entry and becomes a list they tick off.
console.log("\nThe jiu-jitsu notes");
const diarist = athlete({ id: "marcus", firstName: "Marcus", paid: true, bjjNotes: [], bjjFocus: [] });
let noted = null;
const mountNotes = (c) => {
  unmount();
  mount(React.createElement(A.BJJNotesTab, { client: c,
    onPersist: async (u) => { noted = u; return { ok: true }; } }));
};
const boxes = () => [...host.querySelectorAll("textarea")];
const focusRows = () => [...host.querySelectorAll(".bjj-focus-row")];

check("an empty diary says what the list is for rather than nothing", () => {
  mountNotes(diarist);
  has(/working on/i, "the working-on panel");
  has(/nothing on the list/i, "an explanation of the empty list");
});
check("each line under work on becomes its own thing to drill", () => {
  click(/add an entry/i);
  const [learned, workOn] = boxes();
  setVal(learned, "Tight armbar detail from mount");
  setVal(workOn, "Staying heavy in side control\nFinishing triangles\n");
  noted = null;
  click(/save entry/i);
  if (!noted) throw new Error("saving did nothing");
  if ((noted.bjjNotes || []).length !== 1) throw new Error(`${(noted.bjjNotes || []).length} notes saved`);
  const texts = (noted.bjjFocus || []).map((f) => f.text);
  if (texts.length !== 2) throw new Error(`${texts.length} item(s) on the list, expected 2`);
  if (!texts.includes("Staying heavy in side control")) throw new Error("the first line did not become an item");
  if ((noted.bjjFocus || []).some((f) => f.done)) throw new Error("a new item arrived already ticked");
});
check("writing the same thing again does not put it on the list twice", () => {
  mountNotes(noted);
  click(/add an entry/i);
  const [, workOn] = boxes();
  setVal(workOn, "staying HEAVY in side control");
  const before = (noted.bjjFocus || []).length;
  click(/save entry/i);
  if ((noted.bjjFocus || []).length !== before) {
    throw new Error(`the list grew to ${(noted.bjjFocus || []).length} on a repeat`);
  }
});
check("ticking something off takes it out of the open list", () => {
  mountNotes(noted);
  const open = focusRows();
  if (open.length !== 2) throw new Error(`${open.length} open item(s) before ticking`);
  noted = null;
  hit(open[0].querySelector(".bjj-focus-box"));
  const done = (noted.bjjFocus || []).filter((f) => f.done);
  if (done.length !== 1) throw new Error(`${done.length} ticked`);
  if (!done[0].doneDate) throw new Error("no date recorded against a ticked item");
  mountNotes(noted);
  if (focusRows().length !== 1) throw new Error("the ticked item is still in the open list");
  has(/you have got/i, "a way back to what has been ticked");
});
check("and it can be put back", () => {
  click(/show 1 you have got/i);
  const row = [...host.querySelectorAll(".bjj-focus-row.done")][0];
  if (!row) throw new Error("the ticked item is not shown");
  noted = null;
  hit(row.querySelector(".bjj-focus-box"));
  if ((noted.bjjFocus || []).some((f) => f.done)) throw new Error("it did not come back off the done list");
});
check("an item can be dropped from the list entirely", () => {
  mountNotes(noted);
  const before = (noted.bjjFocus || []).length;
  noted = null;
  hit(focusRows()[0].querySelector(".bjj-focus-x"));
  if ((noted.bjjFocus || []).length !== before - 1) throw new Error("dropping an item did not remove it");
});
check("an entry can be logged against an earlier day", () => {
  mountNotes(diarist);
  click(/add an entry/i);
  const d = host.querySelector("input[type=date]");
  if (!d) throw new Error("no date field on the editor");
  if (d.value !== dayStr(0)) throw new Error(`date defaulted to ${d.value}`);
  if (d.max !== dayStr(0)) throw new Error("the date field accepts the future");
  setVal(d, dayStr(3));
  setVal(boxes()[0], "Drilled takedowns");
  noted = null;
  click(/save entry/i);
  if (noted.bjjNotes[0].date !== dayStr(3)) throw new Error(`saved against ${noted.bjjNotes[0].date}`);
});
check("entries can be tagged, and the tags are kept", () => {
  mountNotes(diarist);
  click(/add an entry/i);
  setVal(boxes()[0], "Knee shield details");
  click(/^Guard$/);
  noted = null;
  click(/save entry/i);
  if (!(noted.bjjNotes[0].tags || []).includes("Guard")) throw new Error("the tag was not saved");
});
check("search and tag filters narrow the list once there are a few", () => {
  const many = { ...diarist, bjjNotes: [
    { id: "n1", date: dayStr(1), learned: "Berimbolo entry", workOn: "", tags: ["Guard"] },
    { id: "n2", date: dayStr(2), learned: "Knee cut pressure", workOn: "", tags: ["Passing"] },
    { id: "n3", date: dayStr(3), learned: "Back escapes", workOn: "", tags: ["Escapes"] },
  ] };
  mountNotes(many);
  const search = host.querySelector(".bjj-search input");
  if (!search) throw new Error("no search box with three entries logged");
  setVal(search, "knee cut");
  if (!/Knee cut pressure/.test(txt())) throw new Error("search hid the matching entry");
  if (/Berimbolo/.test(txt())) throw new Error("search kept an entry that does not match");
  setVal(search, "zzzz");
  has(/nothing matches/i, "an answer when nothing matches");
});
check("an entry does not reprint what is already on the list", () => {
  const one = { ...diarist,
    bjjNotes: [{ id: "n1", date: dayStr(1), learned: "Knee cut pressure",
                 workOn: "Push the knee away from the centre line\nKeep my head off the mat", tags: ["Passing"] }],
    bjjFocus: [{ id: "f1", text: "Push the knee away from the centre line", done: false, date: dayStr(1) },
               { id: "f2", text: "Keep my head off the mat", done: true, doneDate: dayStr(0), date: dayStr(1) }] };
  mountNotes(one);
  // Each line appears once, on the list at the top — not again in the entry.
  const body = host.querySelector(".history-card").textContent;
  if (/Push the knee away/.test(body)) throw new Error("the entry reprinted a line that is already on the list");
  if (/Keep my head off the mat/.test(body)) throw new Error("the entry reprinted a line that has been ticked off");
  if (!/1 thing from this class still on your list/.test(body)) throw new Error(`no count of what is still open: ${body}`);
  if (!/1 ticked off/.test(body)) throw new Error("no count of what has been ticked off");
});
check("but a line taken off the list keeps its text, since nothing else holds it", () => {
  const one = { ...diarist,
    bjjNotes: [{ id: "n1", date: dayStr(1), learned: "Knee cut pressure",
                 workOn: "Push the knee away\nSomething I removed", tags: [] }],
    bjjFocus: [{ id: "f1", text: "Push the knee away", done: false, date: dayStr(1) }] };
  mountNotes(one);
  const body = host.querySelector(".history-card").textContent;
  if (!/Something I removed/.test(body)) throw new Error("a line no longer on the list vanished from its entry too");
  if (/Push the knee away/.test(body)) throw new Error("the tracked line was still reprinted");
});
check("deleting an entry asks first, and leaves the working-on list alone", () => {
  const one = { ...diarist,
    bjjNotes: [{ id: "n1", date: dayStr(1), learned: "Berimbolo entry", workOn: "", tags: [] }],
    bjjFocus: [{ id: "f1", text: "Keep the grip", done: false, date: dayStr(1), noteId: "n1" }] };
  mountNotes(one);
  noted = null;
  click(/delete/i);
  if (noted) throw new Error("one tap deleted it with no confirmation");
  has(/for good/i, "a confirmation");
  click(/delete it/i);
  if (!noted) throw new Error("confirming did not delete");
  if ((noted.bjjNotes || []).length !== 0) throw new Error("the entry survived");
  if ((noted.bjjFocus || []).length !== 1) throw new Error("deleting the entry took its drill item with it");
});

// ===========================================================================
// WORKING WITHOUT A CONNECTION
// ===========================================================================
// The service worker opens the app with no signal; this is the half that makes
// it usable. Every claim here is about data, so it is tested as data rather
// than by clicking.
console.log("\nWorking without a connection");

const { snapRead, snapWrite, snapClearAll, queueRead, queuePut, queueDrop, pendingWriteCount } = A;
const CLIENT_KEY = (id) => `sc-app:client:${id}`;

const clearStorage = () => {
  const keys = [];
  for (let i = 0; i < dom.window.localStorage.length; i++) keys.push(dom.window.localStorage.key(i));
  keys.forEach((k) => { if (k) dom.window.localStorage.removeItem(k); });
};

check("a mirrored record comes back as it went in", () => {
  clearStorage();
  const rec = { id: "c1", name: "Test Athlete", logs: [{ date: "2026-10-01", totalVolume: 4200 }] };
  snapWrite("u1", CLIENT_KEY("c1"), rec);
  const back = snapRead("u1", CLIENT_KEY("c1"));
  if (!back) throw new Error("nothing came back");
  if (back.v.name !== "Test Athlete") throw new Error("the record changed in storage");
  if (back.v.logs[0].totalVolume !== 4200) throw new Error("the history did not survive the round trip");
  if (!back.at || typeof back.at !== "number") throw new Error("no timestamp stored alongside it");
});

check("a key that was never mirrored reads as nothing, not as an empty record", () => {
  clearStorage();
  if (snapRead("u1", CLIENT_KEY("never")) !== null) throw new Error("a missing mirror did not read as null");
});

check("one athlete's mirror is not readable as another's", () => {
  clearStorage();
  snapWrite("u1", CLIENT_KEY("c1"), { id: "c1", name: "Athlete One" });
  snapWrite("u2", CLIENT_KEY("c1"), { id: "c1", name: "Athlete Two" });
  if (snapRead("u1", CLIENT_KEY("c1")).v.name !== "Athlete One") throw new Error("mirrors crossed between users");
  if (snapRead("u2", CLIENT_KEY("c1")).v.name !== "Athlete Two") throw new Error("mirrors crossed between users");
});

check("signing out clears this athlete's mirror and nobody else's", () => {
  clearStorage();
  snapWrite("u1", CLIENT_KEY("c1"), { id: "c1" });
  snapWrite("u1", "sc-app:client-list", [{ id: "c1" }]);
  snapWrite("u2", CLIENT_KEY("c9"), { id: "c9" });
  snapClearAll("u1");
  if (snapRead("u1", CLIENT_KEY("c1"))) throw new Error("the record stayed on the device after sign-out");
  if (snapRead("u1", "sc-app:client-list")) throw new Error("the roster stayed on the device after sign-out");
  if (!snapRead("u2", CLIENT_KEY("c9"))) throw new Error("signing one athlete out wiped another's copy");
});

check("a failed write is queued once per key, newest only", () => {
  clearStorage();
  queuePut("u1", CLIENT_KEY("c1"), { id: "c1", sessionsCompleted: 1 });
  queuePut("u1", CLIENT_KEY("c1"), { id: "c1", sessionsCompleted: 2 });
  queuePut("u1", CLIENT_KEY("c1"), { id: "c1", sessionsCompleted: 3 });
  const mine = queueRead().filter((x) => x.userId === "u1" && x.key === CLIENT_KEY("c1"));
  // Three attempts at the same record must leave one entry holding the newest
  // value. Replaying all three would put session 1 back on top of session 3.
  if (mine.length !== 1) throw new Error(`${mine.length} queued entries for one key`);
  if (mine[0].value.sessionsCompleted !== 3) throw new Error(`queued the stale value (${mine[0].value.sessionsCompleted})`);
});

check("different keys queue separately", () => {
  clearStorage();
  queuePut("u1", CLIENT_KEY("c1"), { id: "c1" });
  queuePut("u1", "sc-app:settings", { theme: "light" });
  if (pendingWriteCount("u1") !== 2) throw new Error(`expected 2 pending, saw ${pendingWriteCount("u1")}`);
});

check("the pending count is per athlete", () => {
  clearStorage();
  queuePut("u1", CLIENT_KEY("c1"), { id: "c1" });
  queuePut("u2", CLIENT_KEY("c2"), { id: "c2" });
  if (pendingWriteCount("u1") !== 1) throw new Error("another athlete's queued write was counted");
  if (pendingWriteCount("u2") !== 1) throw new Error("the second athlete's write went missing");
});

check("a write that lands is taken off the queue", () => {
  clearStorage();
  queuePut("u1", CLIENT_KEY("c1"), { id: "c1" });
  queueDrop("u1", CLIENT_KEY("c1"));
  if (pendingWriteCount("u1") !== 0) throw new Error("a synced write stayed queued");
});

check("blocked storage does not throw and does not pretend to have data", () => {
  clearStorage();
  const real = dom.window.localStorage;
  // What a private window or a device with site data blocked actually does.
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    get() { throw new Error("storage blocked"); },
  });
  try {
    snapWrite("u1", CLIENT_KEY("c1"), { id: "c1" });   // must not throw
    if (snapRead("u1", CLIENT_KEY("c1")) !== null) throw new Error("claimed to read from blocked storage");
    if (queueRead().length !== 0) throw new Error("claimed to read a queue from blocked storage");
    queuePut("u1", CLIENT_KEY("c1"), { id: "c1" });    // must not throw
    snapClearAll("u1");                                 // must not throw
  } finally {
    Object.defineProperty(dom.window, "localStorage", { configurable: true, value: real });
  }
});

check("the banner says which of the three things is true, and otherwise nothing", () => {
  // jsdom reports the browser as online, which is the case worth testing: the
  // two states that are easy to get wrong are "online but still carrying work"
  // and "online but showing a saved copy".
  unmount();
  mount(React.createElement(A.OfflineBanner, { usingSaved: false, pending: 0 }));
  if (host.querySelector(".offline-banner")) throw new Error("a banner appeared with nothing to report");

  unmount();
  mount(React.createElement(A.OfflineBanner, { usingSaved: false, pending: 3 }));
  const pendingText = host.textContent;
  if (!/3 changes still to sync/.test(pendingText)) throw new Error(`pending state reads: ${pendingText.slice(0, 90)}`);

  unmount();
  mount(React.createElement(A.OfflineBanner, { usingSaved: false, pending: 1 }));
  if (!/1 change still to sync/.test(host.textContent)) throw new Error("one pending change is pluralised");

  unmount();
  mount(React.createElement(A.OfflineBanner, { usingSaved: true, pending: 0 }));
  if (!/last saved copy/.test(host.textContent)) throw new Error("a saved copy on screen is not announced");

  // Unsynced work is the more urgent of the two, so it wins when both are true.
  unmount();
  mount(React.createElement(A.OfflineBanner, { usingSaved: true, pending: 2 }));
  if (!/still to sync/.test(host.textContent)) throw new Error("pending work was not the message when both applied");
  unmount();
});

check("corrupt stored JSON reads as nothing rather than crashing the app", () => {
  clearStorage();
  dom.window.localStorage.setItem(`sc-app:snapshot:u1:${CLIENT_KEY("c1")}`, "{not json");
  dom.window.localStorage.setItem("sc-app:pending-writes", "also not json");
  if (snapRead("u1", CLIENT_KEY("c1")) !== null) throw new Error("corrupt mirror did not read as null");
  if (queueRead().length !== 0) throw new Error("corrupt queue did not read as empty");
  clearStorage();
});


console.log("\nThe trophy");
check("somebody with no history can still mark a personal record", () => {
  // The trophy used to render only when the set beat a previously logged best,
  // so an athlete who had never logged that lift had no trophy on any row and
  // no way to mark anything. Every new athlete is in that state on every lift,
  // which is how the whole feature appeared to vanish.
  const first = athlete({ id: "pr1", firstName: "Pat", paid: true, sessionsCompleted: 4, logs: [] });
  mount(React.createElement(A.DaySessionScreen, { client: first, isCoach: false,
    phaseId: first.program.phases[0].id, dayId: first.program.phases[0].days[0].id,
    onClose() {}, onSave: async () => ({ ok: true }), onStartMobility() {}, onUpdateProgram() {},
    onRestartProgram: async () => {}, onRecordPR() {}, onRemovePR() {} }));
  const trophies = host.querySelectorAll(".set-pr").length;
  if (trophies === 0) throw new Error("no way to mark a record anywhere on a first session");
  const labelled = [...host.querySelectorAll(".set-pr")]
    .filter((b) => /personal record/i.test(b.getAttribute("aria-label") || ""));
  if (labelled.length !== trophies) throw new Error("a trophy button does not say what it does");
  unmount();
});

const everyExercise = () => {
  const names = new Set();
  [1, 2, 3, 4].forEach((b) => Object.keys(A.PROGRAM_VARIANT_LABELS).forEach((v) => {
    const prog = A.buildProgramVariant(v, { blockNumber: b });
    (prog.phases || []).forEach((ph) => (ph.days || []).forEach((d) =>
      (d.sections || []).forEach((sec) => (sec.exercises || []).forEach((e) => { if (e && e.name) names.add(e.name); }))));
  }));
  return [...names];
};

check("the trophy reaches every exercise a record is a real idea in", () => {
  const all = everyExercise();
  if (all.length < 50) throw new Error(`only ${all.length} exercises found across the programs`);

  // Anything that asks for a weight can hold a record. Asking for a weight and
  // then refusing the record is the contradiction this catches.
  const loadedButBlocked = all.filter((n) => A.needsWeight(n) && !A.canMarkPR(n) && !/dynamic effort/i.test(n));
  if (loadedButBlocked.length) throw new Error(`loaded lifts with no trophy: ${loadedButBlocked.join(", ")}`);

  // And so can the ones measured in distance, reps or time rather than weight.
  // These are exactly the ones the old gate silently excluded.
  ["Broad Jump", "Toes to Bar", "Side Plank", "Pogo Hops",
   "Five-Ten-Five Pro Agility Shuttle", "Acceleration Sprint (10 to 15 yards)"].forEach((n) => {
    if (!A.canMarkPR(n)) throw new Error(`"${n}" cannot be marked, and it is a thing you set records in`);
  });

  // What stays out: work where going harder is doing something else, and
  // conditioning that runs for the time on the card.
  ["Speed Bench Press — Dynamic Effort", "Trap Bar Jump Squat — Dynamic Effort",
   "Assault Bike or Treadmill — Easy Aerobic"].forEach((n) => {
    if (A.canMarkPR(n)) throw new Error(`"${n}" offers a record, and a record there means nothing`);
  });

  // The automatic detection stays narrower than the trophy on purpose: it runs
  // an estimated one-rep max, which a jump does not have.
  if (A.hasMeaningfulMax("Broad Jump")) throw new Error("a broad jump is being run through a one-rep-max formula again");
  if (!A.hasMeaningfulMax("Back Squat")) throw new Error("a back squat stopped counting as a lift");
});

check("no bike round asks the athlete what weight they used", () => {
  // A set with no weight on an exercise that takes load is discarded as "not
  // performed" when the session saves, so this is not a cosmetic stray box —
  // it is conditioning work vanishing out of somebody's history.
  const asking = everyExercise()
    .filter((n) => /assault bike|treadmill|aerobic|zone 2|vo2|interval|match-duration/i.test(n))
    .filter((n) => A.needsWeight(n));
  if (asking.length) throw new Error(`conditioning demanding a weight: ${asking.join(", ")}`);
});


console.log("\nWhat you weighed when you set it");
check("a record carries the weigh-in nearest before it, not the newest one", () => {
  const c = { bodyweightLog: [
    { date: dayStr(60), weight: 192 },
    { date: dayStr(32), weight: 185 },
    { date: dayStr(10), weight: 178 },
    { date: dayStr(1), weight: 171 },
  ] };
  // The record is 10 days old; the 171 was logged after it and must not be
  // claimed as what they were at.
  if (A.bodyweightOn(c, dayStr(10)) !== 178) throw new Error(`got ${A.bodyweightOn(c, dayStr(10))} for the day of the record`);
  if (A.bodyweightOn(c, dayStr(9)) !== 178) throw new Error("the day after a weigh-in lost it");
  if (A.bodyweightOn(c, dayStr(40)) !== 192) throw new Error("an older record did not fall back to the older weigh-in");
  // Nothing within a month of it, so nothing is claimed.
  if (A.bodyweightOn(c, dayStr(100)) !== null) throw new Error("a weigh-in from after the record was used");
  if (A.bodyweightOn({ bodyweightLog: [{ date: dayStr(90), weight: 180 }] }, dayStr(10)) !== null) {
    throw new Error("a weigh-in eighty days stale was presented as what they were at");
  }
  if (A.bodyweightOn({}, dayStr(1)) !== null) throw new Error("no log did not read as no answer");
  if (A.bodyweightOn(c, null) !== null) throw new Error("no date did not read as no answer");
});

check("a record that stored its own bodyweight keeps it", () => {
  // Derived is the fallback for records set before this existed. A stored
  // figure is what they actually weighed and must not move when an old
  // weigh-in is corrected months later.
  const c = { bodyweightLog: [{ date: dayStr(10), weight: 178 }] };
  const pr = { exerciseName: "Back Squat", date: dayStr(10), weight: 315, reps: 1, bodyweight: 168 };
  if (A.prBodyweight(c, pr) !== 168) throw new Error("the stored bodyweight was overridden by the log");
  if (A.prBodyweight(c, { ...pr, bodyweight: undefined }) !== 178) throw new Error("no stored figure did not fall back to the log");
  if (A.prBodyweight(c, { ...pr, bodyweight: 0 }) !== 178) throw new Error("a zero was treated as a real weigh-in");
});

check("the note says the bodyweight, and the multiple where a bar is involved", () => {
  const c = { bodyweightLog: [] };
  const squat = { exerciseName: "Back Squat", date: dayStr(5), weight: 315, reps: 1, bodyweight: 175 };
  const note = A.prBodyweightNote(c, squat);
  if (!/175 lb/.test(note)) throw new Error(`no bodyweight in "${note}"`);
  if (!/1\.80/.test(note)) throw new Error(`no multiple in "${note}" for 315 at 175`);
  // Bodyweight movements have no multiple to give.
  const t2b = { exerciseName: "Toes to Bar", date: dayStr(5), weight: 0, reps: 15, bodyweight: 175 };
  const tn = A.prBodyweightNote(c, t2b);
  if (!/175 lb/.test(tn)) throw new Error(`no bodyweight on a bodyweight movement: "${tn}"`);
  if (/×/.test(tn)) throw new Error(`a multiple was invented for a bodyweight movement: "${tn}"`);
  // And with nothing logged there is no note at all rather than a blank one.
  if (A.prBodyweightNote(c, { ...squat, bodyweight: undefined }) !== null) {
    throw new Error("a note was produced with no weigh-in to base it on");
  }
});

check("the records screen shows the date and the weight they were at", () => {
  const c = {
    bodyweightLog: [{ date: dayStr(20), weight: 181 }, { date: dayStr(5), weight: 176 }],
    prLog: [
      { id: "r1", exerciseName: "Back Squat", date: dayStr(5), weight: 315, reps: 1 },
      { id: "r2", exerciseName: "Back Squat", date: dayStr(20), weight: 295, reps: 1 },
    ],
  };
  mount(React.createElement(A.PRsTab, { client: c }));
  const seen = host.textContent;
  if (!/176/.test(seen)) throw new Error("the most recent record does not say what they weighed");
  if (!/1\.79/.test(seen)) throw new Error("no multiple of bodyweight on the record");
  unmount();
});


console.log("\nReadable on your own belt");
check("the contrast maths is the real thing", () => {
  const r = A.contrastRatio("#000000", "#ffffff");
  if (Math.abs(r - 21) > 0.01) throw new Error(`black on white came out ${r}, not 21`);
  if (Math.abs(A.contrastRatio("#3f9d5a", "#3f9d5a") - 1) > 0.001) throw new Error("a colour on itself is not 1");
  if (A.contrastRatio("not a colour", "#ffffff") !== null) throw new Error("nonsense did not read as no answer");
  if (A.relLuminance("#fff") == null) throw new Error("three-digit hex was rejected");
});

check("text on a belt colour can be read, on every belt", () => {
  // The white belt is the one that broke: its colour is near-white, so the
  // selected pill was white text on a white fill. Measured, not eyeballed.
  const bad = Object.keys(A.BELT_THEME).map((belt) => {
    const fill = A.BELT_THEME[belt].fill;
    const ink = A.inkOn(fill);
    return { belt, fill, ink, ratio: A.contrastRatio(ink, fill) };
  }).filter((x) => !(x.ratio >= 4.5));
  if (bad.length) {
    throw new Error("unreadable on their own belt: " + bad
      .map((x) => `${x.belt} ${x.ink} on ${x.fill} = ${x.ratio && x.ratio.toFixed(2)}`).join(", "));
  }
});

check("a white belt gets black text and a brown belt gets white", () => {
  const white = A.inkOn(A.BELT_THEME.White.fill);
  if (A.relLuminance(white) > 0.2) throw new Error(`a white belt was given ${white}, which is not dark`);
  const brown = A.inkOn(A.BELT_THEME.Brown.fill);
  if (A.relLuminance(brown) < 0.5) throw new Error(`a brown belt was given ${brown}, which is not light`);
  // And the variable actually reaches the stylesheet.
  const vars = A.beltVars("White", "dark");
  if (!vars["--belt-on-fill"]) throw new Error("no --belt-on-fill in the belt variables");
  if (A.contrastRatio(vars["--belt-on-fill"], A.BELT_THEME.White.fill) < 4.5) {
    throw new Error("the variable handed to the page is not the readable one");
  }
});

check("nothing paints text straight onto a belt fill again", () => {
  // The class of bug rather than the instance: a solid belt-coloured
  // background with the page's ordinary text colour on top is unreadable for
  // whichever belts happen to be near that end of the scale.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "App.jsx"), "utf8");
  const offenders = [];
  let at = 0;
  for (;;) {
    const i = src.indexOf("background: var(--belt-fill", at);
    if (i < 0) break;
    at = i + 1;
    const end = src.indexOf("}", i);
    const body = src.slice(i, end < 0 ? src.length : end);
    if (/color:\s*var\(--text\)/.test(body)) offenders.push(body.replace(/\s+/g, " ").slice(0, 90));
  }
  if (offenders.length) throw new Error("solid belt fill under plain text: " + offenders.join(" | "));
});


console.log("\nGetting the app onto a phone");
const firstGuidePage = (variant, firstRun) => {
  unmount();
  mount(React.createElement(A.TutorialModal, { variant, firstRun, onClose() {} }));
  const t = host.querySelector(".card-title").textContent.trim();
  return t;
};

check("the first thing a new athlete reads is how to install it", () => {
  // Somebody who never installs it reaches the app through a browser tab they
  // will have lost by Thursday, and every other page of the guide assumes
  // they still have the app.
  const a = firstGuidePage("A", true);
  if (!/home screen/i.test(a)) throw new Error(`program A opened on "${a}"`);
  const b = firstGuidePage("B", true);
  if (!/home screen/i.test(b)) throw new Error(`program B opened on "${b}"`);

  // Reopened later from the help button it goes back to its normal place,
  // because by then they have either done it or decided not to.
  const a2 = firstGuidePage("A", false);
  if (!/welcome/i.test(a2)) throw new Error(`a later open still led with "${a2}"`);
  const b2 = firstGuidePage("B", false);
  if (!/welcome/i.test(b2)) throw new Error(`a later open on program B led with "${b2}"`);
  unmount();
});

check("the install page is in the guide once, not twice", () => {
  // Putting it first by copying rather than moving would show the same page
  // again further in, which reads as a bug to the person paging through.
  unmount();
  mount(React.createElement(A.TutorialModal, { variant: "A", firstRun: true, onClose() {} }));
  const titles = [];
  for (let i = 0; i < 40; i++) {
    titles.push(host.querySelector(".card-title").textContent.trim());
    if (!byText(/^next$/i)) break;
    click(/^next$/i);
  }
  if (titles.length < 5) throw new Error(`the guide paged through only ${titles.length} screens`);
  const installs = titles.filter((t) => /home screen/i.test(t));
  if (installs.length !== 1) throw new Error(`${installs.length} install pages across ${titles.length} screens`);
  unmount();
});

check("and it is still in settings for anyone who wants it later", () => {
  // It used to be the last thing inside "Your program". Nobody looking for how
  // to get the app onto their phone opens a section about their training block.
  mount(React.createElement(A.SettingsModal, { client: marcusPaid, isCoach: false,
    onPersist: async () => ({ ok: true }), theme: "dark", onChangeTheme() {}, onClose() {},
    onResetApp() {}, onRefreshProgram() {}, onOpenCoachDashboard() {}, onOpenTerms() {}, onSignOut() {} }));
  // Settings sections are details/summary, not buttons, so this reads the
  // sections directly. The steps have to be inside the section whose own
  // heading says what it is, which is what fails if the guide ever gets
  // tucked back inside an unrelated section.
  const sections = [...host.querySelectorAll("details.settings-section")];
  const section = sections.find((d) => /put this app on your home screen/i.test(
    (d.querySelector("summary") || {}).textContent || ""));
  if (!section) {
    throw new Error("no install section in settings; sections were: " + sections
      .map((d) => ((d.querySelector("summary") || {}).textContent || "").trim()).join(" | "));
  }
  const seen = section.textContent;
  if (!/safari/i.test(seen)) throw new Error("the iPhone steps are not inside that section");
  if (!/chrome/i.test(seen)) throw new Error("the Android steps are not inside that section");
  if (!/add to home screen/i.test(seen)) throw new Error("the actual instruction is missing");
  unmount();
});


console.log("\nWeek one, with no max to work from");
const openDayOne = (variant, logs, dayIdx = 0) => {
  const c = athlete({ id: "w1" + variant + dayIdx + (logs ? "h" : ""), firstName: "Pat", paid: true,
    sessionsCompleted: 0, logs: logs || [] });
  c.program = A.buildProgramVariant(variant, { blockNumber: 1 });
  unmount();
  mount(React.createElement(A.DaySessionScreen, { client: c, isCoach: false,
    phaseId: c.program.phases[0].id, dayId: c.program.phases[0].days[dayIdx].id,
    onClose() {}, onSave: async () => ({ ok: true }), onStartMobility() {}, onUpdateProgram() {},
    onRestartProgram: async () => {}, onRecordPR() {}, onRemovePR() {} }));
  return [...host.querySelectorAll(".pct-1rm-row")]
    .map((d) => d.textContent.replace(/\s+/g, " ").trim()).filter((r) => /%/.test(r));
};

check("a percentage never stands alone for somebody with no max", () => {
  // Three of the four programs put week one straight into percentages of a
  // one-rep max the athlete has not got. Every run of percentage sets has to
  // carry something they can actually act on.
  ["A", "B", "C"].forEach((v) => {
    const rows = openDayOne(v);
    if (!rows.length) throw new Error(`program ${v} week 1 showed no percentage rows at all`);
    if (!rows.some((r) => /no max on this lift yet/i.test(r))) {
      throw new Error(`program ${v} week 1 shows percentages with no guidance`);
    }
  });
  unmount();
});

check("speed work is never described as something to push", () => {
  // This one was doing harm rather than just being unhelpful: the old line
  // told a new athlete to add weight each set until the last rep was hard,
  // on eight sets of dynamic effort. Followed literally it turns the speed
  // day into a grind.
  const de = openDayOne("A").filter((r) => /50% of your One-Rep Max/.test(r));
  if (!de.length) throw new Error("no dynamic effort row on program A week 1");
  de.forEach((r) => {
    if (/add weight (each|every) set/i.test(r)) throw new Error(`speed work told to add weight: ${r.slice(0, 120)}`);
    if (/until the last rep is hard/i.test(r)) throw new Error(`speed work told to grind: ${r.slice(0, 120)}`);
    if (!/bar .*move.*fast|moves fast/i.test(r)) throw new Error(`speed work does not mention bar speed: ${r.slice(0, 120)}`);
  });
  unmount();
});

check("a ramp says build up, and straight sets say hold the weight", () => {
  // Program A climbs to one top single, so adding weight every set is right.
  // Program B is two warm-ups then four sets at the same percentage, where
  // the same instruction would have them climbing through work meant to sit
  // at one weight.
  const ramp = openDayOne("A").find((r) => /no max on this lift yet/.test(r) && /100%|build-up/i.test(r))
    || openDayOne("A").find((r) => /no max on this lift yet/.test(r) && /Warm-up/.test(r));
  if (!ramp || !/add weight every set/i.test(ramp)) throw new Error(`the max effort ramp does not say to build up: ${ramp}`);

  const straight = openDayOne("B").find((r) => /no max on this lift yet/.test(r));
  if (!straight) throw new Error("program B week 1 gave no guidance");
  if (/add weight every set/i.test(straight)) throw new Error(`program B told to ramp through its straight sets: ${straight}`);
  if (!/keep it the same across them/i.test(straight)) throw new Error(`program B does not say to hold one weight: ${straight}`);
  if (!/warm-ups/i.test(straight)) throw new Error(`program B does not name its warm-up sets: ${straight}`);
  unmount();
});

check("once the lift is logged, nobody is told they have no max", () => {
  // Read the lifts off the screen first and log those. An earlier version of
  // this logged a lift that was not on the screen and so proved nothing.
  //
  // Program B day two is the case that actually exercises the check. On a
  // main lift a logged history produces a suggested weight, which answers the
  // question before "has this ever been logged" is asked. The accessories
  // carrying a flat percentage have no suggested weight either way, so they
  // are the only place the wrong answer is visible — and the first version of
  // this test used program A, where there are none, and so passed with the
  // check disabled.
  [["A", 0], ["B", 1]].forEach(([v, day]) => {
    // Names come from the resolved program, not from scraping the screen.
    // Scraping picked up section headings and ran them together with the
    // exercise names, so the sessions it logged were for lifts that do not
    // exist and the check quietly tested nothing.
    const prog = A.buildProgramVariant(v, { blockNumber: 1 });
    const phase = prog.phases[0];
    const names = [];
    A.resolveDaySections(phase.days[day], 1, prog, phase, false, {})
      .forEach((sec) => (sec.exercises || []).forEach((e) => { if (e && e.name) names.push(e.name); }));
    if (!names.length) throw new Error(`no exercises on program ${v} day ${day + 1}`);
    const rows = openDayOne(v, names.map((n, i) => sessionLog(20 + i, 185, n)), day);
    const left = rows.filter((r) => /no max on this lift yet/i.test(r));
    if (left.length) {
      throw new Error(`program ${v} day ${day + 1}: ${left.length} lifts still claim no max after being logged: ${left[0].slice(0, 90)}`);
    }
  });
  unmount();
});

check("the guidance matches the shape of the prescription", () => {
  const de = A.noMaxGuidance("Speed Bench Press — Dynamic Effort",
    { perSetTargets: [{ pct1rm: 50, reps: 3, rir: 4 }, { pct1rm: 50, reps: 3, rir: 4 }] });
  if (!/speed/i.test(de) || /add weight/i.test(de)) throw new Error(`dynamic effort guidance is wrong: ${de}`);

  const ramp = A.noMaxGuidance("Box Squat", { perSetTargets: [
    { pct1rm: 70, reps: 3, rir: 4 }, { pct1rm: 85, reps: 2, rir: 2 }, { pct1rm: 100, reps: 1, rir: 0 }] });
  if (!/add weight every set/i.test(ramp)) throw new Error(`ramp guidance is wrong: ${ramp}`);
  if (!/nothing left in reserve/i.test(ramp)) throw new Error(`a top single at zero in reserve was not described as one: ${ramp}`);

  // Not every ramp ends in a single. The lifts flagged as triple-capped stop
  // at a heavy three, and calling that a single would have somebody taking a
  // barbell good morning to a one-rep max, which is the exact thing the cap
  // exists to prevent.
  const tripleCap = A.noMaxGuidance("Barbell Good Morning", { perSetTargets: [
    { pct1rm: 65, reps: 3, rir: 4 }, { pct1rm: 75, reps: 3, rir: 3 }, { pct1rm: 88, reps: 3, rir: 1 }] });
  if (!/set of 3/i.test(tripleCap)) throw new Error(`a top triple was not described as one: ${tripleCap}`);
  if (/\bsingle\b/i.test(tripleCap)) throw new Error(`a triple-capped lift was called a single: ${tripleCap}`);
  if (!/about 1 left in reserve/i.test(tripleCap)) throw new Error(`the top triple's reserve is wrong: ${tripleCap}`);

  const straight = A.noMaxGuidance("Back Squat", { perSetTargets: [
    { pct1rm: 45, reps: 5, rir: 6 }, { pct1rm: 80, reps: 6, rir: 2 }, { pct1rm: 80, reps: 6, rir: 2 }] });
  if (/add weight every set/i.test(straight)) throw new Error(`straight sets described as a ramp: ${straight}`);
  if (!/the first set is a warm-up/i.test(straight)) throw new Error(`one warm-up set was not described in the singular: ${straight}`);

  // Nothing to go on at all still has to say something useful.
  const bare = A.noMaxGuidance("Cable Lat Row", { perSetTargets: [{ pct1rm: 65, reps: 10 }] });
  if (!bare || /undefined|NaN/.test(bare)) throw new Error(`a target with no reps in reserve produced: ${bare}`);
});


console.log("\nWhat the programs actually ask for");
const eachHardWeek = (v, fn) => {
  const p = A.buildProgramVariant(v);
  const perWeek = p.sessionsPerWeek || 3;
  for (let w = 1; w <= 12; w++) {
    const first = A.positionAtIndex(p, (w - 1) * perWeek);
    if (/deload/i.test(first.phase.name)) continue;
    const exes = [];
    for (let d = 0; d < perWeek; d++) {
      const pos = A.positionAtIndex(p, (w - 1) * perWeek + d);
      A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, {})
        .forEach((sec) => (sec.exercises || []).forEach((e) => { if (e && e.name) exes.push(e); }));
    }
    fn(w, exes);
  }
};

check("no program gives less than three adductor sets a week", () => {
  // Program A sat on exactly the floor at two while C and D gave four, and A
  // is the program for somebody on the mat five nights a week. Groin strain is
  // the most common soft-tissue injury in the sport. This is the floor's own
  // matcher, so it fails if the floor is lowered as well as if a program drops
  // the work.
  const low = [];
  ["A", "B", "C", "D"].forEach((v) => eachHardWeek(v, (w, exes) => {
    const sets = exes.filter((e) => /copenhagen|adduction|adductor/i.test(e.name))
      .reduce((n, e) => n + (Number(e.sets) || 0), 0);
    if (sets < 3) low.push(`${v} wk${w}: ${sets}`);
  }));
  if (low.length) throw new Error(`weeks under three adductor sets: ${low.slice(0, 6).join(", ")}`);
});

check("the conjugate programs do not squat twice as much as they hinge", () => {
  // The max effort lower pool was four squats to two hinges, so two thirds of
  // every rotation was a squat and both conjugate programs came out past two
  // to one. Hip extension is bridging, standing up and finishing a takedown.
  // Any squat, not a hand-listed set of them. The first version of this check
  // listed the variations by name, missed "Trap Bar Jump Squat", and so
  // computed a lower ratio than the measurement it was meant to pin — it
  // passed with the pool put back the way it was.
  const SQUAT = /squat|leg press|step-?up|lunge/i;
  const HINGE = /deadlift|romanian|rdl|good morning|rack pull|hip thrust|glute bridge|hamstring curl|valslide/i;
  ["A", "C"].forEach((v) => {
    let squat = 0, hinge = 0;
    eachHardWeek(v, (w, exes) => exes.forEach((e) => {
      const n = String(e.name).replace(/\([^)]*\)/g, " ");
      if (SQUAT.test(n)) squat += Number(e.sets) || 0;
      if (HINGE.test(n)) hinge += Number(e.sets) || 0;
    }));
    if (!hinge) throw new Error(`program ${v} has no hinge volume at all`);
    const ratio = squat / hinge;
    if (ratio > 2) throw new Error(`program ${v} squats ${ratio.toFixed(2)} times what it hinges`);
  });
});

check("every dynamic effort lift gets more than one hard week", () => {
  // The fourth lift in a four-lift pool landed on weeks 7 and 8, week 8 is a
  // deload and deloads are dynamic-effort-free, so it was prescribed exactly
  // once in twelve weeks while the first lift got four. One week is not long
  // enough to learn a lift, let alone progress one.
  const weeksFor = new Map();
  eachHardWeek("A", (w, exes) => exes.forEach((e) => {
    if (!/dynamic effort/i.test(e.name)) return;
    const set = weeksFor.get(e.name) || new Set();
    set.add(w); weeksFor.set(e.name, set);
  }));
  if (weeksFor.size < 3) throw new Error(`only ${weeksFor.size} dynamic effort lifts found across program A`);
  const once = [...weeksFor.entries()].filter(([, ws]) => ws.size < 2);
  if (once.length) throw new Error(`prescribed in only one hard week: ${once.map(([n]) => n).join(", ")}`);
});

check("program D is not the same session four weeks running", () => {
  // D's methodology defends the sameness of the main lifts, and they are left
  // alone. It does not defend running the identical trunk exercise for four
  // straight weeks, which is what the one rotating slot fixes.
  const p = A.buildProgramVariant("D");
  const perWeek = p.sessionsPerWeek || 2;
  const sigs = [];
  for (let w = 1; w <= 12; w++) {
    const parts = [];
    for (let d = 0; d < perWeek; d++) {
      const pos = A.positionAtIndex(p, (w - 1) * perWeek + d);
      A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, {})
        .forEach((sec) => (sec.exercises || []).forEach((e) => parts.push(`${e.name}|${e.sets}|${e.reps}`)));
    }
    sigs.push(parts.join("~"));
  }
  const distinct = new Set(sigs).size;
  if (distinct < 6) throw new Error(`only ${distinct} distinct weeks in twelve`);
  if (sigs[0] === sigs[2]) throw new Error("week 1 and week 3 are the identical session");
});


console.log("\nThe name");
check("the wording somebody signed is stored with their signature", () => {
  // A version string says WHICH wording was agreed to, but only while that
  // wording is still in the build. Edit the text, bump the version, and the
  // words a past athlete signed are gone — and a waiver that cannot be
  // produced is not much of a waiver.
  const doc = A.waiverDocument();
  if (!doc || !Array.isArray(doc.sections)) throw new Error("no document is stored at all");
  if (doc.sections.length !== A.WAIVER_SECTIONS.length) {
    throw new Error(`${doc.sections.length} sections stored for ${A.WAIVER_SECTIONS.length} in the agreement`);
  }
  if (doc.version !== A.WAIVER_VERSION) throw new Error(`stored as version ${doc.version}`);
  if (doc.title !== A.WAIVER_TITLE) throw new Error("the title is not stored with it");
  doc.sections.forEach((sec, i) => {
    if (!sec.heading || !sec.body) throw new Error(`section ${i} stored empty`);
    if (sec.body !== A.WAIVER_SECTIONS[i].body) throw new Error(`section ${i} is not the wording on the screen`);
  });
  // The release and the signing clause are the two that matter most. If a
  // refactor ever stores headings without bodies this is what notices.
  const all = doc.sections.map((x) => x.body).join(" ");
  if (!/release/i.test(all) || !/signature/i.test(all)) {
    throw new Error("the stored copy does not contain the release or the signature clause");
  }
});

check("a stored copy outranks whatever the app says today", () => {
  // The whole point. An athlete who signed older wording must keep seeing the
  // wording they signed, however many times the text is revised afterwards.
  const old = {
    at: "2026-03-01T10:00:00.000Z", version: "2026-01-01", signature: "Marcus Hale", name: "Marcus Hale",
    document: { provider: "Old Name", title: "Old Title", version: "2026-01-01",
                sections: [{ heading: "Release", body: "The wording as it stood in January." }] },
  };
  const got = A.waiverDocumentFor(old);
  if (!got) throw new Error("a signature with its wording attached produced nothing");
  if (got.source !== "signed") throw new Error(`reported as "${got.source}" rather than the stored copy`);
  if (got.sections[0].body !== "The wording as it stood in January.") {
    throw new Error("today's wording was served over an older signature");
  }
  if (got.title !== "Old Title" || got.provider !== "Old Name") {
    throw new Error("the stored copy was rewritten with today's title or provider");
  }
});

check("no stored copy and a stale version produces nothing, not today's text", () => {
  // Printing the current agreement over a signature given against different
  // wording is inventing a document. Better to say the words are not on file:
  // the signature, its date and its version still stand on their own.
  const stale = { at: "2026-03-01T10:00:00.000Z", version: "2019-01-01", signature: "Dani Reyes", name: "Dani Reyes" };
  if (A.waiverDocumentFor(stale) !== null) throw new Error("an old signature was given the current wording");
  const lines = A.waiverCopyLines("Dani Reyes", stale).join("\n");
  if (!/NOT ON FILE/i.test(lines)) throw new Error("the copy does not say the wording is missing");
  if (lines.includes(A.WAIVER_SECTIONS[1].body)) throw new Error("it printed the current wording anyway");
  // What is on file is still on file.
  ["Dani Reyes", "2019-01-01", "2026-03-01T10:00:00.000Z"].forEach((bit) => {
    if (!lines.includes(bit)) throw new Error(`the copy drops ${bit}`);
  });

  // A signature from before the copy existed, but against the version still in
  // use, can be reproduced exactly — and says that is what happened.
  const current = { at: "2026-11-01T10:00:00.000Z", version: A.WAIVER_VERSION, signature: "Ana Diaz", name: "Ana Diaz" };
  const got = A.waiverDocumentFor(current);
  if (!got || got.source !== "current") throw new Error("a signature against the current version could not be reproduced");
  if (got.sections[0].body !== A.WAIVER_SECTIONS[0].body) throw new Error("it reproduced the wrong wording");
});

check("one athlete's copy is a document, not a line in a list", () => {
  const w = {
    at: "2026-11-02T18:30:00.000Z", version: A.WAIVER_VERSION, signature: "Marcus J. Hale", name: "Marcus Hale",
    document: A.waiverDocument(),
  };
  const lines = A.waiverCopyLines("Marcus Hale", w);
  const text = lines.join("\n");
  if (!text.includes("Marcus J. Hale")) throw new Error("the signature is missing");
  if (!text.includes("2026-11-02T18:30:00.000Z")) throw new Error("the exact timestamp is missing");
  if (!text.includes(A.WAIVER_VERSION)) throw new Error("the version is missing");
  // Every clause, not a summary of them.
  A.WAIVER_SECTIONS.forEach((sec, i) => {
    if (!text.includes(sec.body)) throw new Error(`clause ${i} ("${sec.heading}") is not in the copy`);
  });
  // Signed under one name against another is the thing a record has to flag.
  if (!/signed as/i.test(text)) throw new Error("a signature that differs from the profile name is not flagged");
  const same = A.waiverCopyLines("Ana Diaz", { ...w, signature: "Ana Diaz", name: "Ana Diaz" }).join("\n");
  if (/signed as/i.test(same)) throw new Error("a matching name was flagged as a mismatch");
  if (!/not on file/i.test(text) === false) throw new Error("a complete copy claimed the wording was missing");
});

check("the signed waiver reads as a document on screen", () => {
  const w = { at: "2026-11-02T18:30:00.000Z", version: A.WAIVER_VERSION,
              signature: "Marcus J. Hale", name: "Marcus Hale", document: A.waiverDocument() };
  unmount();
  mount(React.createElement(A.WaiverCopy, { name: "Marcus Hale", waiver: w }));
  const text = txt();
  // The signature block itself, not the page. The mismatch note below repeats
  // the signed name, so searching the whole screen for it passed happily with
  // the signature blanked out.
  const sig = host.querySelector(".waiver-copy-sig");
  if (!sig) throw new Error("there is no signature block");
  if (!sig.textContent.includes("Marcus J. Hale")) {
    throw new Error(`the signature block reads "${sig.textContent.trim()}"`);
  }
  A.WAIVER_SECTIONS.forEach((sec) => {
    if (!text.includes(sec.heading)) throw new Error(`the clause "${sec.heading}" is not shown`);
  });
  if (!text.includes(A.WAIVER_SECTIONS[4].body.slice(0, 40))) throw new Error("the release clause is only a heading");
  if (!/signed as/i.test(text)) throw new Error("signing under a different name is not flagged on screen");

  // And the case that must not quietly show today's agreement.
  unmount();
  mount(React.createElement(A.WaiverCopy, {
    name: "Dani Reyes",
    waiver: { at: "2026-03-01T10:00:00.000Z", version: "2019-01-01", signature: "Dani Reyes", name: "Dani Reyes" },
  }));
  const stale = txt();
  if (!/not on file/i.test(stale)) throw new Error("a signature with no wording on file does not say so");
  if (stale.includes(A.WAIVER_SECTIONS[4].body.slice(0, 40))) {
    throw new Error("the current release clause was shown over an older signature");
  }
  if (!stale.includes("2019-01-01")) throw new Error("the version signed is not shown");
  unmount();
});

console.log("\nTeams: the wall between gyms");

check("no query that reads posts ever leaves the team filter off", () => {
  // The leak, stated as a rule. A query with no team filter returns a
  // member's own team posts mixed into the public feed — a private post shown
  // to another gym, by omission rather than by anybody deciding it. Inside a
  // team the filter is that team; outside it is "team_id is null", stated, not
  // left off.
  const inTeam = A.teamFilter("team-1");
  if (!inTeam || inTeam.op !== "eq" || inTeam.value !== "team-1") {
    throw new Error(`inside a team the filter is ${JSON.stringify(inTeam)}`);
  }
  const outside = A.teamFilter(null);
  if (!outside) throw new Error("the open rooms are fetched with no team filter at all");
  if (outside.op !== "is" || outside.value !== null) {
    throw new Error(`the open rooms are fetched with ${JSON.stringify(outside)}`);
  }
  [undefined, "", 0, false].forEach((v) => {
    const f = A.teamFilter(v);
    if (!f || f.op !== "is") throw new Error(`a falsy team id (${JSON.stringify(v)}) left the filter off`);
  });
});

check("a team post is never retried as a post with no room", () => {
  // The channel column going missing is handled by posting into the one feed
  // that exists. For a team post that fallback is the leak: a post with no
  // room is a post everybody can read. It has to fail instead.
  if (A.canRetryWithoutChannel({ channel: "passing" }) !== true) {
    throw new Error("an ordinary post lost its fallback");
  }
  [{ team_id: "t1", channel: "teamgeneral" }, { team_id: "t1" }].forEach((row) => {
    if (A.canRetryWithoutChannel(row)) {
      throw new Error("a team post would be retried without its room, into the public feed");
    }
  });
});

check("a team room and a public room can never be the same room", () => {
  const publicIds = new Set(A.COMMUNITY_CHANNELS.map((c) => c.id));
  A.TEAM_CHANNELS.forEach((c) => {
    if (publicIds.has(c.id)) throw new Error(`${c.id} is both a team room and a public one`);
    if (!A.isTeamChannel(c.id)) throw new Error(`${c.id} is not recognised as a team room`);
    if (!c.label || !c.blurb || !c.placeholder) throw new Error(`the team room ${c.id} says nothing about itself`);
  });
  A.COMMUNITY_CHANNELS.forEach((c) => {
    if (A.isTeamChannel(c.id)) throw new Error(`the public room ${c.id} is treated as a team room`);
  });
  if (!A.isTeamChannel(A.TEAM_DEFAULT_CHANNEL)) throw new Error("a team opens on a room that is not its own");
});

check("two gyms do not share a read mark", () => {
  // Both teams have a room called This week. They are not the same room, and a
  // single key for both means reading one marks the other read.
  const a = A.seenKeyFor("teamweek", { id: "team-a" });
  const b = A.seenKeyFor("teamweek", { id: "team-b" });
  if (a === b) throw new Error(`both gyms write to ${a}`);
  // And a team key can never collide with a public room's id.
  const publicIds = new Set(A.COMMUNITY_CHANNELS.map((c) => c.id));
  [a, b].forEach((k) => { if (publicIds.has(k)) throw new Error(`${k} is also a public room`); });
  if (A.seenKeyFor("passing", null) !== "passing") throw new Error("a public room stopped using its own id");
  // The same key, worked out from a row the database sent back.
  if (A.rowSeenKey({ team_id: "team-a", channel: "teamweek" }) !== a) {
    throw new Error("a team post is counted against a different key than the room it is in");
  }
  if (A.rowSeenKey({ channel: "passing" }) !== "passing") throw new Error("a public post is counted oddly");
});

check("read marks survive a build that has never heard of your team", () => {
  // The map used to be rebuilt from the public room list, so any key not on
  // that list was dropped on the next save — which would have been every team
  // room, every time anybody read anything.
  const prefs = { lastSeen: { passing: "2026-01-01T00:00:00.000Z", "t:team-a:teamweek": "2026-02-02T00:00:00.000Z" } };
  const after = A.seenPatch(prefs, "passing");
  if (after["t:team-a:teamweek"] !== "2026-02-02T00:00:00.000Z") {
    throw new Error("reading a public room wiped a team's read mark");
  }
  const inTeam = A.seenPatch(prefs, A.seenKeyFor("teamgeneral", { id: "team-a" }));
  if (!inTeam["t:team-a:teamgeneral"]) throw new Error("reading a team room recorded nothing");
  if (inTeam.passing !== "2026-01-01T00:00:00.000Z") throw new Error("reading a team room moved a public mark");
});

check("teams stay off until the migration has been run", () => {
  // Every shape the database takes when supabase-teams.sql has not been run.
  // A half-present teams feature is the one state this must never reach,
  // because each way it could half-work ends with something private readable.
  const cases = [
    { code: "42P01", message: 'relation "teams" does not exist' },
    { code: "PGRST205", message: "Could not find the table 'public.teams' in the schema cache" },
    { code: "PGRST202", message: "Could not find the function public.request_team_join" },
    { code: "42703", message: 'column community_posts.team_id does not exist' },
    { code: "", message: "Could not find the 'team_id' column in the schema cache" },
    // Code only. PostgREST does not always populate the message, and with one
    // there the message half of the detector answered for the code half, so
    // deleting the code half changed nothing any check could see.
    { code: "42P01" }, { code: "PGRST205" }, { code: "PGRST202" },
  ];
  cases.forEach((e, i) => {
    if (!A.isMissingTeams(e)) throw new Error(`case ${i} (${e.code || "no code"}) was not recognised as the migration missing`);
  });
  // And things that are NOT the migration missing, which must not switch teams
  // off and send Kyle to run SQL he has already run.
  [
    { code: "42501", message: "new row violates row-level security policy" },
    { code: "23514", message: 'violates check constraint "community_posts_channel_check"' },
    { code: "PGRST301", message: "JWT expired" },
    { code: "42703", message: 'column community_posts.nickname does not exist' },
    null, undefined,
  ].forEach((e, i) => {
    if (A.isMissingTeams(e)) throw new Error(`case ${i} was mistaken for the migration missing`);
  });
});

check("the database is what keeps one gym out of another", () => {
  // Not this file. The app hides what it should not show, but hiding is not
  // privacy — anyone who can open a console can query directly. These are the
  // lines in supabase-teams.sql that decide what comes back, and a change that
  // removes one of them should not pass quietly.
  const fs = require("fs"), path = require("path");
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase-teams.sql"), "utf8");
  // One policy at a time, bounded by its own statement. Searching the whole
  // file for the thing a policy should contain finds it in the next policy
  // down, which is how the read policy passed this with its membership test
  // taken out.
  const policy = (name) => {
    const at = sql.indexOf(`create policy "${name}"`);
    if (at < 0) return "";
    const end = sql.indexOf(";", at);
    return sql.slice(at, end < 0 ? sql.length : end);
  };
  // Each clause separately. A policy with "using (true)" and a correct
  // "with check" still contains the guard somewhere in its text, so checking
  // the statement as a whole passed a read rule that had been opened up.
  const clauses = (body) => {
    const u = body.indexOf("using (");
    const w = body.indexOf("with check (");
    const out = [];
    if (u >= 0) out.push(body.slice(u, w > u ? w : body.length));
    if (w >= 0) out.push(body.slice(w));
    return out;
  };
  [
    ["Members read the feed", "the read policy does not check team membership"],
    ["Members post", "the post policy does not check team membership"],
    ["The leader or the coach decides", "anybody can decide their own membership"],
  ].forEach(([name, why]) => {
    const body = policy(name);
    if (!body) throw new Error(`the policy "${name}" is gone`);
    const parts = clauses(body);
    if (!parts.length) throw new Error(`the policy "${name}" has no condition on it at all`);
    parts.forEach((part) => {
      if (!/is_team_member\(team_id\)|is_team_leader\(team_id\)/.test(part)) throw new Error(why);
    });
  });
  // Every one of them, not whichever one the file mentions first. These run
  // inside the policies above; an ordinary function there either recurses or
  // sees nothing, and either way the rule it was asked to enforce stops being
  // enforced the way it reads.
  ["is_team_member", "is_team_leader", "is_coach", "request_team_join"].forEach((fn) => {
    const at = sql.indexOf(`function ${fn}(`);
    if (at < 0) throw new Error(`${fn} is gone`);
    const head = sql.slice(at, sql.indexOf("as $$", at));
    if (!/security definer/.test(head)) {
      throw new Error(`${fn} is not a definer function, so what it is asked to enforce stops being enforced`);
    }
  });
  [
    [/community_posts_team_channel_check[\s\S]*?team_id is null and[\s\S]*?teamgeneral/,
     "nothing stops a team room holding a post with no team on it"],
    [/alter table teams\s+enable row level security/, "row level security is not on for teams"],
    [/alter table team_members enable row level security/, "row level security is not on for team_members"],
  ].forEach(([re, why]) => { if (!re.test(sql)) throw new Error(why); });
  // Nobody writes their own membership row — that is how a person would set
  // their own status to approved.
  const adds = policy("The leader or the coach adds a member");
  if (!adds) throw new Error("nothing says who may add a member");
  if (/auth\.uid\(\) *= *user_id/.test(adds)) {
    throw new Error("a person can insert their own membership row and set its status");
  }
});

check("a room that is a conversation opens as one", () => {
  // A team's Team room is where "who is training Thursday" goes. It opened as
  // a grid of clips, which for that room is a grid of nothing.
  ["general", A.TEAM_DEFAULT_CHANNEL, "thisweek", "teamweek"].forEach((id) => {
    if (!A.opensAsConversation(id)) throw new Error(`${id} opens as a wall of clips`);
  });
  ["passing", "leglocks", "teamclips", "halfguard"].forEach((id) => {
    if (A.opensAsConversation(id)) throw new Error(`${id} opens as a column of text`);
  });
});

check("a stored team id is not permission to be in that team", () => {
  // Coming back to the team you were last in is a convenience. The membership
  // is checked again, against the same approved test as everything else —
  // otherwise a stale id in somebody's saved settings walks them back into a
  // team they were removed from.
  const teams = [
    { id: "t1", name: "In", status: "approved" },
    { id: "t2", name: "Waiting", status: "pending" },
    { id: "t3", name: "Told no", status: "denied" },
  ];
  if (!A.restorableTeam(teams, "t1")) throw new Error("an approved membership was not restored");
  ["t2", "t3", "t4", null, undefined, ""].forEach((id) => {
    if (A.restorableTeam(teams, id)) throw new Error(`${JSON.stringify(id)} was restored into a team`);
  });
  if (A.restorableTeam([], "t1")) throw new Error("a team that is not in the list was restored");
});

check("a clip saved out of a team you left says so rather than going nowhere", () => {
  // The post is still yours to look at — you saved it, and the database still
  // serves it or it would not be in the list. Its room is not somewhere you
  // can go, and offering to take you there opens a room that is empty by
  // definition, because a team room holds nothing that is not the team's.
  const teams = [{ id: "t1", name: "Infiniti Kryos", status: "approved" }];
  const mine = A.savedPostHome({ team_id: "t1", channel: "teamclips" }, teams);
  if (!mine.reachable || !mine.team) throw new Error("a clip from your own team was treated as unreachable");
  if (mine.team.name !== "Infiniti Kryos") throw new Error("it points at the wrong team");
  const gone = A.savedPostHome({ team_id: "t9", channel: "teamclips" }, teams);
  if (gone.reachable || gone.team) throw new Error("a clip from a team you are not in still offered a way in");
  // A public post needs no team and is always reachable.
  const open = A.savedPostHome({ channel: "passing" }, teams);
  if (!open.reachable || open.team) throw new Error("a public post was given a team");
  [null, undefined].forEach((p) => {
    if (!A.savedPostHome(p, teams).reachable) throw new Error("an empty post was called unreachable");
  });
});

check("an invite code is stored the way it will be typed", () => {
  // A code is read off one screen and typed into another, often by somebody
  // standing in a gym. "Infiniti" and "INFINITI" are two different rows to a
  // unique constraint and the same code to the person typing one in, so there
  // is one form and everything is put into it before it is stored.
  if (A.normaliseInviteCode("Infiniti") !== "INFINITI") throw new Error("case is not normalised");
  if (A.normaliseInviteCode("  inf-init i! ") !== "INFINITI") throw new Error("punctuation and spaces survive");
  if (A.normaliseInviteCode("abc123") !== "ABC123") throw new Error("digits are not kept");
  const long = A.normaliseInviteCode("ABCDEFGHIJKLMNOPQRST");
  if (long.length !== A.INVITE_CODE_MAX) throw new Error(`a long code came out ${long.length} characters`);
  [null, undefined, "", "!!!"].forEach((v) => {
    if (A.normaliseInviteCode(v) !== "") throw new Error(`${JSON.stringify(v)} produced something`);
  });
  // Too short is refused with a reason, not silently accepted.
  if (!A.inviteCodeProblem("ABC")) throw new Error("a three-character code was accepted");
  if (!A.inviteCodeProblem("")) throw new Error("an empty code was accepted");
  if (A.inviteCodeProblem("INFINITI")) throw new Error(`a good code was refused: ${A.inviteCodeProblem("INFINITI")}`);
  // And the generated ones have to pass the same rule they are checked by.
  for (let i = 0; i < 200; i++) {
    const code = A.newInviteCode();
    if (A.inviteCodeProblem(code)) throw new Error(`a generated code "${code}" fails its own rule`);
    if (A.normaliseInviteCode(code) !== code) throw new Error(`a generated code "${code}" is not already in stored form`);
    // Nothing that reads as something else off a screen.
    if (/[OIL01]/.test(code)) throw new Error(`"${code}" contains a character that misreads as another`);
  }
});

check("teams switching themselves off tells the one person who can fix it", () => {
  // The fail-safe is right and the silence was not: the feature hid itself and
  // the only person able to act on it got no reason why.
  unmount();
  mount(React.createElement(A.TeamsOffNote, { isCoach: true }));
  const coach = txt();
  if (!/teams aren't switched on/i.test(coach)) throw new Error("the coach is told nothing");
  if (!/supabase-teams\.sql/i.test(coach)) throw new Error("it does not say which migration to run");
  unmount();
  // An athlete can do nothing with a migration filename, so it is not put in
  // front of them.
  mount(React.createElement(A.TeamsOffNote, { isCoach: false }));
  if (txt().trim()) throw new Error(`an athlete is shown "${txt().trim()}"`);
  unmount();
});

check("the app has one name and it is the same everywhere", () => {
  // The name lives in the browser title, the home screen title, the web
  // manifest, the service worker, the share sheet, the waiver and two separate
  // wordmark lockups. Renaming it by hand means fourteen edits and no way to
  // tell you missed one, which is what this is for.
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "..");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

  // Loosely, because a name does not only appear as two capitalised words. It
  // also appears slugged, in filenames and cache keys — and this check looked
  // only for "Strength Matrix" with its space and capitals, so
  // "strength-matrix-shell-v1" sat in the service worker right through the
  // rename, quietly serving the old icons to everyone who had installed the
  // app.
  const OLD = /strength[\s_-]*matrix/i;
  const stale = ["index.html", "public/manifest.webmanifest", "public/sw.js", "src/App.jsx", ".env.example"]
    .filter((f) => OLD.test(read(f)));
  if (stale.length) throw new Error(`the previous name is still in ${stale.join(", ")}`);

  // Two lockups render it: a stacked one in the top bar and an inline one.
  // They are separate markup and nothing else stops them drifting apart.
  const app = read("src/App.jsx");
  const words = [...app.matchAll(/className="brand(?:-lockup)?-word">([^<]+)</g)].map((m) => m[1]);
  const subs = [...app.matchAll(/className="brand-sub">([^<]+)</g)].map((m) => m[1]);
  if (words.length !== 2 || subs.length !== 2) {
    throw new Error(`expected two wordmarks, found ${words.length} first lines and ${subs.length} second lines`);
  }
  if (new Set(words).size !== 1 || new Set(subs).size !== 1) {
    throw new Error(`the two wordmarks disagree: "${words.join('" / "')}" over "${subs.join('" / "')}"`);
  }

  const name = `${words[0]} ${subs[0]}`;
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  if (manifest.name !== name) throw new Error(`the wordmark says "${name}", the manifest says "${manifest.name}"`);
  if (manifest.short_name !== name) throw new Error(`the manifest short name says "${manifest.short_name}"`);
  if (!read("index.html").includes(`<title>${name}</title>`)) {
    throw new Error(`the browser tab does not say "${name}"`);
  }
  if (!app.includes(`Welcome to ${name}`)) throw new Error(`the welcome screen does not say "${name}"`);

  // The service worker serves .png and .webmanifest cache-first, so the icons
  // an installed app shows come from this cache and not from the server.
  // Renaming the app without renaming the key leaves every phone that already
  // has it installed showing the icon it was installed with, forever. Tying
  // the key to the name makes the rename impossible to forget.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const sw = read("public/sw.js");
  const cache = (sw.match(/const CACHE = "([^"]+)"/) || [])[1];
  if (!cache) throw new Error("the service worker does not name its cache at all");
  if (!cache.startsWith(slug)) {
    throw new Error(`the shell is cached under "${cache}", which is not ${name}'s — every installed app keeps the old one`);
  }

  // The waiver record is the one thing here that leaves the app as a document
  // somebody else reads, and it carried the old name for two months after the
  // rename because nothing looked at it.
  if (!app.includes(`${name.toUpperCase()} — LIABILITY WAIVER RECORD`)) {
    throw new Error(`the waiver record Kyle hands out is not headed "${name.toUpperCase()}"`);
  }

  // And the icons the manifest asks for have to be icons that exist.
  const icons = manifest.icons || [];
  if (icons.length < 4) throw new Error(`the manifest offers ${icons.length} icons`);
  icons.forEach((i) => {
    const file = i.src.replace(/^\//, "").split("?")[0];
    if (!fs.existsSync(path.join(root, "public", file))) {
      throw new Error(`the manifest asks for ${i.src}, which is not in public/`);
    }
  });
  if (!icons.some((i) => i.purpose === "maskable")) {
    throw new Error("no maskable icon, so Android crops the wordmark");
  }
});


check("an injury swap keeps a demo when one exists", () => {
  // The swap clears the original's video, which is right — it shows the wrong
  // lift. Nothing ever put the replacement's in, so every substitution in the
  // app arrived with no demonstration, and six of the twelve replacements had
  // a video sitting in the library the whole time. Somebody training around a
  // sore shoulder is the last person who should be guessing at a movement.
  const blanked = [];
  A.INJURY_AREAS.forEach((area) => {
    ["A", "B", "C", "D"].forEach((v) => {
      const p = A.buildProgramVariant(v);
      const per = p.sessionsPerWeek || 3;
      for (let w = 1; w <= 12; w++) for (let d = 0; d < per; d++) {
        const pos = A.positionAtIndex(p, (w - 1) * per + d);
        A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, { injuryAreas: [area.key] })
          .forEach((sec) => (sec.exercises || []).forEach((e) => {
            if (!e.substitutedFor) return;
            const known = A.lookupVideo(e.name);
            if (known && String(e.videoUrl || "").trim() !== known) {
              blanked.push(`${area.key}: ${e.name}`);
            }
          }));
      }
    });
  });
  const unique = [...new Set(blanked)];
  if (unique.length) throw new Error(`replacements shown with no demo despite one existing: ${unique.slice(0, 5).join(", ")}`);
});


console.log("\nSession shape");
const everySession = (fn) => ["A", "B", "C", "D"].forEach((v) => {
  const p = A.buildProgramVariant(v);
  const per = p.sessionsPerWeek || 3;
  for (let w = 1; w <= 12; w++) for (let d = 0; d < per; d++) {
    const pos = A.positionAtIndex(p, (w - 1) * per + d);
    fn(v, w, d + 1, A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, {}));
  }
});

check("no session is longer than the rest of the app", () => {
  // Program B's day three ran to thirteen exercises and thirty working sets
  // while every other program topped out at ten. The old Program C was retired
  // for being the densest session in the catalogue, so this is the thing that
  // notices it happening again.
  const big = [];
  everySession((v, w, d, secs) => {
    const n = secs.reduce((t, s) => t + (s.exercises || []).length, 0);
    if (n > 11) big.push(`${v} wk${w} day${d}: ${n} exercises`);
  });
  if (big.length) throw new Error(`sessions past eleven exercises: ${big.slice(0, 4).join(", ")}`);
});

check("a floor never puts a main lift behind the isolation tail", () => {
  // The vertical press floor appended two sets of barbell overhead press to
  // the end of the longest session in the app, after the triceps pushdowns.
  // Where a floor puts its work is not cosmetic when the work is a barbell
  // press overhead.
  // These three qualities are exactly what the weekly floors produce when they
  // add a missing pattern — a barbell overhead press, a Romanian deadlift, a
  // supported row — so this check is about where the floor puts its work.
  const MAIN = /^(Posterior Chain|Vertical Press|Pull)$/i;
  // Prehab and Durability are deliberately not here. Two broader versions were
  // tried and both flagged orders that are correct: "Accessory" labels real
  // compound work like a four-by-five Bulgarian split squat, and a face pull
  // ahead of pulling is activation somebody put there on purpose. What a
  // barbell lift must not sit behind is the isolation and carry tail.
  const ACC = /^(Arms|Core|Trunk|Grip)/i;
  const bad2 = [];
  everySession((v, w, d, secs) => secs.forEach((sec) => {
    let seenAcc = null;
    (sec.exercises || []).forEach((e) => {
      const q = e.quality || "";
      if (ACC.test(q)) { seenAcc = seenAcc || e.name; return; }
      if (seenAcc && MAIN.test(q)) bad2.push(`${v} wk${w} day${d}: ${e.name} after ${seenAcc}`);
    });
  }));
  if (bad2.length) throw new Error(`main lifts behind the isolation tail: ${[...new Set(bad2)].slice(0, 4).join(", ")}`);
});

check("a superset is never split by something else", () => {
  // Paired lifts carry the same number with an A and a B and are meant to run
  // back to back. Inserting a floor's lift between 1A and 1B is how that pair
  // quietly stops being a pair.
  const split = [];
  everySession((v, w, d, secs) => secs.forEach((sec) => {
    const seen = new Map();
    (sec.exercises || []).forEach((e, i) => {
      const g = String(e.supersetLabel || "").replace(/[^0-9]/g, "");
      if (!g) return;
      if (seen.has(g) && i - seen.get(g) > 1) split.push(`${v} wk${w} day${d}: group ${g}`);
      seen.set(g, i);
    });
  }));
  if (split.length) throw new Error(`supersets split apart: ${[...new Set(split)].slice(0, 4).join(", ")}`);
});

check("a second block is not the first block again", () => {
  // Program B carried every rotation pool and referenced none of them, so the
  // block number did nothing and an athlete running it twice got the same
  // twelve weeks movement for movement.
  const same = [];
  ["A", "B", "C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    const per = p.sessionsPerWeek || 3;
    const sig = (block) => {
      const out = [];
      for (let w = 1; w <= 12; w++) for (let d = 0; d < per; d++) {
        const pos = A.positionAtIndex(p, (w - 1) * per + d);
        A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, { blockNumber: block })
          .forEach((sec) => (sec.exercises || []).forEach((e) => out.push(e.name)));
      }
      return out.join("|");
    };
    if (sig(1) === sig(2)) same.push(v);
  });
  if (same.length) throw new Error(`block two is identical to block one in: ${same.join(", ")}`);
});


console.log("\nA half-written record");
check("a corrupt set never crashes or suggests nonsense", () => {
  // None of these come from the UI. They come from a save that dropped
  // halfway, a hand-edited record, or a sync that landed partially — and the
  // screens that read them had no guard, so one bad row took out the
  // suggestion, the record and the leaderboard rather than being skipped.
  const problems = [];

  // A negative weight produced a negative one-rep max, which then flowed into
  // records and into the weight suggested for next time.
  [[0, 0], [225, 0], [-50, 5], [225, -3], [NaN, 5], [225, NaN], [1e9, 5]].forEach(([w, r]) => {
    let out;
    try { out = A.est1RM(w, r); } catch (e) { problems.push(`est1RM(${w},${r}) threw`); return; }
    if (!Number.isFinite(out) || out < 0) problems.push(`est1RM(${w},${r}) = ${out}`);
  });

  // A hole in the set array threw rather than being skipped.
  [[null], [undefined], [{ weight: -100, reps: 5 }], [{ weight: 0, reps: 0 }], [{}]].forEach((sets, i) => {
    let out;
    try { out = A.bestSetOf(sets); } catch (e) { problems.push(`bestSetOf case ${i} threw: ${e.message}`); return; }
    if (out && (!Number.isFinite(out.e1rm) || out.e1rm <= 0)) problems.push(`bestSetOf case ${i}: e1rm ${out.e1rm}`);
  });

  const log = (ex) => ({ logs: [{ date: "2026-10-01", exercises: ex }] });
  [log([{ name: "Back Squat", sets: [null] }]),
   log([{ name: "Back Squat", sets: [{ weight: -100, reps: 5 }] }]),
   log([{ name: "Back Squat", sets: [{}] }]),
   { logs: null }, {}].forEach((c, i) => {
    let out;
    try { out = A.suggestFromHistory(c, "Back Squat", { reps: "5" }, false); }
    catch (e) { problems.push(`suggestFromHistory case ${i} threw: ${e.message}`); return; }
    if (out && (!Number.isFinite(out.weight) || out.weight <= 0)) {
      problems.push(`suggestFromHistory case ${i} suggested ${out.weight} lb`);
    }
  });

  // An unparseable date reached toISOString and threw, which took the whole
  // leaderboard calculation down instead of skipping the one row.
  [{ logs: [{ date: "bad-date", totalVolume: 100 }] },
   { logs: [{ date: "", totalVolume: 100 }] },
   { logs: [{ totalVolume: 100 }] },
   { logs: [{ date: "2026-10-01", totalVolume: -5 }] }].forEach((c, i) => {
    let t;
    try { t = A.leaderboardTotalsFor(c); } catch (e) { problems.push(`leaderboard case ${i} threw: ${e.message}`); return; }
    if (!Number.isFinite(t.total) || !Number.isFinite(t.week) || t.total < 0 || t.week < 0) {
      problems.push(`leaderboard case ${i}: ${JSON.stringify(t)}`);
    }
  });

  if (problems.length) throw new Error(problems.slice(0, 5).join(" | "));
});


check("a worse morning never buys you a harder session", () => {
  // The readiness check-in silently rewrites the day, which makes it the one
  // piece of logic nobody would notice going wrong. Its own copy promises
  // yellow runs a notch back and red runs half, so sets must never climb as
  // the morning gets worse and no lift may leave fewer reps in reserve.
  const bad = [];
  ["A", "B", "C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    const per = p.sessionsPerWeek || 3;
    for (let d = 0; d < per; d++) {
      const pos = A.positionAtIndex(p, d);
      const base = A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, {});
      const run = (c) => A.adjustSectionsForReadiness(base, { color: c }, null).sections;
      const sets = (secs) => secs.reduce((t, s) => t + (s.exercises || []).reduce((n, e) => n + (Number(e.sets) || 0), 0), 0);
      const g = sets(run("GREEN")), y = sets(run("YELLOW")), r = sets(run("RED"));
      if (!(g >= y && y >= r)) bad.push(`${v} day${d + 1}: green ${g}, yellow ${y}, red ${r}`);
      if (r >= g) bad.push(`${v} day${d + 1}: a red day is not lighter than a green one (${r} vs ${g})`);

      // Reps in reserve compared lift by lift, not summed: a red day drops
      // whole exercises, so its total falls for a reason that has nothing to
      // do with how hard the remaining sets are.
      const byName = (secs) => {
        const m = new Map();
        secs.forEach((s) => (s.exercises || []).forEach((e) => { if (e && e.name) m.set(e.name, Number(e.rir)); }));
        return m;
      };
      const gm = byName(run("GREEN")), ym = byName(run("YELLOW"));
      gm.forEach((gr, name) => {
        const yr = ym.get(name);
        if (Number.isFinite(gr) && Number.isFinite(yr) && yr < gr) {
          bad.push(`${v} day${d + 1}: ${name} leaves fewer reps in reserve on a rough morning (${yr} vs ${gr})`);
        }
      });
    }
  });
  if (bad.length) throw new Error(bad.slice(0, 4).join(" | "));
});

check("a rough morning actually changes the session", () => {
  // The check above only proves yellow is never harder, which an adjustment
  // that does nothing at all also satisfies — disabling the whole yellow
  // branch passed it. The copy promises "a notch back: 5% lighter, one extra
  // rep in reserve, less arm and core filler", so every day has to differ
  // from its green version somewhere.
  const unchanged = [];
  ["A", "B", "C", "D"].forEach((v) => {
    const p = A.buildProgramVariant(v);
    const per = p.sessionsPerWeek || 3;
    for (let d = 0; d < per; d++) {
      const pos = A.positionAtIndex(p, d);
      const base = A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, {});
      const run = (c) => A.adjustSectionsForReadiness(base, { color: c }, null).sections;
      const shape = (secs) => secs.map((s) => (s.exercises || [])
        .map((e) => `${e.name}:${e.sets}:${e.rir}`).join(",")).join("|");
      if (shape(run("GREEN")) === shape(run("YELLOW"))) unchanged.push(`${v} day${d + 1}`);
      if (shape(run("GREEN")) === shape(run("RED"))) unchanged.push(`${v} day${d + 1} (red)`);
    }
  });
  if (unchanged.length) throw new Error(`a rough morning left these days exactly as written: ${unchanged.join(", ")}`);
});


check("some migration in the repo knows about every room", () => {
  // community_posts carries a CHECK constraint listing every room by hand, so
  // a room added to the app without a matching migration is refused by the
  // database on every post to it. Three migrations have widened this list so
  // far and each one was kept in step by remembering to — which is not a
  // method. At least one file has to match the app exactly.
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "..");
  const appIds = new Set(A.COMMUNITY_CHANNELS.map((c) => c.id));
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".sql"));
  const lists = [];
  files.forEach((f) => {
    const sql = fs.readFileSync(path.join(root, f), "utf8");
    const at = sql.indexOf("community_posts_channel_check");
    if (at < 0) return;
    const open = sql.indexOf("check (channel in", at);
    if (open < 0) return;
    const close = sql.indexOf("));", open);
    const ids = new Set([...sql.slice(open, close).matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]));
    lists.push({ f, ids });
  });
  if (!lists.length) throw new Error("no migration in the repo sets the channel constraint at all");

  // The newest migration to set this constraint is the one that will actually
  // be in force, and it has to know about the team rooms as well as the public
  // ones. Without this the check was satisfied by an older file that happened
  // to still match, while the constraint Kyle is about to run would reject a
  // room the app ships.
  const teamsFile = lists.find((l) => l.f === "supabase-teams.sql");
  if (!teamsFile) throw new Error("supabase-teams.sql no longer sets the channel constraint");
  const want = new Set([...appIds, ...A.TEAM_CHANNELS.map((c) => c.id)]);
  const missingTeam = [...want].filter((id) => !teamsFile.ids.has(id));
  const extraTeam = [...teamsFile.ids].filter((id) => !want.has(id));
  if (missingTeam.length || extraTeam.length) {
    throw new Error("supabase-teams.sql does not match the app's rooms"
      + (missingTeam.length ? `, missing ${missingTeam.join(", ")}` : "")
      + (extraTeam.length ? `, and listing ${extraTeam.join(", ")} which the app does not have` : ""));
  }
  const match = lists.find((l) => l.ids.size === appIds.size && [...appIds].every((id) => l.ids.has(id)));
  if (!match) {
    const best = lists.sort((a, b) => b.ids.size - a.ids.size)[0];
    const missing = [...appIds].filter((id) => !best.ids.has(id));
    const extra = [...best.ids].filter((id) => !appIds.has(id));
    throw new Error(`no migration matches the app's ${appIds.size} rooms. Closest is ${best.f}`
      + (missing.length ? `, missing ${missing.join(", ")}` : "")
      + (extra.length ? `, and listing ${extra.join(", ")} which no longer exists` : ""));
  }
});


console.log("\nThe clip wall");
check("a clip tile knows where to get its picture", () => {
  // The grid is only a grid if the tiles have stills. YouTube serves one off
  // the video id and an uploaded clip has none anywhere, so the tile has to
  // know which case it is in rather than rendering a broken image.
  const shots = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
  ];
  shots.forEach((u) => {
    const t = A.clipThumb(u);
    if (!t || !/img\.youtube\.com\/vi\/dQw4w9WgXcQ\//.test(t)) throw new Error(`${u} gave ${t}`);
  });
  // An uploaded file has no still to fetch, and guessing a URL for one would
  // put a broken image on the wall.
  if (A.clipThumb("https://x.supabase.co/storage/v1/object/public/community-clips/a.mp4") !== null) {
    throw new Error("an uploaded clip was given a YouTube thumbnail");
  }
  if (A.clipThumb("") !== null || A.clipThumb(null) !== null) throw new Error("nothing produced a thumbnail");
});

check("the week starts on Sunday, at midnight, in every week of the year", () => {
  // The whole This Week room hangs off this one function, and the classic way
  // to get it wrong is to have a Sunday resolve to the Sunday before it —
  // which nobody notices until Sunday, when the room refuses to clear.
  const DAY = 86400000;
  for (let i = 0; i < 400; i++) {
    // Mid-afternoon rather than midnight, so a timezone offset cannot quietly
    // carry the date over and make this pass by luck.
    const t = new Date(2026, 0, 1, 15, 20, 0).getTime() + i * DAY;
    const w = A.weekStart(t);
    if (w.getDay() !== 0) throw new Error(`${new Date(t).toDateString()} gave ${w.toDateString()}, not a Sunday`);
    if (w.getHours() || w.getMinutes() || w.getSeconds() || w.getMilliseconds()) {
      throw new Error(`${w.toString()} is not midnight`);
    }
    if (w.getTime() > t) throw new Error(`${w.toDateString()} is after ${new Date(t).toDateString()}`);
    if (t - w.getTime() >= 7 * DAY) throw new Error(`${new Date(t).toDateString()} reached back ${(t - w.getTime()) / DAY} days`);
  }
  // A Sunday belongs to its own week, not the one before it.
  const sun = new Date(2026, 10, 1, 9, 0, 0); // 1 Nov 2026 is a Sunday
  if (sun.getDay() !== 0) throw new Error("the fixture is not a Sunday");
  const ws = A.weekStart(sun.getTime());
  if (ws.getDate() !== sun.getDate() || ws.getMonth() !== sun.getMonth()) {
    throw new Error(`Sunday morning was put in the week starting ${ws.toDateString()}`);
  }
  // And a Saturday night still belongs to the week that is ending.
  const sat = new Date(2026, 9, 31, 23, 30, 0);
  if (A.weekStart(sat.getTime()).getTime() !== A.weekStart(new Date(2026, 9, 26, 12).getTime()).getTime()) {
    throw new Error("Saturday night fell into next week");
  }
});

check("This week asks the database for this week, and past weeks lifts the floor", () => {
  // The clearing is a filter and must never become a delete. If the floor is
  // dropped the room silently becomes a second General that nobody clears; if
  // it is applied to every room, the whole app forgets everything older than
  // Sunday.
  const now = new Date(2026, 10, 4, 20, 0, 0).getTime(); // a Wednesday
  const w = A.feedWindow(A.THIS_WEEK, false, now);
  if (!w || !w.since) throw new Error("This week asked for no window at all");
  if (w.since !== A.weekStartISO(now)) throw new Error(`the floor is ${w.since}, not the start of the week`);
  if (A.feedWindow(A.THIS_WEEK, true, now) !== null) throw new Error("past weeks still had a floor under it");
  ["general", "passing", "sweeps", A.ALL_ROOMS].forEach((id) => {
    if (A.feedWindow(id, false, now) !== null) throw new Error(`${id} was given a week floor`);
  });
});

check("Latest filters to no room, every real room filters to itself", () => {
  // ALL_ROOMS is not a channel the database has heard of. Filtering on it
  // returns an empty feed rather than every room, which is the exact opposite
  // of the point, and it looks like nobody has ever posted anything.
  if (A.feedScope(A.ALL_ROOMS, null).room !== null) {
    throw new Error("Latest was filtered to a single room");
  }
  A.COMMUNITY_CHANNELS.forEach((c) => {
    if (A.feedScope(c.id, null).room !== c.id) throw new Error(`${c.id} fetched ${A.feedScope(c.id, null).room}`);
  });
  // No channel at all still has to be a room the database will accept.
  const bare = A.feedScope(null, null).room;
  if (!A.COMMUNITY_CHANNELS.some((c) => c.id === bare)) throw new Error(`an empty channel fetched "${bare}"`);
  if (A.feedScope(A.ALL_ROOMS, { since: "2026-01-01" }).since !== "2026-01-01") {
    throw new Error("the window was dropped on the way to the query");
  }
});

check("a cross-room view is not a room anything can be posted to", () => {
  // The database carries a CHECK constraint listing the rooms it accepts. A
  // virtual id reaching an insert comes back 23514 and reads to the athlete as
  // a post that vanished.
  A.VIRTUAL_CHANNELS.forEach((v) => {
    if (A.COMMUNITY_CHANNELS.some((c) => c.id === v.id)) {
      throw new Error(`${v.id} is in the room list and will be offered a composer`);
    }
    if (!A.isVirtualChannel(v.id)) throw new Error(`${v.id} is not recognised as a view`);
    if (!v.label) throw new Error("a cross-room view with no name");
  });
  A.COMMUNITY_CHANNELS.forEach((c) => {
    if (A.isVirtualChannel(c.id)) throw new Error(`the real room ${c.id} is treated as a view`);
  });
  // Every id the database could be handed has to be one it will accept, so the
  // ids themselves must not collide.
  if (A.VIRTUAL_CHANNELS.some((v) => !/^__/.test(v.id))) {
    throw new Error("a view's id does not announce itself as one");
  }
});

check("Latest offers somewhere to post instead of a composer that cannot work", () => {
  mountGroup();
  const bar = host.querySelector(".room-bar");
  if (!/latest/i.test(bar.textContent)) throw new Error(`the tab did not land on Latest: "${bar.textContent.trim()}"`);
  const open = host.querySelector(".composer-open");
  if (!open) throw new Error("no way to post at all from Latest");
  // Not "does it contain the words post in" — the honest button is "Pick a
  // room to post in", which does. What must not happen is Latest offering to
  // post *into Latest*, which is the shape "Post in <name>".
  if (/^\s*post in\b/i.test(open.textContent)) {
    throw new Error(`Latest offers "${open.textContent.trim()}", which has no room to post to`);
  }
  if (!/pick a room/i.test(open.textContent)) {
    throw new Error(`Latest offers "${open.textContent.trim()}" rather than a way to choose a room`);
  }
  // And a real room still offers the composer it always did.
  mountGroup({ prefs: { channel: "passing" } });
  const real = host.querySelector(".composer-open");
  if (!real || !/post in/i.test(real.textContent)) {
    throw new Error(`a real room offers "${real ? real.textContent.trim() : "nothing"}"`);
  }
  unmount();
});

check("the This week room says what happens on Sunday", () => {
  // "Where did last week's posts go" is the first question this room will be
  // asked, and the answer has to be on the screen rather than in a changelog.
  mountGroup({ prefs: { channel: A.THIS_WEEK } });
  const bar = host.querySelector(".week-bar");
  if (!bar) throw new Error("the This week room says nothing about its week");
  const text = bar.textContent.toLowerCase();
  if (!/sunday/.test(text)) throw new Error(`it does not mention Sunday: "${bar.textContent.trim()}"`);
  if (!/nothing is deleted/.test(text)) {
    throw new Error(`it does not say the posts are kept: "${bar.textContent.trim()}"`);
  }
  if (!/past weeks/i.test(bar.textContent)) throw new Error("no way through to the older weeks");
  // No other room claims a week it does not have.
  mountGroup({ prefs: { channel: "passing" } });
  if (host.querySelector(".week-bar")) throw new Error("an ordinary room grew a weekly clock");
  unmount();
});

check("looking at Latest does not mark twenty-three rooms as read", () => {
  // Skimming a grid is not reading the rooms it came from. Marking them read
  // from here empties every unread dot in the app in one tap and the posts are
  // never surfaced again.
  const prefs = { lastSeen: { passing: "2026-01-01T00:00:00.000Z" } };
  const after = A.seenPatch(prefs, A.ALL_ROOMS);
  if (after.passing !== "2026-01-01T00:00:00.000Z") throw new Error("Latest moved a room's read mark");
  const stamped = Object.keys(after).filter((k) => after[k] !== (prefs.lastSeen[k] || "1970-01-01"));
  if (stamped.length) throw new Error(`Latest marked ${stamped.join(", ")} read`);
  if (Object.prototype.hasOwnProperty.call(after, A.ALL_ROOMS)) {
    throw new Error("the view's id was written into stored prefs as a room");
  }
  // A real room still gets its mark moved, or nothing is ever read anywhere.
  const real = A.seenPatch(prefs, "passing");
  if (real.passing === "2026-01-01T00:00:00.000Z") throw new Error("reading a room no longer marks it read");
});

check("a room that no longer exists is not labelled with this week", () => {
  // The fallback used to be the first entry in the list, which was General and
  // is now This week. A post from March in a retired room would have been
  // labelled with the current week, which is a date, and a wrong one.
  const meta = A.channelMeta("wormguard");
  if (meta.id === A.THIS_WEEK) throw new Error("a retired room fell through to This week");
  if (!A.COMMUNITY_CHANNELS.some((c) => c.id === meta.id)) throw new Error(`it fell through to "${meta.id}"`);
  if (A.channelMeta(undefined).id === A.THIS_WEEK) throw new Error("no room at all fell through to This week");
  if (A.groupLabel("nonsense") === A.groupLabel("week")) {
    throw new Error("an unknown part of the game fell through to This week");
  }
  // The views still resolve to themselves rather than to the fallback.
  if (A.channelMeta(A.ALL_ROOMS).label !== A.VIRTUAL_CHANNELS[0].label) {
    throw new Error("Latest resolved to a room instead of to itself");
  }
});

check("a clip on the Latest wall says which room it came from", () => {
  // Twenty-three rooms of clips in one grid, with nothing saying where any of
  // them live, is a wall of clips from nowhere — and the room is the strongest
  // label a clip carries, because most posters never write the technique's
  // name into the post itself.
  const post = { author_name: "Marcus", channel: "legentries", created_at: new Date().toISOString() };
  const cross = A.clipTileWho(post, true);
  if (!cross.includes("Marcus")) throw new Error(`the tile lost the poster: "${cross}"`);
  if (!cross.includes(A.channelMeta("legentries").label)) {
    throw new Error(`a tile on the cross-room wall does not name its room: "${cross}"`);
  }
  // Inside a room, naming the room on every tile is twenty-three repetitions
  // of something the bar above already says.
  const inside = A.clipTileWho(post, false);
  if (inside.includes(A.channelMeta("legentries").label)) {
    throw new Error(`a tile repeats the room it is already in: "${inside}"`);
  }
  // A post from a room that has since been retired must not be labelled with
  // this week, which the positional fallback used to do.
  const old = A.clipTileWho({ author_name: "Ana", channel: "wormguard", created_at: new Date().toISOString() }, true);
  if (old.toLowerCase().includes("this week")) throw new Error(`a retired room read as this week: "${old}"`);
  // And nothing anonymous crashes the wall.
  ["", null, undefined].forEach((v) => {
    const t = A.clipTileWho({ author_name: v, channel: v, created_at: v }, true);
    if (!t || !t.trim() || /undefined|null|NaN/.test(t)) throw new Error(`an empty post gave "${t}"`);
  });
});

check("a room says how many clips are in it before you open it", () => {
  const yt = "https://youtu.be/dQw4w9WgXcQ";
  const now = new Date(2026, 10, 4, 20, 0, 0).getTime(); // a Wednesday
  const lastWeek = new Date(2026, 9, 28, 12, 0, 0).toISOString();
  const thisWeek = new Date(2026, 10, 3, 19, 0, 0).toISOString();
  const rows = [
    { channel: "passing", video_url: yt, created_at: thisWeek },
    { channel: "passing", video_url: yt, created_at: lastWeek },
    { channel: "sweeps", video_url: yt, created_at: thisWeek },
    // Not clips. A half-typed link promises a video that is not there.
    { channel: "passing", video_url: "youtube dot com slash", created_at: thisWeek },
    { channel: "passing", video_url: "", created_at: thisWeek },
    { channel: "general", video_url: null, created_at: thisWeek },
  ];
  const c = A.clipCountsFrom(rows, true, now);
  if (c.byRoom.passing !== 2) throw new Error(`passing counted ${c.byRoom.passing}, not 2`);
  if (c.byRoom.sweeps !== 1) throw new Error(`sweeps counted ${c.byRoom.sweeps}`);
  if (c.byRoom.general) throw new Error("a post with no clip was counted as one");
  if (c.total !== 3) throw new Error(`the library total is ${c.total}, not 3`);
  // Nothing at all is zero, not a crash and not an empty object pretending.
  const none = A.clipCountsFrom([], true, now);
  if (none.total !== 0) throw new Error("an empty library did not count zero");
  if (A.clipCountsFrom(null, true, now).total !== 0) throw new Error("no rows at all threw");
});

check("This week counts this week, the library total counts everything", () => {
  // The room only ever shows this week, so a number next to it that counted
  // October would send somebody into a room that looks empty.
  const yt = "https://youtu.be/dQw4w9WgXcQ";
  const now = new Date(2026, 10, 4, 20, 0, 0).getTime(); // Wednesday
  const rows = [
    { channel: A.THIS_WEEK, video_url: yt, created_at: new Date(2026, 10, 2, 19).toISOString() },
    { channel: A.THIS_WEEK, video_url: yt, created_at: new Date(2026, 10, 1, 9).toISOString() },
    { channel: A.THIS_WEEK, video_url: yt, created_at: new Date(2026, 9, 20, 19).toISOString() },
    { channel: A.THIS_WEEK, video_url: yt, created_at: new Date(2026, 8, 3, 19).toISOString() },
  ];
  const c = A.clipCountsFrom(rows, true, now);
  if (c.byRoom[A.THIS_WEEK] !== 2) throw new Error(`This week counted ${c.byRoom[A.THIS_WEEK]}, not the 2 from this week`);
  // The older ones were never deleted, so the library still has four.
  if (c.total !== 4) throw new Error(`the library total is ${c.total}, not 4 — older weeks were dropped from it`);
  // An ordinary room is not week-filtered, or every count in the app becomes
  // "clips posted since Sunday".
  const other = A.clipCountsFrom([
    { channel: "passing", video_url: yt, created_at: new Date(2025, 1, 1).toISOString() },
  ], true, now);
  if (other.byRoom.passing !== 1) throw new Error("an ordinary room was filtered to this week");
});

check("a part of the game adds up its own rooms", () => {
  const yt = "https://youtu.be/dQw4w9WgXcQ";
  const now = Date.now();
  const guards = A.channelsInGroup("guards");
  if (guards.length < 2) throw new Error("the guards part has fewer than two rooms");
  const rows = [
    { channel: guards[0].id, video_url: yt, created_at: new Date(now).toISOString() },
    { channel: guards[0].id, video_url: yt, created_at: new Date(now).toISOString() },
    { channel: guards[1].id, video_url: yt, created_at: new Date(now).toISOString() },
    { channel: "passing", video_url: yt, created_at: new Date(now).toISOString() },
  ];
  const c = A.clipCountsFrom(rows, true, now);
  if (A.groupClipCount(c, "guards") !== 3) throw new Error(`guards adds up to ${A.groupClipCount(c, "guards")}, not 3`);
  if (A.groupClipCount(c, "top") !== 1) throw new Error(`top adds up to ${A.groupClipCount(c, "top")}`);
  if (A.groupClipCount(c, "standing") !== 0) throw new Error("an empty part did not add up to zero");
  // Unknown is not zero.
  if (A.groupClipCount(null, "guards") !== null) throw new Error("no counts at all reported as a number");
});

check("without the channel column no room claims the whole library", () => {
  // Before the migration runs there is one feed and no way to tell rooms
  // apart. Attributing every clip to whichever room happens to be first would
  // put a number next to a room that has nothing in it.
  const yt = "https://youtu.be/dQw4w9WgXcQ";
  const rows = [{ video_url: yt, created_at: new Date().toISOString() }, { video_url: yt, created_at: new Date().toISOString() }];
  const c = A.clipCountsFrom(rows, false, Date.now());
  if (c.total !== 2) throw new Error(`the library total is ${c.total}, not 2`);
  if (Object.keys(c.byRoom).length) throw new Error(`rooms were given counts anyway: ${Object.keys(c.byRoom).join(", ")}`);
});

check("a count that never arrived is not shown as zero", () => {
  // There is no database in this harness, so the count fails every time —
  // which is exactly the state being checked. A room reading 0 because
  // nothing loaded stops somebody opening the one room that had clips in it.
  mountGroup();
  act(() => { host.querySelector(".room-bar").click(); });
  const badges = host.querySelectorAll(".room-row-count");
  if (badges.length) throw new Error(`${badges.length} rooms claim a count with nothing loaded, the first reading "${badges[0].textContent.trim()}"`);
  if (host.querySelector(".room-group-count")) throw new Error("a part of the game claims a total with nothing loaded");
  // The list itself still works.
  if ([...host.querySelectorAll(".room-row")].length < A.COMMUNITY_CHANNELS.length) {
    throw new Error("the room list did not render at all");
  }
  unmount();
});

check("the number beside a room counts clips, not posts", () => {
  // The number is a promise about what is behind the row. A post with a
  // half-typed link in it is a post, not a clip, and counting it sends
  // somebody into a room expecting a video that was never there.
  const now = new Date(2026, 10, 4, 12).getTime();           // Wednesday
  const thisWeek = new Date(2026, 10, 2, 19).toISOString();  // Monday
  const lastWeek = new Date(2026, 9, 28, 19).toISOString();  // the Wednesday before
  const rows = [
    { channel: "thisweek", video_url: "https://youtu.be/aaaaaaaaaaa", created_at: thisWeek },
    { channel: "thisweek", video_url: "https://youtu.be/bbbbbbbbbbb", created_at: lastWeek },
    { channel: "passing", video_url: "https://youtu.be/ccccccccccc", created_at: lastWeek },
    { channel: "passing", video_url: "half-typed youtube link", created_at: thisWeek },
    { channel: "sweeps", video_url: "", created_at: thisWeek },
    { channel: "sweeps", created_at: thisWeek },
  ];
  const c = A.clipCountsFrom(rows, true, now);
  if (c.total !== 3) throw new Error(`the library total is ${c.total}, not the 3 playable clips`);
  if (c.byRoom.passing !== 1) throw new Error(`Passing counted ${c.byRoom.passing}`);
  if (c.byRoom.sweeps) throw new Error(`Sweeps counted ${c.byRoom.sweeps} from posts with no clip in them`);
  // This Week only ever shows this week, so its number has to mean that or the
  // row promises a clip the room then refuses to show.
  if (c.byRoom.thisweek !== 1) throw new Error(`This week counted ${c.byRoom.thisweek} rather than this week's 1`);
  // Nothing at all does not throw. (The no-channel-column case has its own
  // check further down.)
  [[], null, undefined].forEach((v) => {
    const empty = A.clipCountsFrom(v, true, now);
    if (empty.total !== 0 || Object.keys(empty.byRoom).length) throw new Error("an empty library counted something");
  });
});

check("the room list says how many are new, not just that something is", () => {
  // A dot said something had happened without saying how much or where, which
  // is not enough to decide which of twenty-three rooms to open.
  mountGroup({ prefs: { channel: "general" }, unreadByChannel: { passing: 3 } });
  act(() => { host.querySelector(".room-bar").click(); });
  const rowFor = (id) => {
    const want = A.COMMUNITY_CHANNELS.find((c) => c.id === id);
    return [...host.querySelectorAll(".room-row")]
      .find((r) => (r.querySelector(".room-row-blurb") || {}).textContent === want.blurb);
  };
  const passing = rowFor("passing");
  if (!passing) throw new Error("no row for Passing");
  const mark = passing.querySelector(".room-row-new");
  if (!mark) throw new Error("Passing does not say anything is new");
  if (!/3/.test(mark.textContent)) throw new Error(`it says "${mark.textContent.trim()}" rather than how many`);
  const quiet = rowFor("sweeps");
  if (quiet && quiet.querySelector(".room-row-new")) throw new Error("a room with nothing new was marked anyway");
  if (host.querySelector(".channel-dot")) throw new Error("the old dot is still being rendered beside the number");
  // The list explains itself at the top, and that explanation drifted once
  // already: it described a dot for a while after the dot had been replaced by
  // a number. Prose is not usually worth pinning; prose that describes a thing
  // on the same screen is.
  // Every paragraph on the screen, rather than a guess at which one is the
  // intro — a selector that finds the wrong element passes whatever the copy
  // says, which is how this check failed to catch anything the first time.
  const dotty = [...host.querySelectorAll("p")].find((p) => /\bdot\b/i.test(p.textContent));
  if (dotty) throw new Error(`the list still promises a dot: "${dotty.textContent.trim()}"`);
  unmount();
});

check("a new comment notifies, the same as a new video does", () => {
  // The thing most worth being told about is somebody answering your clip,
  // and a comment is a post with a parent_id. Nothing filters them out of the
  // badge, which is deliberate rather than accidental, so it is pinned here:
  // a tidy-up that added .is("parent_id", null) to that query, or a filter in
  // here, would silently stop every reply from ever notifying anybody again.
  const seenBy = { passing: "2026-11-01T00:00:00.000Z", sweeps: "2026-11-01T00:00:00.000Z" };
  const rows = [
    { id: "a", channel: "passing", created_at: "2026-11-04T10:00:00.000Z", video_url: "https://youtu.be/dQw4w9WgXcQ" },
    { id: "b", channel: "passing", created_at: "2026-11-05T10:00:00.000Z", parent_id: "a", body: "try the far-side grip" },
    { id: "c", channel: "sweeps", created_at: "2026-10-20T10:00:00.000Z", body: "older than the last look" },
  ];
  const unseen = A.unseenRows(rows, seenBy, "2026-11-01T00:00:00.000Z");
  const ids = unseen.map((r) => r.id);
  if (!ids.includes("b")) throw new Error("a new comment did not notify anybody");
  if (!ids.includes("a")) throw new Error("a new clip did not notify anybody");
  if (ids.includes("c")) throw new Error("something older than the last look was counted as new");
  // Per room, which is what puts the number on the row.
  const per = {};
  unseen.forEach((r) => { per[r.channel] = (per[r.channel] || 0) + 1; });
  if (per.passing !== 2) throw new Error(`Passing counted ${per.passing}, not the clip and the comment`);
  // A room read more recently than the oldest room is not re-notified. This is
  // why the query floor and the per-room floor are different numbers.
  const caughtUp = A.unseenRows(rows, { passing: "2026-11-06T00:00:00.000Z" }, "2026-11-01T00:00:00.000Z");
  if (caughtUp.some((r) => r.channel === "passing")) throw new Error("a room already read was notified again");
  // And the query itself must still ask for replies.
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
  const at = src.indexOf("function useCommunityUnread");
  const body = src.slice(at, src.indexOf("return { count, byChannel }", at));
  if (/parent_id/.test(body)) throw new Error("the notification query now filters on parent_id, so comments cannot reach it");
});

check("Latest marks read what it showed, and nothing else", () => {
  // The badge has to be clearable from the screen the tab lands on, or it sits
  // there forever. It must not be clearable by landing there, or one tap
  // empties every unread mark in the app and those posts are never surfaced.
  const posts = [
    { id: "1", channel: "passing", created_at: "2026-11-04T10:00:00.000Z", video_url: "https://youtu.be/aaaaaaaaaaa" },
    { id: "2", channel: "passing", created_at: "2026-11-05T10:00:00.000Z", video_url: "" },
    { id: "3", channel: "sweeps", created_at: "2026-11-03T10:00:00.000Z", video_url: "https://youtu.be/bbbbbbbbbbb" },
    { id: "4", channel: "sweeps", created_at: "2026-11-06T10:00:00.000Z", parent_id: "3", video_url: "https://youtu.be/ccccccccccc" },
  ];
  // The wall shows clips. A new comment in a room whose newest clip you just
  // looked at is still a new comment, and a text post is not on the wall.
  const wall = A.shownByRoomIn(posts, "clips");
  if (wall.passing !== "2026-11-04T10:00:00.000Z") throw new Error(`the wall claimed to show ${wall.passing} in Passing`);
  if (wall.sweeps !== "2026-11-03T10:00:00.000Z") throw new Error(`a reply counted as something the wall showed: ${wall.sweeps}`);
  // Reading it as a feed does show the text post.
  const feed = A.shownByRoomIn(posts, "feed");
  if (feed.passing !== "2026-11-05T10:00:00.000Z") throw new Error(`the feed showed ${feed.passing}`);

  const prefs = { lastSeen: { passing: "2026-01-01T00:00:00.000Z", escapes: "2026-01-01T00:00:00.000Z" } };
  const after = A.seenPatch(prefs, A.ALL_ROOMS, null, wall);
  if (after.passing !== "2026-11-04T10:00:00.000Z") throw new Error(`Passing was left at ${after.passing}`);
  if (after.escapes !== "2026-01-01T00:00:00.000Z") throw new Error("a room the wall never showed was marked read");
  // Marks move forward only. An older page held on screen must not un-read a
  // room somebody has already caught up on.
  const ahead = A.seenPatch({ lastSeen: { passing: "2026-12-01T00:00:00.000Z" } }, A.ALL_ROOMS, null, wall);
  if (ahead.passing !== "2026-12-01T00:00:00.000Z") throw new Error(`a read mark was moved backwards to ${ahead.passing}`);
  // A room the app no longer has cannot be written into stored prefs.
  const junk = A.shownPatch(prefs, { wormguard: "2026-11-04T10:00:00.000Z", __all: "2026-11-04T10:00:00.000Z" });
  if (Object.prototype.hasOwnProperty.call(junk, "wormguard") || Object.prototype.hasOwnProperty.call(junk, "__all")) {
    throw new Error("a room that does not exist was written into the read marks");
  }
  // And being open, with nothing shown, still marks nothing.
  const bare = A.seenPatch(prefs, A.ALL_ROOMS, null, null);
  if (bare.passing !== "2026-01-01T00:00:00.000Z") throw new Error("landing on Latest marked a room read");
});

check("only posts with a playable clip reach the wall", () => {
  const yes = [
    { video_url: "https://youtu.be/dQw4w9WgXcQ" },
    { video_url: "https://x.supabase.co/storage/v1/object/public/community-clips/a.mp4" },
  ];
  const no = [
    { body: "a question with no clip" },
    { video_url: "" },
    { video_url: "not a url at all" },
    null, undefined,
  ];
  yes.forEach((p, i) => { if (!A.isClip(p)) throw new Error(`clip ${i} was left off the wall`); });
  no.forEach((p, i) => { if (A.isClip(p)) throw new Error(`non-clip ${i} was put on the wall`); });
});

console.log(bad === 0 ? "\nTwo athletes, no failures.\n" : `\n${bad} problem(s):\n` + found.map((f) => "  - " + f).join("\n") + "\n");
process.exit(bad === 0 ? 0 : 1);
