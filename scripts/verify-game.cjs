// =============================================================================
// THE RULES GAME, RENDERED AND PLAYED
// =============================================================================
// verify.mjs proves the data and the questions are right. This proves an
// athlete can actually get to them: every screen renders, the Learn view
// survives the shape of the requirements data, and a full round scores, builds
// a streak, awards xp and records which topics were weak.
//
// Run through scripts/verify-rules.sh, which does the bundling first.
// =============================================================================
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><div id=root></div>", { pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
global.navigator = dom.window.navigator; global.IS_REACT_ACT_ENVIRONMENT = true;

const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react");
const RG = require("../.rg.cjs");
const Game = RG.default || RG.RulesGame;
const { buildQuestionBank, rankFor } = require("../.eng.cjs");
const bank = buildQuestionBank();

let bad = 0;
const check = (name, fn) => { try { fn(); console.log("  ok   " + name); } catch (e) { bad++; console.log("  FAIL " + name + " — " + e.message); } };

const host = document.getElementById("root");
const root = createRoot(host);
let prog = RG.emptyRulesProgress();
// App.jsx feeds new progress straight back in through React state
// (persistClient -> re-render), so the harness does the same. Without it every
// answer would be computed from the same stale object.
const render = () => act(() => root.render(React.createElement(Game, {
  progress: prog, onProgress(p) { prog = p; render(); },
})));
render();

const txt = () => host.textContent;
const buttons = () => [...host.querySelectorAll("button")];
const byText = (re) => buttons().find((b) => re.test(b.textContent));
const hit = (el) => act(() => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
const click = (re) => {
  const b = byText(re);
  if (!b) throw new Error(`no button matching ${re} — saw: ${buttons().map((x) => x.textContent.trim().slice(0, 24)).join(" | ")}`);
  hit(b);
};

check("home screen offers every mode", () => {
  const t = txt();
  ["Five-minute drill", "Basics", "Hard round", "Side by side", "The rules themselves", "Your stats"]
    .forEach((m) => { if (!t.includes(m)) throw new Error(`"${m}" missing from home`); });
});

check("Learn view renders the requirements data", () => {
  click(/The rules themselves/);
  const t = txt();
  if (/\[object Object\]/.test(t)) throw new Error("an object leaked into the markup");
  if (!/What actually counts/.test(t)) throw new Error("requirements card missing");
  if (!/Advantage only|Scores nothing/.test(t)) throw new Error("near-miss verdict badges not rendered");
  if (!/double leg|closed guard/i.test(t)) throw new Error("position scenes not shown in the scoring card");
  click(/Back/);
});

check("Compare view renders all four rule sets", () => {
  click(/Side by side/);
  const t = txt();
  if (/\[object Object\]/.test(t)) throw new Error("an object leaked into the markup");
  ["IBJJF", "ADCC", "Grappling Industries", "The Revolution"]
    .forEach((n) => { if (!t.includes(n)) throw new Error(`${n} missing from the comparison`); });
  click(/Back/);
});

check("stats view renders on a fresh profile", () => {
  click(/Your stats/);
  if (/\[object Object\]/.test(txt())) throw new Error("an object leaked into the markup");
  click(/Back/);
});

check("a full round scores, streaks, awards xp and records topics", () => {
  click(/Five-minute drill/);
  let asked = 0;
  for (let i = 0; i < 30; i++) {
    // The result screen reuses the option styling for its review list, so stop
    // on the result screen itself rather than on "no options left".
    if (!byText(/Next question/) && /Round complete|You got|See how you did/i.test(txt())) break;
    const opts = buttons().filter((b) => /rg-opt/.test(b.className) && !b.disabled);
    if (!opts.length) break;
    // Work out which question is on screen, then deliberately pick its right
    // answer — this also proves every rendered option set contains the answer.
    const q = bank.find((x) => txt().includes(x.prompt));
    if (!q) throw new Error("the on-screen question is not in the bank");
    const correct = opts.find((b) => b.textContent.trim() === q.answer);
    if (!correct) throw new Error(`${q.id}: its answer "${q.answer}" is not among the rendered options`);
    hit(correct); asked++;
    const next = byText(/Next question|See how you did|Finish|Next/);
    if (next) hit(next);
  }
  if (asked < 5) throw new Error(`only answered ${asked} questions`);
  if (prog.answered !== asked) throw new Error(`answered ${asked} but progress says ${prog.answered}`);
  if (prog.correct !== asked) throw new Error(`all correct but progress says ${prog.correct}`);
  if (prog.xp <= 0) throw new Error("no xp awarded for a perfect round");
  if (prog.bestStreak < 3) throw new Error(`streak did not build (best ${prog.bestStreak})`);
  if (!Object.keys(prog.topics).length) throw new Error("no weak-topic data recorded");
  if (/\[object Object\]/.test(txt())) throw new Error("an object leaked into the result screen");
  console.log(`       ${asked} correct · xp ${prog.xp} · best streak ${prog.bestStreak} · rank ${rankFor(prog.xp).name} · ${Object.keys(prog.topics).length} topics tracked`);
});


// ---------------------------------------------------------------------------
// Getting one wrong has to lead somewhere. These cover the three things that
// turn the quiz into something that teaches: you see what you missed, it comes
// back, and the referee round exists.
// ---------------------------------------------------------------------------

// Walk back to the home screen from wherever the last check left off, rather
// than assuming it ended somewhere tidy.
const goHome = () => {
  for (let n = 0; n < 40; n++) {
    if (/Five-minute drill/.test(txt())) return;
    const b = byText(/^Quit$/) || byText(/^Back$/) || byText(/Next question|See how you did|Next exchange|See the card|Finish|Next/);
    if (!b) break;
    hit(b);
  }
  if (!/Five-minute drill/.test(txt())) {
    throw new Error(`could not get back to home — saw: ${[...host.querySelectorAll("button")].map((x) => x.textContent.trim().slice(0, 22)).join(" | ")}`);
  }
};

check("a wrong answer is shown back to you at the end of the round", () => {
  goHome();
  prog = RG.emptyRulesProgress(); render();
  click(/Five-minute drill/);
  let missedPrompt = null;
  for (let n = 0; n < 30; n++) {
    const opts = [...host.querySelectorAll("button.rg-option")];
    if (!opts.length) break;
    const q = bank.find((x) => txt().includes(x.prompt));
    if (!q) throw new Error("the on-screen question is not in the bank");
    // Answer everything wrong on purpose.
    const wrongBtn = opts.find((b) => b.textContent.trim() !== q.answer);
    if (!missedPrompt) missedPrompt = q.prompt;
    hit(wrongBtn || opts[0]);
    const next = byText(/Next question|See how you did|Finish|Next/);
    if (next) hit(next);
  }
  const t = txt();
  if (!/What you missed/.test(t)) throw new Error("the result screen does not show what was missed");
  if (missedPrompt && !t.includes(missedPrompt)) throw new Error("the missed question itself is not listed");
  if (!/You said/.test(t)) throw new Error("the answer they gave is not shown back");
  if (!/Read the rule/.test(t)) throw new Error("no way to jump to the rule from a miss");
});

check("missed questions are remembered", () => {
  if (!Object.keys(prog.missed || {}).length) throw new Error("nothing recorded as missed");
});

check("and they come back in the next round", () => {
  const owed = Object.keys(prog.missed);
  goHome();
  const t = txt();
  if (!/Put it right/.test(t)) throw new Error("no review mode offered when questions are owed");
  click(/Put it right/);
  const seen = [];
  for (let n = 0; n < 30; n++) {
    const opts = [...host.querySelectorAll("button.rg-option")];
    if (!opts.length) break;
    const q = bank.find((x) => txt().includes(x.prompt));
    if (q) seen.push(q.id);
    const correct = opts.find((b) => q && b.textContent.trim() === q.answer) || opts[0];
    hit(correct);
    const next = byText(/Next question|See how you did|Finish|Next/);
    if (next) hit(next);
  }
  const returned = seen.filter((id) => owed.includes(id));
  if (!returned.length) throw new Error(`none of the ${owed.length} missed questions came back`);
  console.log(`       ${returned.length} of ${seen.length} questions in the review round were ones previously missed`);
});

check("getting a review question right clears it", () => {
  const before = Object.keys(prog.missed || {}).length;
  if (before === 0) return; // already clean
  goHome();
  click(/Put it right/);
  for (let n = 0; n < 30; n++) {
    const opts = [...host.querySelectorAll("button.rg-option")];
    if (!opts.length) break;
    const q = bank.find((x) => txt().includes(x.prompt));
    const correct = opts.find((b) => q && b.textContent.trim() === q.answer) || opts[0];
    hit(correct);
    const next = byText(/Next question|See how you did|Finish|Next/);
    if (next) hit(next);
  }
  const after = Object.keys(prog.missed || {}).length;
  if (after >= before) throw new Error(`still owed ${after} after a clean review round (was ${before})`);
});

check("a day streak is counted", () => {
  if (!prog.dayStreak || prog.dayStreak < 1) throw new Error("no day streak recorded after playing");
  if (prog.lastSeen !== new Date().toISOString().slice(0, 10)) throw new Error("lastSeen not set to today");
});

check("the referee round plays and scores a card", () => {
  goHome();
  click(/You are the referee/);
  if (!/Exchange 1 of/.test(txt())) throw new Error("referee round did not start");
  if (!/your card/i.test(txt())) throw new Error("no running scorecard shown");
  let exchanges = 0;
  for (let n = 0; n < 20; n++) {
    const opts = [...host.querySelectorAll("button.rg-option")];
    if (!opts.length) break;
    hit(opts[0]);
    exchanges++;
    if (!/It is \d|Correct\./.test(txt())) throw new Error("no ruling shown after a call");
    const next = byText(/Next exchange|See the card/);
    if (!next) throw new Error("no way forward after a call");
    hit(next);
  }
  if (exchanges < 5) throw new Error(`only ${exchanges} exchanges played`);
  const t = txt();
  if (!/calls correct/.test(t)) throw new Error("no result shown for the referee round");
  if (!/Your card/.test(t) || !/The real score/.test(t)) throw new Error("the card is not compared against the real score");
  if (!/Every exchange/.test(t)) throw new Error("no exchange-by-exchange breakdown");
  if (/\[object Object\]/.test(t)) throw new Error("an object leaked into the referee result");
  console.log(`       ${exchanges} exchanges called, card compared against the real score`);
});

console.log(bad ? `\n*** ${bad} FAILURES ***` : "\nALL CHECKS PASSED");
process.exit(bad ? 1 : 0);
