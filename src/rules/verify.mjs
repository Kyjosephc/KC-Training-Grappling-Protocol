import { RULESETS, RULESET_IDS, COMPARE_ROWS } from "./rulesets.js";
import { REQUIREMENTS, SCENES } from "./requirements.js";
import { buildQuestionBank, pickQuestions, rankFor, SEQUENCES } from "./engine.js";
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

// 1b. A sequence may only use positions that every ruleset scores.
// sequenceWalkthrough gives a position a ruleset does not list zero points and
// the line "does not score this position at all". For a shared sequence that
// is a lie told confidently: ADCC alone has a clean takedown, so a sequence
// built on one would teach that IBJJF awards nothing for a takedown landing
// past the guard. The seven shared positions are the whole safe vocabulary.
SEQUENCES.forEach((seq, i) => {
  if (!seq.story || seq.story.length < 40) fail(`sequence ${i}: no story worth reading`);
  if (!Array.isArray(seq.steps) || seq.steps.length < 2) fail(`sequence ${i}: fewer than two steps`);
  (seq.steps || []).forEach((k) => {
    RULESET_IDS.forEach((id) => {
      const sc = RULESETS[id].scoring[k];
      if (!sc || sc.points == null) fail(`sequence ${i} uses "${k}", which ${RULESETS[id].name} does not score`);
    });
  });
});
console.log(`sequences: ${SEQUENCES.length} checked against all ${RULESET_IDS.length} rulesets`);

// 2. The question must not contain its own answer.
// This is the check that would have caught "Knees above the shoulder line does
// not count. What do you get?" — a question whose prompt was the answer.
const VERDICT_WORDS = /\b(no points|does not count|is not a|advantage only|scores nothing|worth nothing|is nothing|not back mount|no advantages)\b/i;
bank.forEach(q => {
  const p = q.prompt.toLowerCase();
  // An option that is a whole phrase should never appear verbatim in the prompt.
  if (q.answer.length > 8 && p.includes(q.answer.toLowerCase())) {
    fail(`${q.id}: the prompt contains its own answer ("${q.answer}")`);
  }
  // Near-miss scenarios must describe the situation, never rule on it.
  if (q.id.includes(":nm:")) {
    const scene = q.prompt.replace(/^[^.]+\.\s*/, "").replace(/What does the referee award\?$/, "");
    const m = scene.match(VERDICT_WORDS);
    if (m) fail(`${q.id}: the scenario gives away the verdict ("${m[0]}")`);
  }
});
console.log("no question leaks its own answer");

// 3. Every question that describes a situation actually describes one.
// The whole point of the rewrite: an athlete should be able to picture it.
const SCENARIO = [":pos:", ":nm:", ":seq:"];
bank.filter(q => SCENARIO.some(k => q.id.includes(k))).forEach(q => {
  if (q.prompt.length < 90) fail(`${q.id}: prompt is too thin to learn from (${q.prompt.length} chars): "${q.prompt}"`);
});
console.log("scenario questions describe a full situation");

// 4. Every scoring position has a scene, and every scene maps to a real position
RULESET_IDS.forEach(id => {
  const scoring = Object.keys(RULESETS[id].scoring);
  const scenes = Object.keys(SCENES[id] || {});
  scoring.filter(k => !scenes.includes(k)).forEach(k => fail(`${id}: scoring key "${k}" has no scene`));
  scenes.filter(k => !scoring.includes(k)).forEach(k => fail(`${id}: scene "${k}" is not a scoring position`));
});
console.log("scenes and scoring keys line up");

// 5. Independently re-derive every position answer straight from the ruleset data
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

// 6. Sequence maths
bank.filter(q => q.topic === "sequence").forEach(q => {
  const m = q.why.match(/^(\d+) points? — (.+?)\./);
  if (!m) return;
  const stated = Number(m[1]);
  const parts = [...m[2].matchAll(/(\d+)(?:\s|$)/g)].map(x => Number(x[1]));
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== stated) fail(`${q.id}: explanation adds to ${sum} but states ${stated}`);
});
console.log("sequence arithmetic: explanations add up");

// 7. Comparison claims must match the data AND be unambiguous.
// A three-way tie at 4 points has no single right answer, so the question must
// not exist at all — the old version marked Grappling Industries wrong for
// saying 4 when Grappling Industries does award 4.
bank.filter(q => q.ruleset === "compare").forEach(q => {
  const row = COMPARE_ROWS.find(r => r.key === q.topic);
  if (!row) { fail(`${q.id}: no COMPARE_ROWS entry for "${q.topic}"`); return; }
  const vals = RULESET_IDS.map(id => {
    const s = RULESETS[id].scoring[row.key];
    return { n: RULESETS[id].name, p: s && s.points != null ? s.points : 0 };
  });
  const wantMost = /MOST/.test(q.prompt);
  const target = wantMost ? Math.max(...vals.map(v => v.p)) : Math.min(...vals.map(v => v.p));
  const holders = vals.filter(v => v.p === target);
  if (holders.length !== 1) fail(`${q.id}: ${holders.length}-way tie at ${target} — this question has no single right answer`);
  else if (q.answer !== holders[0].n) fail(`${q.id}: answers ${q.answer}, data says ${holders[0].n}`);
});
console.log(`comparison questions: ${bank.filter(q => q.ruleset === "compare").length} checked, each has one right answer`);

// 8. A ruleset must never be asked a question whose answer contradicts itself.
// ADCC has no advantages, so no ADCC question may answer "an advantage".
RULESET_IDS.filter(id => !RULESETS[id].advantages.used).forEach(id => {
  // Only flags an answer that AWARDS an advantage. An answer that says this
  // ruleset has none ("a referee decision — there are no advantages to count")
  // is the correct answer, not a contradiction.
  const awardsOne = (t) => /advantage/i.test(t) && !/\bno advantages?\b|\bnot an advantage\b/i.test(t);
  bank.filter(q => q.ruleset === id && awardsOne(q.answer)).forEach(q => {
    fail(`${q.id}: answers "${q.answer}" but ${RULESETS[id].name} has no advantages`);
  });
});
console.log("no ruleset is credited with scoring it does not have");

// 9. Distractors must be wrong. A duration distractor that is a substring of
// the answer ("6 min" against "6 min — first 3 scoreless") is arguably right.
bank.filter(q => q.topic === "duration").forEach(q => {
  q.options.filter(o => o !== q.answer).forEach(o => {
    if (q.answer.includes(o) || o.includes(q.answer)) fail(`${q.id}: distractor "${o}" overlaps the answer "${q.answer}"`);
  });
});
console.log("duration distractors are genuinely wrong");

// 10. Special-case questions must not reuse one fixed set of distractors, or
// the athlete passes by recognising the wrong answers instead of knowing the right one.
RULESET_IDS.forEach(id => {
  const qs = bank.filter(q => q.id.startsWith(`${id}:sp:`));
  if (qs.length < 3) return;
  const sets = qs.map(q => q.options.filter(o => o !== q.answer).sort().join("|"));
  if (new Set(sets).size === 1) fail(`${id}: all ${qs.length} special questions share the same three distractors`);
});
console.log("special-case distractors vary between questions");

// 10b. Every wrong option an athlete can pick has to say something back. The
// special-case, requirement, near-miss, penalty, tiebreak and duration
// questions all shipped with an empty or partial `wrong` map, which meant the
// hardest questions in the bank answered a miss with silence — the one moment
// an athlete is actually listening.
bank.forEach(q => {
  const distractors = q.options.filter(o => o !== q.answer);
  const silent = distractors.filter(o => !(q.wrong && q.wrong[o]));
  if (silent.length) fail(`${q.id}: ${silent.length} of ${distractors.length} wrong options have no explanation`);
  if (q.wrong && q.wrong[q.answer]) fail(`${q.id}: carries a "why that is wrong" note on its own correct answer`);
});
console.log("every wrong option explains itself");

// 10c. And the explanation has to add something. `why: sp.v` made the special
// questions repeat the option the athlete had just picked, teaching nothing.
bank.forEach(q => {
  if (q.why.trim() === q.answer.trim()) fail(`${q.id}: the explanation is just the answer again`);
});
console.log("no explanation is a copy of its own answer");

// 11. No ruleset's values leaked into another
if (RULESETS.adcc.scoring.mount.points === RULESETS.ibjjf.scoring.mount.points) fail("ADCC and IBJJF mount are identical — expected 2 vs 4");
if (RULESETS.gi.advantages.used || RULESETS.adcc.advantages.used) fail("GI/ADCC should have no advantages");
if (!RULESETS.revolution.scoring.sideControl) fail("Revolution should score side control");
if (RULESETS.ibjjf.scoring.sideControl) fail("IBJJF should NOT score side control");
console.log("ruleset isolation: no cross-contamination");

// 12. Near-miss data shape
RULESET_IDS.forEach(id => {
  Object.entries(REQUIREMENTS[id] || {}).forEach(([pos, r]) => {
    (r.notPoints || []).forEach((nm, i) => {
      if (typeof nm === "string") fail(`${id}.${pos}.notPoints[${i}] is still a bare string`);
      else {
        if (!nm.scene || nm.scene.length < 40) fail(`${id}.${pos}.notPoints[${i}]: scene too short`);
        if (!["advantage", "nothing"].includes(nm.verdict)) fail(`${id}.${pos}.notPoints[${i}]: bad verdict "${nm.verdict}"`);
        if (!nm.why || nm.why.length < 30) fail(`${id}.${pos}.notPoints[${i}]: no explanation`);
        if (nm.verdict === "advantage" && !RULESETS[id].advantages.used) {
          fail(`${id}.${pos}.notPoints[${i}]: verdict "advantage" but ${RULESETS[id].name} has none`);
        }
      }
    });
  });
});
console.log("near-miss scenarios are well formed");

// 12b. What a position is worth, and what the prose beside it says, have to
// agree. The Revolution's side control was listed at 4 points while the rules
// score a different position of a similar name, and the requirement text went
// on to teach it — scoring table and prose drifting apart is how a quiz ends
// up confidently wrong, and it is checkable.
RULESET_IDS.forEach(id => {
  Object.entries(REQUIREMENTS[id] || {}).forEach(([pos, r]) => {
    const entry = RULESETS[id].scoring[pos];
    const scores = !!(entry && entry.points != null && entry.points > 0);
    const must = (r.must || []).join(" ");
    const saysNoScore = /not a scoring position|no points|nothing/i.test(must);
    if (!scores && !saysNoScore) {
      fail(`${id}.${pos}: worth no points, but its requirements do not say so — they read "${must.slice(0, 70)}"`);
    }
    if (scores && saysNoScore) {
      fail(`${id}.${pos}: worth ${entry.points} points, but its requirements say it does not score`);
    }
    // A position that scores nothing cannot be nearly achieved for an
    // advantage either — there is no points position to fall short of.
    if (!scores && (r.notPoints || []).some(nm => nm && nm.verdict === "advantage")) {
      fail(`${id}.${pos}: worth no points, yet falling short of it is said to earn an advantage`);
    }
  });
});
console.log("every position's prose agrees with what it is worth");

// 13. Ranks and selection
const ranks = [0, 299, 300, 1599, 4500, 99999].map(x => rankFor(x).name);
if (ranks[0] !== "Beginner" || ranks[2] !== "Novice" || ranks[4] !== "Referee-Level") fail("rank thresholds wrong: " + ranks.join(","));
RULESET_IDS.concat("all").forEach(id => {
  const qs = pickQuestions(bank, { ruleset: id, count: 10, seed: 1 });
  if (qs.length < 5) fail(`pickQuestions("${id}") only returned ${qs.length}`);
  if (new Set(qs.map(q => q.id)).size !== qs.length) fail(`pickQuestions("${id}") repeated a question`);
});
// The bank must be identical on every device, or a saved weak topic is meaningless.
const a = buildQuestionBank().map(q => q.id + "|" + q.options.join(",")).join("\n");
const b = buildQuestionBank().map(q => q.id + "|" + q.options.join(",")).join("\n");
if (a !== b) fail("buildQuestionBank() is not deterministic between calls");
const weak = pickQuestions(bank, { ruleset: "all", count: 20, weakTopics: ["penalties"], seed: 5 });
console.log(`ranks + selection: ok, bank is deterministic (weak-area round drew ${weak.filter(q=>q.topic==="penalties").length} penalty questions of 20)`);

// 14. Rules published but not yet in force.
// A ruleset may carry an `upcoming` block: changes the organisation has
// announced with a date in the future. Two things have to hold. It has to be
// as well sourced as everything else — an athlete reading it is going to act
// on it. And it must never reach the question bank, because until the date
// arrives the answer to "what is the rule" is the rule above it, and a
// tournament in the meantime is refereed under the old one.
const upcomingSets = RULESET_IDS.filter((id) => RULESETS[id].upcoming);
upcomingSets.forEach((id) => {
  const u = RULESETS[id].upcoming;
  if (!u.effective) fail(`${id}: upcoming rules with no date they start`);
  if (!u.source) fail(`${id}: upcoming rules with no source`);
  if (!u.checked) fail(`${id}: upcoming rules nobody recorded checking`);
  if (!u.note || u.note.length < 40) fail(`${id}: upcoming rules do not say what applies until then`);
  if (!Array.isArray(u.changes) || !u.changes.length) fail(`${id}: an upcoming block with no changes in it`);
  (u.changes || []).forEach((ch, i) => {
    if (!ch.k) fail(`${id} upcoming ${i}: no name`);
    if (!ch.v || ch.v.length < 20) fail(`${id} upcoming ${i} (${ch.k}): nothing an athlete could act on`);
    if (!ch.cite) fail(`${id} upcoming ${i} (${ch.k}): no citation`);
  });
  // Not one question, and not one wrong answer either. A distractor built from
  // a rule that is not in force yet is the same mistake wearing a disguise.
  const texts = (u.changes || []).map((ch) => ch.v);
  bank.forEach((q) => {
    const hay = [q.prompt, q.why, ...(q.options || [])].join(" ");
    texts.forEach((t) => {
      const chunk = t.slice(0, 60);
      if (chunk.length > 30 && hay.includes(chunk)) {
        fail(`${q.id} is built from a rule that does not start until ${u.effective}`);
      }
    });
  });
});
// Said in the data, held here: the generator does not read this block at all.
const engineSrc = await (await import("node:fs/promises")).readFile(new URL("./engine.js", import.meta.url), "utf8");
if (/\bupcoming\b/.test(engineSrc)) fail("the question generator reads the not-yet-in-force rules");
// And once the date has passed the label is a lie. This is the reminder.
upcomingSets.forEach((id) => {
  const u = RULESETS[id].upcoming;
  const starts = new Date(u.effective.replace(/^(\d+) /, "$1 "));
  if (!Number.isNaN(starts.getTime()) && Date.now() >= starts.getTime()) {
    fail(`${RULESETS[id].name}'s "${u.effective}" rules are now in force. Fold each one into the rules above it, `
      + `update version/effective/checked/cite, then delete the upcoming block — until that is done the app is `
      + `showing them as upcoming and still teaching the old answers.`);
  }
});
console.log(`rules not yet in force: ${upcomingSets.length} ruleset(s), ${upcomingSets.reduce((n, id) => n + RULESETS[id].upcoming.changes.length, 0)} change(s), none of them in the question bank`);

console.log(fails ? `\n*** ${fails} FAILURES ***` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
