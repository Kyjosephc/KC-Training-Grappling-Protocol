// =============================================================================
// QUESTION ENGINE
// =============================================================================
// Every question is generated from rulesets.js and requirements.js. Nothing is
// written by hand, so a rule change in those files changes the questions, the
// answers and the explanations together — they cannot drift apart.
//
// Questions describe a situation. "Feet crossed. What do you get?" teaches
// nobody anything: an athlete who does not already know the rule cannot even
// tell which position is being discussed. Every prompt here says who is doing
// what, from where, and for how long, so the question itself is the lesson and
// the answer confirms it.
//
// A question is: { id, ruleset, topic, difficulty, prompt, options[], answer,
// why, wrong{}, cite }
// =============================================================================

import { RULESETS, RULESET_IDS, COMPARE_ROWS } from "./rulesets.js";
import { REQUIREMENTS, HOLD_SECONDS, SCENES } from "./requirements.js";

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
// A stable number from a string, so a given question always builds its options
// the same way. The bank has to be identical on every device, or a saved weak
// topic means nothing the next time the athlete opens the app.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const label = (n) => (n === 0 ? "No points" : `${n} point${n === 1 ? "" : "s"}`);

// --- 1. What is this worth? — asked as a situation, not as a position name ---
function positionQuestions(rsId) {
  const rs = RULESETS[rsId];
  const scenes = SCENES[rsId] || {};
  const out = [];
  Object.entries(rs.scoring).forEach(([key, s]) => {
    if (!s) return;
    const scene = scenes[key];
    if (!scene) return;                     // verify.mjs fails before this ships
    const worth = s.points == null ? 0 : s.points;
    const wrong = {};
    POINT_CHOICES.filter((n) => n !== worth).forEach((n) => {
      wrong[label(n)] = n === 0
        ? `${POS_LABEL[key] || key} does score under ${rs.name} — ${s.control}.`
        : `${rs.name} does not award ${n} for ${POS_LABEL[key] || key}.`;
    });
    out.push({
      id: `${rsId}:pos:${key}`,
      ruleset: rsId, topic: key, difficulty: 1,
      prompt: `${rs.name} rules. ${scene} How many points do you score?`,
      options: POINT_CHOICES.map(label),
      answer: label(worth),
      why: s.points == null
        ? `No points. That is ${POS_LABEL[key] || key} under ${rs.name}, and ${rs.name} awards nothing for it. ${s.control}`
        : `${label(worth)}. That is ${POS_LABEL[key] || key}: ${s.control}`,
      wrong, cite: `${rs.name} ${rs.version} — ${s.cite}`,
    });
  });
  return out;
}

// --- 2. Sequences: cumulative scoring through a match ------------------------
// Each step says what was held, because "takedown, pass, mount" is a list of
// words and "you land them on their back, hold three seconds, clear the legs
// into side control, hold three seconds" is a match.
const SEQUENCES = [
  { steps: ["takedown", "guardPass"],
    story: "You take your opponent down onto their back from standing and hold the top position for 3 seconds. They recover guard, you clear their legs into side control, and hold that for 3 seconds." },
  { steps: ["takedown", "guardPass", "mount"],
    story: "You take them down and stabilise for 3 seconds, clear their legs into side control for 3 seconds, then climb up and sit on their torso and hold mount for 3 seconds — all without them recovering anything." },
  { steps: ["sweep", "guardPass"],
    story: "They are on top inside your closed guard. You reverse them, come up on top and hold it 3 seconds, then clear their legs into side control and hold that 3 seconds." },
  { steps: ["sweep", "guardPass", "mount", "backControl"],
    story: "From the bottom you reverse them and hold top 3 seconds, pass their legs into side control for 3 seconds, climb to mount for 3 seconds, then they turn away and you take their back with both heels hooked inside their thighs, legs uncrossed, for 3 seconds." },
  { steps: ["guardPass", "kneeOnBelly"],
    story: "You clear their legs into side control and hold it 3 seconds, then post one foot wide and drive the near knee onto their stomach, holding that for 3 seconds." },
  { steps: ["takedown", "guardPass", "kneeOnBelly", "mount"],
    story: "You take them down and hold 3 seconds, pass into side control for 3 seconds, step into knee on belly for 3 seconds, then slide into mount and hold 3 seconds." },
  { steps: ["sweep", "mount"],
    story: "From your closed guard you reverse them and come straight up into mount, holding the mount for 3 seconds." },
];

// ADCC is the one ruleset where WHEN in the match changes the answer, so its
// sequences have to say which half they happen in or the question is unfair.
const SEQ_PREAMBLE = {
  adcc: "This is the second half of the match, so points are live. ",
};

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
      prompt: `${rs.name} rules. ${SEQ_PREAMBLE[rsId] || ""}${seq.story} What is on the board?`,
      options, answer: label(total),
      why: `${label(total)} — ${sum}. ${rsId === "ibjjf" ? "Positions reached in one continuous sequence all score; the referee counts the three seconds once, at the end of the sequence." : "Each position reached and controlled scores on its own."}`,
      wrong, cite: `${rs.name} ${rs.version} — ${rsId === "ibjjf" ? "Art. 3.4 (cumulative points)" : "Scoring"}`,
    };
  });
}

// --- 3. The special cases people actually lose matches over -------------------
function specialQuestions(rsId) {
  const rs = RULESETS[rsId];
  return rs.specials.map((sp, i) => {
    const id = `${rsId}:sp:${i}`;
    const rnd = mulberry(hashSeed(id));
    // Distractors are real statements from the OTHER rule sets, so the wrong
    // answer is always true somewhere — which is the actual trap in
    // competition. They are drawn fresh per question: taking the first three
    // off the pool every time meant all seven IBJJF questions shared one set of
    // wrong answers, and after two rounds you could pass by recognising them.
    const pool = [];
    RULESET_IDS.filter((x) => x !== rsId).forEach((x) => {
      RULESETS[x].specials.forEach((o) => { if (o.v !== sp.v) pool.push(o.v); });
    });
    const picked = shuffle(pool, rnd).slice(0, 3);
    return {
      id, ruleset: rsId, topic: "special", difficulty: 3,
      prompt: `${rs.name} — ${sp.k.toLowerCase()}. Which of these is the ${rs.name} rule?`,
      options: shuffle([sp.v, ...picked], rnd),
      answer: sp.v,
      why: sp.v,
      wrong: {}, cite: `${rs.name} ${rs.version} — ${sp.cite}`,
    };
  });
}

// --- 4. Cross-ruleset: the anti-guessing questions ---------------------------
// Only asked where there is a single right answer. "Which awards the most for
// mount?" used to mark Grappling Industries wrong for saying 4 when Grappling
// Industries does award 4 — IBJJF just happened to come first in the list.
function comparisonQuestions() {
  const out = [];
  COMPARE_ROWS.forEach((row) => {
    const vals = RULESET_IDS.map((id) => {
      const s = RULESETS[id].scoring[row.key];
      return { id, name: RULESETS[id].name, pts: s && s.points != null ? s.points : null };
    });
    const num = (v) => (v.pts == null ? 0 : v.pts);
    const max = Math.max(...vals.map(num)), min = Math.min(...vals.map(num));
    if (max === min) return;                       // nothing to teach if they all agree
    const topped = vals.filter((v) => num(v) === max);
    const bottomed = vals.filter((v) => num(v) === min);
    const spread = vals.map((v) => `${v.name} ${v.pts == null ? "nothing" : v.pts}`).join(", ");

    const mk = (target, kind) => {
      const wrong = {};
      vals.filter((v) => v.name !== target.name).forEach((v) => {
        wrong[v.name] = v.pts == null
          ? `${v.name} awards nothing for ${row.label.toLowerCase()}.`
          : `${v.name} awards ${v.pts}.`;
      });
      out.push({
        id: `cmp:${row.key}:${kind}`,
        ruleset: "compare", topic: row.key, difficulty: 3,
        prompt: kind === "most"
          ? `You are choosing between tournaments. Which one of these rule sets awards the MOST points for ${row.label.toLowerCase()}?`
          : `You are choosing between tournaments. Which one of these rule sets awards the FEWEST points for ${row.label.toLowerCase()}?`,
        options: vals.map((v) => v.name),
        answer: target.name,
        why: `${target.name} awards ${target.pts == null ? "nothing" : target.pts}. The full picture: ${spread}. This is why you cannot carry one ruleset's habits into another's tournament.`,
        wrong, cite: "Each organisation's own published scoring",
      });
    };
    // A question only ships if exactly one organisation holds that end of the
    // range. A three-way tie at the top has no single right answer.
    if (topped.length === 1) mk(topped[0], "most");
    if (bottomed.length === 1) mk(bottomed[0], "fewest");
  });
  return out;
}

// --- 5. Advantages, penalties, tiebreaks, durations --------------------------
function systemQuestions(rsId) {
  const rs = RULESETS[rsId];
  const out = [];

  out.push({
    id: `${rsId}:adv`, ruleset: rsId, topic: "advantages", difficulty: 2,
    prompt: `You are two minutes into a ${rs.name} match. You almost finish a sweep — you get them up on one side but they post a hand and stop it just short. Does anything go on the scoreboard for coming that close?`,
    options: ["Yes — an advantage", "No — nothing at all"],
    answer: rs.advantages.used ? "Yes — an advantage" : "No — nothing at all",
    why: rs.advantages.rule,
    wrong: { [rs.advantages.used ? "No — nothing at all" : "Yes — an advantage"]: rs.advantages.used
      ? `${rs.name} does use advantages — they decide matches that are level on points.`
      : `${rs.name} has no advantage scoring, so a near miss is worth nothing.` },
    cite: `${rs.name} ${rs.version} — ${rs.advantages.cite}`,
  });

  // The escalating-penalty question only makes sense where the rulebook
  // actually publishes a numbered ladder. ADCC does not — its list is separate
  // offences, each worth a negative point — and the old code answered "an
  // advantage to the opponent" for ADCC, a ruleset with no advantages.
  const second = rs.penalties.ladder.find((x) => /^\s*2nd\b/i.test(x));
  if (second) {
    const says = second.replace(/^\s*2nd[^—-]*[—-]\s*/i, "").trim().toLowerCase();
    const pick = /advantage/.test(says) ? "An advantage to the opponent"
      : /\b2 points?\b/.test(says) ? "2 points to the opponent"
      : /disqualif/.test(says) ? "Disqualification"
      : "Nothing yet, it is only marked";
    out.push({
      id: `${rsId}:pen`, ruleset: rsId, topic: "penalties", difficulty: 3,
      prompt: `${rs.name}. You have already picked up one penalty. Later in the match the referee gives you a second one. What does your opponent get for it?`,
      options: ["Nothing yet, it is only marked", "An advantage to the opponent", "2 points to the opponent", "Disqualification"],
      answer: pick,
      why: `The ${rs.name} ladder: ${rs.penalties.ladder.join(" · ")}`,
      wrong: {}, cite: `${rs.name} ${rs.version} — ${rs.penalties.cite}`,
    });
  } else if (rsId === "adcc") {
    out.push({
      id: `${rsId}:pen`, ruleset: rsId, topic: "penalties", difficulty: 3,
      prompt: "ADCC, second half, points are live. You sit down to guard and stay there for about five seconds without attacking anything. What happens on the scoreboard?",
      options: ["Nothing — guard pulling is allowed", "You lose a point", "Your opponent gets an advantage", "You are disqualified"],
      answer: "You lose a point",
      why: `ADCC has no advantages and no warning ladder — it uses negative points. ${rs.penalties.ladder.join(" · ")}`,
      wrong: {
        "Your opponent gets an advantage": "ADCC has no advantage scoring at all.",
        "Nothing — guard pulling is allowed": "Pulling guard and staying down during the scoring period costs you a point.",
      },
      cite: `${rs.name} ${rs.version} — ${rs.penalties.cite}`,
    });
  }

  // Tiebreaks: published in every rulebook, and competitors almost never know
  // them until the match is already over. The summary line lives on the ruleset
  // so the generator never has to guess which entry of a tiebreak list is the
  // one that applies after points — the lists are structured differently.
  if (rs.tiebreakSummary) {
    const others = RULESET_IDS.filter((x) => x !== rsId)
      .map((x) => RULESETS[x].tiebreakSummary).filter(Boolean);
    const rnd = mulberry(hashSeed(`${rsId}:tie`));
    out.push({
      id: `${rsId}:tie`, ruleset: rsId, topic: "tiebreak", difficulty: 3,
      prompt: `${rs.name}. The clock runs out and you and your opponent are dead level on points. What decides the match?`,
      options: shuffle([rs.tiebreakSummary, ...shuffle(others, rnd).slice(0, 3)], rnd),
      answer: rs.tiebreakSummary,
      why: `${rs.name} tiebreak order: ${rs.tiebreak.join(" → ")}`,
      wrong: {}, cite: `${rs.name} ${rs.version} — tiebreak`,
    });
  }

  // Durations. Distractors come from this ruleset's OWN other divisions first,
  // so the answer is not simply the longest or most detailed string on screen —
  // which is exactly how the ADCC duration questions used to give themselves
  // away against a field of bare "5 min" / "6 min".
  const ownTimes = [...new Set(rs.durations.map((d) => d.time))];
  const otherTimes = [...new Set(RULESET_IDS.filter((x) => x !== rsId)
    .flatMap((x) => RULESETS[x].durations.map((d) => d.time)))];
  rs.durations.slice(0, 4).forEach((d, i) => {
    const overlaps = (a, b) => a.includes(b) || b.includes(a);
    const near = ownTimes.filter((t) => t !== d.time && !overlaps(t, d.time));
    const far = otherTimes.filter((t) => t !== d.time && !overlaps(t, d.time) && !near.includes(t));
    const rnd = mulberry(hashSeed(`${rsId}:dur:${i}`));
    const distractors = [...shuffle(near, rnd), ...shuffle(far, rnd)].slice(0, 3);
    if (distractors.length < 2) return;      // not enough distinct times to ask fairly
    out.push({
      id: `${rsId}:dur:${i}`, ruleset: rsId, topic: "duration", difficulty: 2,
      prompt: `You have signed up for ${rs.name}, ${d.division.toLowerCase()}. How long is the match?`,
      options: shuffle([d.time, ...distractors], rnd),
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
    prompt: `${rs.name}. You clear their legs and settle into side control, but nothing has gone up on the board yet. How long do you have to keep them there before the referee awards it?`,
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
    // for every position, so it can never be the wrong answer — and the
    // target's own requirements obviously cannot be either.
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
        prompt: `${rs.name}. The referee is deciding whether to award ${POS_LABEL[pos] || pos}. Which of these does ${rs.name} require before the points go up?`,
        options: [specific, ...others.slice(0, 3)],
        answer: specific,
        why: `For ${POS_LABEL[pos] || pos} under ${rs.name}: ${r.must.join(" · ")}.`,
        wrong: {}, cite: `${rs.name} ${rs.version} — ${r.cite}`,
      });
    }
    // The near-misses. These are the questions that win and lose matches, and
    // the whole value is in describing the situation fully enough that an
    // athlete can picture it and reason it out.
    (r.notPoints || []).forEach((nm, i) => {
      if (!nm || !nm.scene || !nm.verdict) return;
      const answer = nm.verdict === "advantage" ? "An advantage" : "Nothing";
      const full = `Full points for ${POS_LABEL[pos] || pos}`;
      const opts = rs.advantages.used
        ? [full, "An advantage", "Nothing", "A penalty against you"]
        : [full, "Nothing", "A penalty against you", "Half the points"];
      if (!opts.includes(answer)) return;
      out.push({
        id: `${rsId}:nm:${pos}:${i}`, ruleset: rsId, topic: pos, difficulty: 3,
        prompt: `${rs.name} rules. ${nm.scene} What does the referee award?`,
        options: opts, answer,
        why: nm.why,
        wrong: {
          [full]: `That situation does not meet ${rs.name}'s requirement for ${POS_LABEL[pos] || pos}.`,
          "A penalty against you": "Nothing here is a foul — it simply does not meet the requirement for the position.",
        },
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
