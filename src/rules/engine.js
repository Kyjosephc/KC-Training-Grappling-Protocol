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
// "IBJJF, ADCC and The Revolution" rather than a comma-separated dump.
const andList = (xs) => (xs.length < 2 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

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
export const SEQUENCES = [
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
  // Appended rather than inserted: the Learn view calls sequenceWalkthrough
  // with no index and gets 3, so renumbering the first seven would silently
  // change which sequence the lesson teaches.
  //
  // Every step below is one of the seven positions all four rulesets score.
  // A position a ruleset does not list scores zero rather than falling back,
  // so a sequence built on ADCC's clean takedown would teach that IBJJF gives
  // nothing for a takedown that lands past the guard, which is false.
  { steps: ["guardPass", "mount", "backControl"],
    story: "They pull guard and you get straight to work. You clear their legs into side control and hold it 3 seconds, climb up into mount for 3 seconds, and when they turn away you take their back with both heels hooked inside their thighs for 3 seconds." },
  { steps: ["takedown", "backControl"],
    story: "You take them down onto their back and hold the top position for 3 seconds. They turn to their knees to build back up, and instead of passing you ride the turn and take their back, both heels hooked inside their thighs, for 3 seconds. You never pass their guard at any point." },
  { steps: ["sweep", "guardPass", "kneeOnBelly"],
    story: "They are working to pass your guard when you reverse them and come up on top for 3 seconds. You clear their legs into side control and hold it 3 seconds, then post one foot wide and drive the near knee onto their stomach for 3 seconds." },
  { steps: ["guardPass", "kneeOnBelly", "mount"],
    story: "From inside their guard you clear the legs into side control and hold 3 seconds, step into knee on belly for 3 seconds, then slide the knee across their body into mount and hold that 3 seconds." },
  { steps: ["takedown", "guardPass", "kneeOnBelly", "mount", "backControl"],
    story: "You take them down and hold 3 seconds, clear their legs into side control for 3 seconds, step into knee on belly for 3 seconds, slide into mount for 3 seconds, and when they turn in to escape you take their back with both heels hooked inside their thighs for 3 seconds." },
];

// ADCC is the one ruleset where WHEN in the match changes the answer, so its
// sequences have to say which half they happen in or the question is unfair.
const SEQ_PREAMBLE = {
  adcc: "This is the second half of the match, so points are live. ",
};

// The Learn view teaches the arithmetic the sequence questions test: one
// continuous sequence, each position in it, and the total climbing as it goes.
// Built from the same SEQUENCES and the same scoring table as the questions, so
// the lesson can never disagree with what the quiz marks correct.
export function sequenceWalkthrough(rsId, which = 3) {
  const rs = RULESETS[rsId];
  if (!rs) return null;
  const seq = SEQUENCES[which] || SEQUENCES[0];
  let running = 0;
  const steps = seq.steps.map((k) => {
    const sc = rs.scoring[k];
    const points = sc && sc.points != null ? sc.points : 0;
    running += points;
    return {
      key: k,
      label: POS_LABEL[k] || k,
      points,
      running,
      control: sc ? sc.control : `${rs.name} does not score this position at all`,
    };
  });
  return {
    steps,
    total: running,
    sum: steps.map((x) => `${x.label} ${x.points}`).join(" + "),
    preamble: SEQ_PREAMBLE[rsId] || "",
    note: rsId === "ibjjf"
      ? "Everything reached in one unbroken sequence scores. The referee counts the three seconds once, at the end — not separately at every stage."
      : "Each position in the sequence scores on its own once it has been controlled.",
    cite: `${rs.name} ${rs.version} — ${rsId === "ibjjf" ? "Art. 3.4 (cumulative points)" : "Scoring"}`,
  };
}

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
    // Each distractor carries the ruleset it came from and that ruleset's own
    // name for it. "That is the ADCC rule on guard pulling, not IBJJF's" is the
    // entire lesson of this question type, and it used to be discarded the
    // moment a distractor was picked, leaving a wrong answer with no
    // explanation at all on the hardest tier in the bank.
    const pool = [];
    RULESET_IDS.filter((x) => x !== rsId).forEach((x) => {
      RULESETS[x].specials.forEach((o) => {
        if (o.v !== sp.v) pool.push({ v: o.v, from: RULESETS[x].name, k: o.k });
      });
    });
    const picked = shuffle(pool, rnd).slice(0, 3);
    const wrong = {};
    picked.forEach((d) => {
      wrong[d.v] = `That one is true — under ${d.from}, where it is the rule on ${d.k.toLowerCase()}. It is not ${rs.name}'s.`;
    });
    const others = andList([...new Set(picked.map((d) => d.from))]);
    return {
      id, ruleset: rsId, topic: "special", difficulty: 3,
      prompt: `${rs.name} — ${sp.k.toLowerCase()}. Which of these is ${rs.name}'s rule?`,
      options: shuffle([sp.v, ...picked.map((d) => d.v)], rnd),
      answer: sp.v,
      // The answer text IS the rule, so repeating it here taught nothing. What
      // an athlete needs after answering is why the other three looked right:
      // every one of them is a real rule, somewhere else.
      why: `${rs.name}, ${sp.cite}. The other three options are real rules too — they belong to ${others} — which is exactly how this catches people who cross between promotions.`,
      wrong, cite: `${rs.name} ${rs.version} — ${sp.cite}`,
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

// Which rung of the published ladder each wrong option corresponds to. Nothing
// here is invented: every note is read back off rs.penalties.ladder.
const PEN_OPTIONS = ["Nothing yet, it is only marked", "An advantage to the opponent",
  "2 points to the opponent", "Disqualification"];
function penaltyWrong(rs, answer) {
  const out = {};
  PEN_OPTIONS.filter((o) => o !== answer).forEach((o) => {
    const probe = /advantage/i.test(o) ? /advantage/i
      : /2 points/i.test(o) ? /\b2 points?\b/i
      : /disqualif/i.test(o) ? /disqualif/i
      : /marked|nothing/i;
    const line = rs.penalties.ladder.find((x) => probe.test(x));
    out[o] = line
      ? `That is a different rung — under ${rs.name} it is the ${line.trim()}.`
      : `${rs.name}'s ladder never does that. It runs: ${rs.penalties.ladder.join(" · ")}.`;
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
      // Each wrong rung is named off the ladder itself, so an athlete who picks
      // "disqualification" learns which penalty number that actually is.
      wrong: penaltyWrong(rs, pick),
      cite: `${rs.name} ${rs.version} — ${rs.penalties.cite}`,
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
        "You are disqualified": `Not for one passive guard pull. ADCC works in negative points: ${rs.penalties.ladder.join(" · ")}.`,
      },
      cite: `${rs.name} ${rs.version} — ${rs.penalties.cite}`,
    });
  }

  // Tiebreaks: published in every rulebook, and competitors almost never know
  // them until the match is already over. The summary line lives on the ruleset
  // so the generator never has to guess which entry of a tiebreak list is the
  // one that applies after points — the lists are structured differently.
  if (rs.tiebreakSummary) {
    // Each distractor keeps the organisation it belongs to, so a wrong pick
    // says whose tiebreak that actually is — which is the thing that catches
    // somebody who learned one promotion's rules and entered another's.
    const seenTie = new Set([rs.tiebreakSummary]);
    const others = RULESET_IDS.filter((x) => x !== rsId)
      .map((x) => ({ s: RULESETS[x].tiebreakSummary, name: RULESETS[x].name }))
      .filter((o) => o.s && !seenTie.has(o.s) && (seenTie.add(o.s), true));
    const rnd = mulberry(hashSeed(`${rsId}:tie`));
    const takeTie = shuffle(others, rnd).slice(0, 3);
    const tieWrong = {};
    takeTie.forEach((o) => { tieWrong[o.s] = `That is how ${o.name} breaks a tie, not ${rs.name}.`; });
    out.push({
      id: `${rsId}:tie`, ruleset: rsId, topic: "tiebreak", difficulty: 3,
      prompt: `${rs.name}. The clock runs out and you and your opponent are dead level on points. What decides the match?`,
      options: shuffle([rs.tiebreakSummary, ...takeTie.map((o) => o.s)], rnd),
      answer: rs.tiebreakSummary,
      why: `${rs.name} tiebreak order: ${rs.tiebreak.join(" → ")}`,
      wrong: tieWrong, cite: `${rs.name} ${rs.version} — tiebreak`,
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
      // Every distractor is a real division's time somewhere, so the note can
      // name whose it is instead of leaving a wrong answer unexplained.
      wrong: durationWrong(rs, rsId, d, distractors),
      cite: `${rs.name} ${rs.version} — ${rs.durationCite}`,
    });
  });
  return out;
}

// A wrong match length is almost always a real division's length — usually one
// of this ruleset's own, which is exactly the mix-up. Read straight off the
// durations tables; nothing is inferred.
function durationWrong(rs, rsId, d, distractors) {
  const out = {};
  distractors.forEach((t) => {
    const mine = rs.durations.filter((x) => x.time === t).map((x) => x.division.toLowerCase());
    if (mine.length) {
      const shown = mine.slice(0, 2);
      const more = mine.length > shown.length ? ", among others" : "";
      out[t] = `${t} is ${rs.name}'s ${andList(shown)}${more} — not ${d.division.toLowerCase()}, which is ${d.time}.`;
      return;
    }
    const from = RULESET_IDS.filter((x) => x !== rsId)
      .find((x) => RULESETS[x].durations.some((y) => y.time === t));
    out[t] = from
      ? `${t} is a ${RULESETS[from].name} division length. ${rs.name} gives ${d.division.toLowerCase()} ${d.time}.`
      : `${rs.name} gives ${d.division.toLowerCase()} ${d.time}, not ${t}.`;
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
    // Each distractor keeps the position it belongs to. Telling an athlete
    // "that is part of what mount requires, not knee on belly" is the whole
    // point of confusing two positions' requirements, and it was being thrown
    // away: these questions shipped with no feedback on a wrong answer.
    const seenMust = new Set();
    const others = Object.entries(reqs)
      .filter(([k]) => k !== pos)
      .flatMap(([k, x]) => x.must.map((m) => ({ m, from: k })))
      .filter((d) => !mine.has(d.m.toLowerCase()) && !generic.test(d.m))
      .filter((d) => {
        const key = d.m.toLowerCase();
        if (seenMust.has(key)) return false;
        seenMust.add(key);
        return true;
      });
    const specific = r.must.find((x) => !generic.test(x)) || r.must[0];
    if (r.must.length && others.length >= 3) {
      const take = others.slice(0, 3);
      const reqWrong = {};
      take.forEach((d) => {
        reqWrong[d.m] = `That is part of what ${POS_LABEL[d.from] || d.from} requires, not ${POS_LABEL[pos] || pos}.`;
      });
      out.push({
        id: `${rsId}:req:${pos}`, ruleset: rsId, topic: pos, difficulty: 2,
        prompt: `${rs.name}. The referee is deciding whether to award ${POS_LABEL[pos] || pos}. Which of these does ${rs.name} require before the points go up?`,
        options: [specific, ...take.map((d) => d.m)],
        answer: specific,
        why: `For ${POS_LABEL[pos] || pos} under ${rs.name}: ${r.must.join(" · ")}.`,
        wrong: reqWrong, cite: `${rs.name} ${rs.version} — ${r.cite}`,
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
          // Whichever of these is not the answer still needs an explanation.
          // Before this, the deciding option on the hardest questions in the
          // bank was the one option that said nothing back.
          ...(answer === "An advantage"
            ? { Nothing: `It is not nothing — ${rs.name} came close enough here to award an advantage.` }
            : { "An advantage": `Not even an advantage. Under ${rs.name} this one falls short of the position altogether.` }),
          "Half the points": "No ruleset here awards half points. A position either scores in full or it does not score.",
        },
        cite: `${rs.name} ${rs.version} — ${r.cite}`,
      });
    });
  });
  return out;
}

// --- The bank ----------------------------------------------------------------
// --- 7. Submissions: the moment the score stops mattering -------------------
// Asked from three places on purpose, because the most expensive thing a first
// competitor believes is that a lead has to be nursed to the buzzer. A tap
// ends it from underneath a six-point deficit exactly as it does from mount,
// and it ends it before the referee has finished counting a position.
//
// These are questions rather than sequences deliberately. A submission is not
// a scoring position — three of the four rulesets give a near miss no points
// at all — so it has no place in the cumulative arithmetic the sequences test.
const SUB_SPOTS = [
  { key: "bottom", difficulty: 2,
    scene: "You are losing 6 to 0 with a minute left. From your closed guard you catch a triangle and they tap." },
  { key: "top", difficulty: 1,
    scene: "You are in mount and take the arm. They tap before the referee has finished counting the three seconds for the mount." },
  { key: "side", difficulty: 2,
    scene: "You have had side control for about two seconds, nowhere near the three the position needs, when you catch a kimura and they tap." },
];
function submissionQuestions(rsId) {
  const rs = RULESETS[rsId];
  const WIN = "The match is over and you have won";
  return SUB_SPOTS.map((sp) => ({
    id: `${rsId}:sub:${sp.key}`,
    ruleset: rsId, topic: "submission", difficulty: sp.difficulty,
    prompt: `${rs.name} rules. ${sp.scene} What is the result?`,
    options: [WIN, "You win only because you were ahead on points", "The points stand and the match carries on", "An advantage"],
    answer: WIN,
    why: `A tap ends the match under every ruleset here, ${rs.name} included. Points, advantages and penalties all stop mattering the moment it is accepted — they exist to decide matches that go the distance, and this one did not.`,
    wrong: {
      "You win only because you were ahead on points": "A submission is a finish, not a tiebreak. The score on the board is irrelevant once they tap — which is the whole reason being behind is survivable.",
      "The points stand and the match carries on": "It does not carry on. The tap ends the match where it happened.",
      "An advantage": `An advantage is for a submission that came close and did not finish. This one finished, and ${rs.name} does not pay a finish in advantages.`,
    },
    cite: `${rs.name} ${rs.version}`,
  }));
}

export function buildQuestionBank() {
  const all = [];
  RULESET_IDS.forEach((id) => {
    all.push(...positionQuestions(id), ...sequenceQuestions(id), ...specialQuestions(id),
             ...systemQuestions(id), ...holdQuestions(id), ...requirementQuestions(id),
             ...submissionQuestions(id));
  });
  all.push(...comparisonQuestions());
  return all;
}

export function pickQuestions(bank, { ruleset, count = 10, difficulty, minDifficulty, weakTopics = [], reviewIds = [], seed = Date.now() } = {}) {
  const rnd = mulberry(seed);
  // Questions they have already got wrong come back first, and come back as
  // themselves rather than as "a question about that topic". Weighting topics
  // is not the same thing: you can be weak at penalties and still never see
  // again the one penalty question you actually misread.
  const byId = new Map(bank.map((q) => [q.id, q]));
  const returning = reviewIds.map((id) => byId.get(id)).filter(Boolean)
    .filter((q) => !ruleset || ruleset === "all" || q.ruleset === ruleset || q.ruleset === "compare")
    .slice(0, Math.max(0, Math.min(count - 1, Math.ceil(count / 2))));
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
  const seen = new Set(returning.map((q) => q.id));
  const out = returning.map((q) => ({ ...q, options: shuffle(q.options, rnd), isReview: true }));
  while (out.length < Math.min(count, pool.length) && weighted.length) {
    const q = weighted[Math.floor(rnd() * weighted.length)];
    if (!seen.has(q.id)) { seen.add(q.id); out.push({ ...q, options: shuffle(q.options, rnd) }); }
    if (seen.size >= pool.length) break;
  }
  // A review question first every time would make the opening predictable.
  return shuffle(out, rnd);
}

// ---------------------------------------------------------------------------
// REFEREE MODE
//
// The quiz asks what a position is worth. This asks the thing a referee
// actually does: watch a match go by one exchange at a time and keep the score
// in your head. Built from the same scoring tables, so it can never disagree
// with the rest of the app.
// ---------------------------------------------------------------------------
// Each event needs two tellings: one where control was held long enough to
// score, and one where it was not. Without that the game only ever tests
// whether you remember a number, when the thing that actually decides a call
// is whether the position was held — and an event that does not say either way
// is a question nobody can answer correctly.
const REF_EVENTS = {
  takedown:    { noun: "a takedown", held: "puts {o} on the ground from standing and settles on top", lost: "puts {o} on the ground from standing, but {o} scrambles straight back up" },
  cleanTakedown: { noun: "a clean takedown past the guard", held: "takes {o} down and lands already past the legs", lost: "takes {o} down but lands inside {o}'s guard" },
  guardPass:   { noun: "a guard pass", held: "clears {o}'s legs into side control", lost: "clears {o}'s legs, but {o} recovers half guard almost immediately" },
  kneeOnBelly: { noun: "knee on belly", held: "steps up into knee on belly with {o} flat on their back", lost: "steps up into knee on belly but {o} turns in and dislodges it at once" },
  mount:       { noun: "mount", held: "climbs into mount, sitting on the torso with both knees down", lost: "climbs into mount but {o} bridges out immediately" },
  backMount:   { noun: "back mount", held: "takes back mount and settles", lost: "takes back mount but slips straight off to the side" },
  backControl: { noun: "back control", held: "takes the back with both hooks in and heels on the thighs", lost: "takes the back but {o} peels a hook and turns in right away" },
  sideControl: { noun: "side control", held: "settles chest to chest in side control", lost: "reaches side control but {o} frames and recovers guard at once" },
  sweep:       { noun: "a sweep", held: "sweeps from guard and comes up on top", lost: "sweeps from guard but {o} keeps coming and ends up on top instead" },
  cleanSweep:  { noun: "a clean sweep past the guard", held: "sweeps and comes up already past the legs", lost: "sweeps but comes up stuck inside {o}'s guard" },
  submissionAttempt: { noun: "a near submission", held: "locks in a tight submission that is stopped out of bounds", lost: "goes for a submission but never finishes it" },
};

// Roughly a third of exchanges are the one where nothing is awarded, because
// knowing when NOT to give points is most of refereeing.
const HELD_RATE = 0.66;

export function buildMatch(rsId, seed = Date.now()) {
  const rs = RULESETS[rsId];
  if (!rs) return null;
  const rnd = mulberry(seed);
  const scorable = Object.keys(rs.scoring).filter((k) => REF_EVENTS[k]);
  const n = 5 + Math.floor(rnd() * 2);
  const events = [];
  let blue = 0, white = 0;
  for (let i = 0; i < n; i++) {
    const key = scorable[Math.floor(rnd() * scorable.length)];
    const who = rnd() < 0.5 ? "Blue" : "White";
    const other = who === "Blue" ? "White" : "Blue";
    const def = REF_EVENTS[key];
    const scores = rs.scoring[key];
    const full = scores && scores.points != null ? scores.points : 0;
    // A position that is worth nothing anyway is always shown as held, so the
    // athlete is judging the rule rather than guessing at the story.
    const held = full === 0 ? true : rnd() < HELD_RATE;
    const pts = held ? full : 0;
    if (who === "Blue") blue += pts; else white += pts;
    const control = scores && scores.control ? scores.control : "";
    events.push({
      i, key, who, other, points: pts, held,
      text: `${who} ${(held ? def.held : def.lost).replace(/\{o\}/g, other)}.`,
      question: `How many points does ${who} score?`,
      why: pts > 0
        ? `${pts} ${pts === 1 ? "point" : "points"} to ${who}. Under ${rs.name}, ${def.noun} is worth ${full} once the requirement is met: ${control}`
        : full === 0
          ? `No points to anybody. Under ${rs.name}, ${def.noun} does not score: ${control}`
          : `No points. ${def.noun.charAt(0).toUpperCase() + def.noun.slice(1)} is worth ${full} under ${rs.name}, but only once the requirement is met: ${control} ${other} got out before that, so nothing goes on the board.`,
      cite: `${rs.name} ${rs.version}${scores && scores.cite ? ` — ${scores.cite}` : ""}`,
      runningBlue: blue, runningWhite: white,
    });
  }
  return {
    ruleset: rsId, rulesetName: rs.name, controlRule: rs.control,
    events, finalBlue: blue, finalWhite: white,
  };
}
export const REF_POINT_CHOICES = [0, 2, 3, 4];

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
