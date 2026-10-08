import { RULESETS, RULESET_IDS, COMPARE_ROWS } from "./rulesets.js";
import { buildQuestionBank, pickQuestions, rankFor } from "./engine.js";
const bank = buildQuestionBank();
let fails = 0; const fail = (m) => { fails++; console.log("  FAIL " + m); };

// 1. Structural integrity
bank.forEach(q => {
  if (!q.options.includes(q.answer)) fail(`${q.id}: answer not among options`);
  if (new Set(q.options).size !== q.options.length) fail(`${q.id}: duplicate options`);
  if (!q.cite) fail(`${q.id}: no citation`);
  if (!q.why || q.why.length < 10) fail(`${q.id}: no explanation`);
  if (q.options.length < 2) fail(`${q.id}: fewer than 2 options`);
});
console.log(`structure: ${bank.length} questions checked`);

// 2. Independently re-derive every position answer straight from the ruleset data
let checked = 0;
RULESET_IDS.forEach(id => {
  const rs = RULESETS[id];
  Object.entries(rs.scoring).forEach(([key, s]) => {
    const q = bank.find(x => x.id === `${id}:pos:${key}`);
    if (!q) return;
    const expect = s.points == null ? "No points" : `${s.points} point${s.points === 1 ? "" : "s"}`;
    if (q.answer !== expect) fail(`${q.id}: says "${q.answer}", rulebook says "${expect}"`);
    checked++;
  });
});
console.log(`scoring answers re-derived from the rulebook: ${checked}`);

// 3. Sequence maths
bank.filter(q => q.topic === "sequence").forEach(q => {
  const m = q.why.match(/^(\d+) points? — (.+?)\./);
  if (!m) return;
  const stated = Number(m[1]);
  const parts = [...m[2].matchAll(/(\d+)(?:\s|$)/g)].map(x => Number(x[1]));
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== stated) fail(`${q.id}: explanation adds to ${sum} but states ${stated}`);
});
console.log("sequence arithmetic: explanations add up");

// 4. The comparison claims must match the data
bank.filter(q => q.ruleset === "compare").forEach(q => {
  const row = COMPARE_ROWS.find(r => r.key === q.topic);
  const vals = RULESET_IDS.map(id => ({ n: RULESETS[id].name, p: (RULESETS[id].scoring[row.key] || {}).points }));
  const top = vals.reduce((a, b) => ((b.p || 0) > (a.p || 0) ? b : a));
  if (q.answer !== top.n) fail(`${q.id}: claims ${q.answer} is highest, data says ${top.n}`);
});
console.log("comparison questions: match the scoring data");

// 5. No ruleset's values leaked into another
if (RULESETS.adcc.scoring.mount.points === RULESETS.ibjjf.scoring.mount.points) fail("ADCC and IBJJF mount are identical — expected 2 vs 4");
if (RULESETS.gi.advantages.used || RULESETS.adcc.advantages.used) fail("GI/ADCC should have no advantages");
if (!RULESETS.revolution.scoring.sideControl) fail("Revolution should score side control");
if (RULESETS.ibjjf.scoring.sideControl) fail("IBJJF should NOT score side control");
console.log("ruleset isolation: no cross-contamination");

// 6. Ranks and selection
const ranks = [0, 299, 300, 1599, 4500, 99999].map(x => rankFor(x).name);
if (ranks[0] !== "Beginner" || ranks[2] !== "Novice" || ranks[4] !== "Referee-Level") fail("rank thresholds wrong: " + ranks.join(","));
RULESET_IDS.concat("all").forEach(id => {
  const qs = pickQuestions(bank, { ruleset: id, count: 10, seed: 1 });
  if (qs.length < 5) fail(`pickQuestions("${id}") only returned ${qs.length}`);
  if (new Set(qs.map(q => q.id)).size !== qs.length) fail(`pickQuestions("${id}") repeated a question`);
});
const weak = pickQuestions(bank, { ruleset: "all", count: 20, weakTopics: ["penalties"], seed: 5 });
console.log(`ranks + selection: ok (weak-area round drew ${weak.filter(q=>q.topic==="penalties").length} penalty questions of 20)`);

console.log(fails ? `\n*** ${fails} FAILURES ***` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
