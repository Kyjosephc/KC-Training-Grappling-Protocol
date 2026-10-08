// =============================================================================
// QUESTION ENGINE
// =============================================================================
// Every question is generated from rulesets.js. Nothing is written by hand, so
// a rule change in that file changes the questions, the answers and the
// explanations together — they cannot drift apart.
//
// A question is: { id, ruleset, topic, difficulty, prompt, options[], answer,
// why, wrong{}, cite }
// =============================================================================

import { RULESETS, RULESET_IDS, COMPARE_ROWS } from "./rulesets.js";
import { REQUIREMENTS, HOLD_SECONDS } from "./requirements.js";

const POS_LABEL = {
  takedown: "a takedown", cleanTakedown: "a clean takedown past the guard",
  guardPass: "a guard pass", kneeOnBelly: "knee on belly", mount: "mount",
  backMount: "back mount", backControl: "back control", sideControl: "side control",
  sweep: "a sweep", cleanSweep: "a clean sweep past the guard",
  submissionAttempt: "a submission attempt stopped out of bounds",
};

// Plausible wrong answers: the other values that exist somewhere in this sport,
// so a guess is never narrowed down by elimination.
const POINT_CHOICES = [0, 2, 3, 4];

function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function mulberry(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const label = (n) => (n === 0 ? "No points" : `${n} point${n === 1 ? "" : "s"}`);

// --- 1. What is this position worth under this ruleset? ----------------------
function positionQuestions(rsId) {
  const rs = RULESETS[rsId];
  const out = [];
  Object.entries(rs.scoring).forEach(([key, s]) => {
    if (!s) return;
    const worth = s.points == null ? 0 : s.points;
    const wrong = {};
    POINT_CHOICES.filter((n) => n !== worth).forEach((n) => {
      wrong[label(n)] = n === 0
        ? `${POS_LABEL[key] || key} does score under ${rs.name}.`
        : `${n} is not what ${rs.name} awards for ${POS_LABEL[key] || key}.`;
    });
    out.push({
      id: `${rsId}:pos:${key}`,
      ruleset: rsId, topic: key, difficulty: 1,
      prompt: `Under ${rs.name} rules, how many points is ${POS_LABEL[key] || key} worth?`,
      options: POINT_CHOICES.map(label),
      answer: label(worth),
      why: s.points == null
        ? `${rs.name} awards no points for that. ${s.control}`
        : `${label(worth)}. ${s.control}`,
      wrong, cite: `${rs.name} ${rs.version} — ${s.cite}`,
    });
  });
  return out;
}

// --- 2. Sequences: cumulative scoring through a match ------------------------
const SEQUENCES = [
  { steps: ["takedown", "guardPass"], story: "You take your opponent down into their guard, hold it, then pass to side control and hold that." },
  { steps: ["takedown", "guardPass", "mount"], story: "You take them down, pass the guard, and climb straight to mount in one continuous sequence." },
  { steps: ["sweep", "guardPass"], story: "From guard you sweep them, settle on top, then pass their guard." },
  { steps: ["sweep", "guardPass", "mount", "backControl"], story: "You sweep, pass, mount, they turn away and you take the back with both hooks — all without losing control." },
  { steps: ["guardPass", "kneeOnBelly"], story: "You pass the guard and step straight into knee on belly, holding each." },
  { steps: ["takedown", "guardPass", "kneeOnBelly", "mount"], story: "Takedown, pass, knee on belly, then mount — one unbroken sequence." },
  { steps: ["sweep", "mount"], story: "You sweep from guard and come straight up into mount." },
];

function sequenceQuestions(rsId) {
  const rs = RULESETS[rsId];
  return SEQUENCES.map((seq, i) => {
    const parts = seq.steps.map((k) => ({ k, s: rs.scoring[k] })).filter((p) => p.s && p.s.points != null);
    const total = parts.reduce((n, p) => n + p.s.points, 0);
    const sum = parts.map((p) => `${POS_LABEL[p.k]} ${p.s.points}`).join(" + ");
    const opts = new Set([total]);
    [total - 2, total + 2, total - 1, total + 3, total + 1].forEach((n) => { if (n > 0 && opts.size < 4) opts.add(n); });
    const options = [...opts].sort((a, b) => a - b).map(label);
    const wrong = {};
    options.filter((o) => o !== label(total)).forEach((o) => {
      wrong[o] = `Add the positions up under ${rs.name}: ${sum} = ${total}.`;
    });
    return {
      id: `${rsId}:seq:${i}`,
      ruleset: rsId, topic: "sequence", difficulty: 2,
      prompt: `${rs.name} rules. ${seq.story} What is on the board?`,
      options, answer: label(total),
      why: `${label(total)} — ${sum}. ${rs.name === "IBJJF" ? "Positions reached in one continuous sequence all score; the referee counts three seconds once, at the end of the sequence." : "Each position reached and controlled scores on its own."}`,
      wrong, cite: `${rs.name} ${rs.version} — ${rsId === "ibjjf" ? "Art. 3.4 (cumulative points)" : "Scoring"}`,
    };
  });
}

// --- 3. The special cases people actually lose matches over -------------------
function specialQuestions(rsId) {
  const rs = RULESETS[rsId];
  return rs.specials.map((sp, i) => ({
    id: `${rsId}:sp:${i}`,
    ruleset: rsId, topic: "special", difficulty: 3,
    prompt: `Under ${rs.name}: ${sp.k.toLowerCase()} — which is correct?`,
    options: shuffle([sp.v, ...wrongSpecials(rsId, sp.v)], mulberry(i + rsId.length)).slice(0, 4),
    answer: sp.v,
    why: sp.v,
    wrong: {}, cite: `${rs.name} ${rs.version} — ${sp.cite}`,
  }));
}
// Distractors are real statements from the OTHER rule sets, so the wrong answer
// is always something true somewhere — which is the actual trap in competition.
function wrongSpecials(rsId, correct) {
  const pool = [];
  RULESET_IDS.filter((id) => id !== rsId).forEach((id) => {
    RULESETS[id].specials.forEach((sp) => { if (sp.v !== correct) pool.push(sp.v); });
  });
  return pool.slice(0, 3);
}

// --- 4. Cross-ruleset: the anti-guessing questions ---------------------------
function comparisonQuestions() {
  const out = [];
  COMPARE_ROWS.forEach((row) => {
    const vals = RULESET_IDS.map((id) => {
      const s = RULESETS[id].scoring[row.key];
      return { id, name: RULESETS[id].name, pts: s && s.points != null ? s.points : null };
    });
    const distinct = new Set(vals.map((v) => String(v.pts)));
    if (distinct.size < 2) return;   // nothing to teach if they all agree
    const highest = vals.reduce((a, b) => ((b.pts || 0) > (a.pts || 0) ? b : a));
    const wrong = {};
    vals.filter((v) => v.name !== highest.name).forEach((v) => {
      wrong[v.name] = v.pts == null
        ? `${v.name} awards nothing for ${row.label.toLowerCase()}.`
        : `${v.name} awards ${v.pts}.`;
    });
    out.push({
      id: `cmp:${row.key}`,
      ruleset: "compare", topic: row.key, difficulty: 3,
      prompt: `Which of these awards the most points for ${row.label.toLowerCase()}?`,
      options: vals.map((v) => v.name),
      answer: highest.name,
      why: `${highest.name} awards ${highest.pts}. The others: ${vals.filter((v) => v.name !== highest.name).map((v) => `${v.name} ${v.pts == null ? "nothing" : v.pts}`).join(", ")}. This is why you cannot carry one ruleset's habits into another's tournament.`,
      wrong, cite: "Each organisation's own published scoring",
    });
  });
  return out;
}

// --- 5. Advantages, penalties, durations -------------------------------------
function systemQuestions(rsId) {
  const rs = RULESETS[rsId];
  const out = [];
  out.push({
    id: `${rsId}:adv`, ruleset: rsId, topic: "advantages", difficulty: 2,
    prompt: `Does ${rs.name} use advantage points?`,
    options: ["Yes", "No"],
    answer: rs.advantages.used ? "Yes" : "No",
    why: rs.advantages.rule,
    wrong: { [rs.advantages.used ? "No" : "Yes"]: rs.advantages.used
      ? `${rs.name} does use advantages — they decide matches that are level on points.`
      : `${rs.name} has no advantage scoring, so a near miss is worth nothing.` },
    cite: `${rs.name} ${rs.version} — ${rs.advantages.cite}`,
  });
  if (rs.penalties.ladder.length > 1) {
    out.push({
      id: `${rsId}:pen`, ruleset: rsId, topic: "penalties", difficulty: 3,
      prompt: `Under ${rs.name}, what happens on the second penalty?`,
      options: shuffle(["Nothing yet, it is only marked", "An advantage to the opponent", "2 points to the opponent", "Disqualification"], mulberry(7)),
      answer: rsId === "ibjjf" ? "An advantage to the opponent"
        : rsId === "gi" ? "2 points to the opponent" : "An advantage to the opponent",
      why: rs.penalties.ladder.join(" · "),
      wrong: {}, cite: `${rs.name} ${rs.version} — ${rs.penalties.cite}`,
    });
  }
  rs.durations.slice(0, 4).forEach((d, i) => {
    const others = RULESET_IDS.flatMap((id) => RULESETS[id].durations.map((x) => x.time))
      .filter((t) => t !== d.time);
    out.push({
      id: `${rsId}:dur:${i}`, ruleset: rsId, topic: "duration", difficulty: 2,
      prompt: `${rs.name} — how long is a match for ${d.division}?`,
      options: shuffle([d.time, ...[...new Set(others)].slice(0, 3)], mulberry(i + 3)),
      answer: d.time, why: `${d.division}: ${d.time}.`,
      wrong: {}, cite: `${rs.name} ${rs.version} — ${rs.durationCite}`,
    });
  });
  return out;
}

// --- 6. How long do you have to hold it? -------------------------------------
function holdQuestions(rsId) {
  const h = HOLD_SECONDS[rsId];
  const rs = RULESETS[rsId];
  if (!h) return [];
  const opts = ["1 second", "2 seconds", "3 seconds", "5 seconds"];
  const wrong = {};
  opts.filter((o) => o !== `${h.n} seconds`).forEach((o) => {
    wrong[o] = `${rs.name} requires ${h.n} seconds of control, not ${o}.`;
  });
  return [{
    id: `${rsId}:hold`, ruleset: rsId, topic: "control", difficulty: 1,
    prompt: `Under ${rs.name}, how long must you hold a position before the points are awarded?`,
    options: opts, answer: `${h.n} seconds`, why: h.rule, wrong, cite: h.cite,
  }];
}

// --- 7. What actually counts as the position --------------------------------
function requirementQuestions(rsId) {
  const reqs = REQUIREMENTS[rsId];
  const rs = RULESETS[rsId];
  if (!reqs) return [];
  const out = [];
  Object.entries(reqs).forEach(([pos, r]) => {
    // "Which of these is required?" — distractors are requirements from other
    // positions, which is exactly how people confuse them in a real match.
    // A distractor has to be FALSE for this position. The 3-second hold is true
    // for every position, so it can never be the wrong answer — and the target's
    // own requirements obviously cannot be either.
    const mine = new Set(r.must.map((x) => x.toLowerCase()));
    const generic = /\b3 second|three second|hold it/i;
    const others = Object.entries(reqs)
      .filter(([k]) => k !== pos)
      .flatMap(([, x]) => x.must)
      .filter((x) => !mine.has(x.toLowerCase()) && !generic.test(x));
    const specific = r.must.find((x) => !generic.test(x)) || r.must[0];
    if (r.must.length && others.length >= 3) {
      out.push({
        id: `${rsId}:req:${pos}`, ruleset: rsId, topic: pos, difficulty: 2,
        prompt: `${rs.name} — which of these is required for ${POS_LABEL[pos] || pos}?`,
        options: [specific, ...others.slice(0, 3)],
        answer: specific,
        why: `For ${POS_LABEL[pos] || pos} under ${rs.name}: ${r.must.join(" · ")}.`,
        wrong: {}, cite: `${rs.name} ${rs.version} — ${r.cite}`,
      });
    }
    // The near-misses. These are the questions that win and lose matches.
    r.notPoints.forEach((nm, i) => {
      const isAdv = /advantage only/i.test(nm);
      const isNone = /no points|not .*(count|mount)|does not count|is nothing/i.test(nm);
      if (!isAdv && !isNone) return;
      const answer = isAdv ? "An advantage" : "Nothing";
      const opts = rs.advantages.used
        ? ["Full points", "An advantage", "Nothing", "A penalty"]
        : ["Full points", "Nothing", "A penalty", "Half the points"];
      if (!opts.includes(answer)) return;
      out.push({
        id: `${rsId}:nm:${pos}:${i}`, ruleset: rsId, topic: pos, difficulty: 3,
        prompt: `${rs.name}. ${nm.split(" — ")[0]}. What do you get?`,
        options: opts, answer,
        why: nm,
        wrong: { "Full points": `That does not meet the requirement for ${POS_LABEL[pos] || pos}.` },
        cite: `${rs.name} ${rs.version} — ${r.cite}`,
      });
    });
  });
  return out;
}

// --- The bank ----------------------------------------------------------------
export function buildQuestionBank() {
  const all = [];
  RULESET_IDS.forEach((id) => {
    all.push(...positionQuestions(id), ...sequenceQuestions(id), ...specialQuestions(id),
             ...systemQuestions(id), ...holdQuestions(id), ...requirementQuestions(id));
  });
  all.push(...comparisonQuestions());
  return all;
}

export function pickQuestions(bank, { ruleset, count = 10, difficulty, minDifficulty, weakTopics = [], seed = Date.now() } = {}) {
  const rnd = mulberry(seed);
  let pool = bank.filter((q) => (!ruleset || ruleset === "all" || q.ruleset === ruleset || q.ruleset === "compare"));
  if (difficulty) pool = pool.filter((q) => q.difficulty <= difficulty);
  // A hard round is only hard if the easy questions are excluded, not merely
  // allowed alongside them.
  if (minDifficulty) {
    const hard = pool.filter((q) => q.difficulty >= minDifficulty);
    if (hard.length >= 5) pool = hard;
  }
  if (!pool.length) pool = bank;
  // Weak areas come up roughly twice as often, which is the whole point of
  // tracking them.
  const weighted = [];
  pool.forEach((q) => { weighted.push(q); if (weakTopics.includes(q.topic)) weighted.push(q); });
  const seen = new Set(); const out = [];
  while (out.length < Math.min(count, pool.length) && weighted.length) {
    const q = weighted[Math.floor(rnd() * weighted.length)];
    if (!seen.has(q.id)) { seen.add(q.id); out.push({ ...q, options: shuffle(q.options, rnd) }); }
    if (seen.size >= pool.length) break;
  }
  return out;
}

export const RANKS = [
  { at: 0, name: "Beginner" }, { at: 300, name: "Novice" }, { at: 800, name: "Competitor" },
  { at: 1600, name: "Advanced Competitor" }, { at: 2800, name: "Rules Expert" }, { at: 4500, name: "Referee-Level" },
];
export function rankFor(xp) {
  let r = RANKS[0];
  RANKS.forEach((x) => { if (xp >= x.at) r = x; });
  const next = RANKS.find((x) => x.at > xp) || null;
  return { ...r, next, toNext: next ? next.at - xp : 0 };
}
