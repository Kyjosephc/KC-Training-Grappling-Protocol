// =============================================================================
// CONTROL REQUIREMENTS — what you actually have to do to get the points
// =============================================================================
// Knowing a mount is 4 is the easy half. The half that loses matches is what
// counts as a mount, how long you have to hold it, and which near-misses are
// only an advantage. Everything here is quoted from the same official rulebooks
// as rulesets.js.
//
// SCENES are the teaching layer: a plain description of what an athlete and a
// referee actually see, so a question can describe a situation instead of
// naming a position and hoping the athlete already knows what it means. A scene
// never states a point value — that lives in rulesets.js and nowhere else, so
// the two cannot contradict each other.
// =============================================================================

export const HOLD_SECONDS = {
  ibjjf: { n: 3, rule: "Points are awarded once a position is stabilised for 3 seconds.", cite: "IBJJF Art. 3.1" },
  adcc: { n: 3, rule: "Positions must be controlled for 3 seconds.", cite: "ADCC scoring" },
  gi: { n: 3, rule: "Control must be established before points are awarded.", cite: "G.I scoring" },
  revolution: { n: 3, rule: "3 seconds of continuous control; short of that it is an advantage.", cite: "The Revolution scoring" },
};

// What the referee is watching, described as it happens on the mat. Keyed to
// the scoring keys in rulesets.js. Every scoring key must have one — verify.mjs
// fails if a position is added without a scene.
export const SCENES = {
  ibjjf: {
    takedown: "You start the match standing. You shoot a double leg, drive through, and land your opponent on their back. You stay on top and hold it for a full 3 seconds while the referee watches.",
    guardPass: "Your opponent has you in their closed guard. You break the legs open, clear both of them so neither one is blocking you any more, and settle into side control. You hold side control for 3 seconds.",
    kneeOnBelly: "You are already past their guard. You drive the knee nearest their hip onto their stomach, keep your other foot posted wide with that knee off the mat, and hold it there for 3 seconds while they lie on their back.",
    mount: "You are past half guard. You climb up and sit on their torso with both knees on the mat, chest over theirs, and hold it for 3 seconds.",
    backMount: "You end up on top of their back with your chest on their shoulder blades, riding them while they are face-down, and hold it for 3 seconds.",
    backControl: "They turn away and you climb onto their back. Both of your heels are hooked inside their thighs, your legs are not crossed, and you hold that for 3 seconds.",
    sweep: "They are on top, inside your closed guard. You hook a leg, bridge, and reverse the position so you come up on top of them. You hold the top position for 3 seconds.",
    submissionAttempt: "You lock up a tight armbar. They defend, the arm never straightens, and time runs out with the submission unfinished.",
  },
  adcc: {
    takedown: "You shoot a single leg and finish it. They land with their backside on the mat and immediately pull you into their closed guard. You hold that for 3 seconds. The match is in the second half, so points are live.",
    cleanTakedown: "You hit a throw in the second half and land completely past their legs — they never get a guard, and about three quarters of their back is flat on the mat. You hold it for 3 seconds.",
    guardPass: "In the scoring half, you clear their legs and flatten them out with roughly three quarters of their back on the mat. You hold it for 3 seconds.",
    kneeOnBelly: "They are flat on their back in the scoring half. You put your knee on the middle of their stomach and hold it there for 3 seconds.",
    mount: "In the scoring half you sit on their torso with both knees on the floor and both knees below the line of their shoulders. You hold it for 3 seconds.",
    backMount: "In the scoring half you take their back with both hooks in — or a body triangle locked — squared up behind them, and hold it for 3 seconds.",
    backControl: "In the scoring half you take their back with both hooks in — or a body triangle locked — squared up behind them, and hold it for 3 seconds.",
    sweep: "You are on the bottom in the scoring half. You reverse them and come up on top, landing in their guard or half guard, and hold it for 3 seconds.",
    cleanSweep: "You reverse them from the bottom in the scoring half and come up completely past their legs, with about three quarters of their back pinned. You hold it for 3 seconds.",
    submissionAttempt: "You lock a deep heel hook in the scoring half. They survive it and the referee never stops the match.",
  },
  gi: {
    takedown: "You take your opponent down from standing and establish control on top.",
    guardPass: "You clear their legs and establish control past the guard.",
    kneeOnBelly: "You establish knee on belly and control it.",
    mount: "You establish mount and control it.",
    backMount: "You establish back mount and control it.",
    backControl: "You establish back control and control it.",
    sweep: "From the bottom you reverse them and establish control on top.",
    submissionAttempt: "You have a tight, legitimate submission locked up and the referee stops the match because both of you have gone out of bounds.",
  },
  revolution: {
    takedown: "You take them down from standing and hold the top position for 3 unbroken seconds.",
    guardPass: "You clear their legs and hold the position past the guard for 3 unbroken seconds.",
    kneeOnBelly: "You settle knee on belly and hold it for 3 unbroken seconds.",
    mount: "You climb to mount and hold it for 3 unbroken seconds.",
    backMount: "You take back mount and hold it for 3 unbroken seconds.",
    backControl: "You take their back — hooks in, or simply a back grab with your arms around them from behind — and hold it for 3 unbroken seconds.",
    sideControl: "You pass and settle into side mount, chest to chest across them, and hold it for 3 unbroken seconds. You never climb to mount.",
    sweep: "From the bottom you reverse the position and hold top for 3 unbroken seconds.",
    submissionAttempt: "You have a tight submission locked and they escape before the referee stops anything.",
  },
};

// Each entry: what the referee is looking for, and the near-misses.
//
// A near-miss is an object, not a sentence, because a question has to describe
// the situation WITHOUT naming the verdict — the old version split a sentence in
// half and ended up asking things like "Feet crossed. What do you get?", or
// worse, "Knees above the shoulder line does not count. What do you get?",
// which hands over the answer inside the question.
//   scene   — what happens on the mat, with no verdict in it
//   verdict — "advantage" | "nothing"
//   why     — the rule, stated plainly, shown after they answer
export const REQUIREMENTS = {
  ibjjf: {
    guardPass: {
      must: [
        "Get past the legs — the opponent is no longer using a leg to block you",
        "Reach side control OR north–south",
        "Hold it for 3 seconds",
      ],
      notPoints: [
        { scene: "You pass their legs and stack them up on their shoulders, controlling from a four-point kneeling position with one knee on the mat. You never settle into side control or north–south.",
          verdict: "advantage",
          why: "Stacking or controlling in four-point kneeling with a knee down is not side control or north–south, so it is an advantage rather than the 3 points." },
        { scene: "You work out of their closed guard and get one of your legs free, arriving in half guard. Their other leg is still wrapped around your thigh. You hold there.",
          verdict: "advantage",
          why: "Half guard is not past the legs — one leg is still blocking you — so reaching half guard from guard is an advantage, not a completed pass." },
        { scene: "You are attacking from the top. It goes wrong and you end up underneath them, but you never get your legs between you and them.",
          verdict: "nothing",
          why: "Ending up on the bottom without using your legs is not guard, so there is nothing to score and no sweep to come back from." },
      ],
      cite: "Art. 4.2",
    },
    kneeOnBelly: {
      must: [
        "Be free of the guard",
        "Knee or shin — the one nearest their hip — on their belly, chest or ribs",
        "The other knee must NOT be touching the ground",
        "They must be on their back or side",
        "Hold it 3 seconds",
      ],
      notPoints: [
        { scene: "You are past the guard with your knee on their stomach, but your other knee is resting on the mat beside them rather than your foot being posted. You hold it there for 5 seconds.",
          verdict: "nothing",
          why: "The far knee must stay off the ground. With it posted on the mat the position is not knee on belly at all, so it scores nothing — holding it longer does not help." },
      ],
      cite: "Art. 4.3",
    },
    mount: {
      must: [
        "Be clear of half guard",
        "Sitting on their torso",
        "Two knees down, or one foot and one knee down",
        "Hold it 3 seconds",
      ],
      notPoints: [
        { scene: "You climb to mount, but one of your legs is trapping their arm and that arm is stretched out past the line of their shoulder. You sit there for 5 seconds.",
          verdict: "nothing",
          why: "A leg trapping an arm that extends past the shoulder line means you are not mounted on the torso, so no mount points are given." },
        { scene: "You land on top of them with a triangle already locked around their head and arm, sitting over their chest.",
          verdict: "nothing",
          why: "Landing on top with a triangle locked is scored as the submission position it is, not as a mount — no mount points." },
        { scene: "You climb up and sit on their chest, but you are sitting above both of their arms, pinning both of them under your knees.",
          verdict: "advantage",
          why: "Being mounted over both arms is a near-miss on mount: an advantage rather than the 4 points." },
        { scene: "You sit on their torso facing their feet rather than their head, with your back to them.",
          verdict: "nothing",
          why: "Backwards mount is not a scoring position under IBJJF — it gives nothing." },
      ],
      cite: "Art. 4.4",
    },
    backControl: {
      must: [
        "Control their back with BOTH heels between their thighs",
        "Legs must NOT be crossed",
        "At most one of their arms trapped, and not above the shoulder line",
        "Hold it 3 seconds",
      ],
      notPoints: [
        { scene: "You take their back and lock a figure four with your legs — one leg triangled over the other across their stomach — instead of hooking both heels inside their thighs. You hold it for 10 seconds.",
          verdict: "advantage",
          why: "Back control requires both heels between the thighs with the legs uncrossed. A figure four or body triangle is an advantage, not the 4 points, no matter how long it is held." },
        { scene: "You take their back with your heels inside their thighs, but you cross your feet over each other in front of their stomach.",
          verdict: "advantage",
          why: "Crossed feet break the requirement that the legs stay uncrossed, so it is an advantage rather than 4 points." },
        { scene: "You take their back with both hooks correctly in and your legs uncrossed, but you have both of their arms pinned to their body with your arms.",
          verdict: "advantage",
          why: "At most one arm may be trapped. Trapping both means an advantage instead of the 4 points." },
      ],
      cite: "Art. 4.5",
    },
    takedown: {
      must: ["Start with both feet on the ground", "Land them on their back or side", "Stabilise on the ground for 3 seconds"],
      notPoints: [
        { scene: "Your opponent drops to both knees in front of you. You snap them down from there onto their side and hold it for 5 seconds. They were not defending a sweep.",
          verdict: "nothing",
          why: "Taking down an opponent who is already on one or both knees scores nothing — the only exception is a sweep-defence situation." },
        { scene: "They sit down to pull guard. After they have already started sitting, you grab a leg and dump them onto their back.",
          verdict: "nothing",
          why: "Whoever starts first decides it. Because they initiated the guard pull before you started the takedown, the takedown does not score." },
      ],
      cite: "Art. 4.1",
    },
    sweep: {
      must: ["You are on bottom with them in your guard or half guard", "You invert the position", "You end on top and hold 3 seconds"],
      notPoints: [],
      cite: "Art. 4.6",
    },
  },
  adcc: {
    guardPass: {
      must: ["Clear the legs", "75% of their back on the mat", "Hold 3 seconds"],
      notPoints: [
        { scene: "In the scoring half you clear their legs, but they stay turned up on their side — nowhere near three quarters of their back is on the mat. You hold that for 5 seconds.",
          verdict: "nothing",
          why: "ADCC requires about 75% of the back on the mat for a pass, and ADCC has no advantages — falling short of the requirement is worth nothing at all." },
      ],
      cite: "Passing the guard",
    },
    mount: {
      must: ["Both knees on the floor", "Knees below their shoulder line", "Hold 3 seconds"],
      notPoints: [
        { scene: "In the scoring half you ride up into a high mount with both knees above the line of their shoulders, up in their armpits. You hold it for 5 seconds.",
          verdict: "nothing",
          why: "ADCC requires both knees below the shoulder line for a mount. High mount above that line does not meet it, and with no advantages in ADCC it is worth nothing." },
      ],
      cite: "Mount",
    },
    backControl: {
      must: ["Both hooks in, or a body triangle", "Squared up on their back", "Hold 3 seconds"],
      notPoints: [
        { scene: "In the scoring half you get behind them with one hook in and your other leg posted on the mat. No body triangle. You ride there for 5 seconds.",
          verdict: "nothing",
          why: "ADCC needs both hooks in or a body triangle for back mount. One hook alone does not meet it, and ADCC has no advantages to fall back on." },
      ],
      cite: "Back mount",
    },
    takedown: {
      must: ["Their backside on the mat 3+ seconds", "Ends in guard or half guard = 2", "Lands past the guard with 75% of the back down = 4"],
      notPoints: [
        { scene: "Two minutes into a six-minute ADCC Trials match, you hit a clean double leg and land past their guard, holding it for 5 seconds.",
          verdict: "nothing",
          why: "The first half of an ADCC match is scoreless — no positive points are awarded at all, however good the takedown is. Negative points still apply during that half." },
      ],
      cite: "Takedown",
    },
    kneeOnBelly: {
      must: ["Knee on the MIDDLE of the stomach", "They are flat", "Hold 3 seconds"],
      notPoints: [],
      cite: "Knee on stomach",
    },
  },
  gi: {
    guardPass: { must: ["Clear the legs and establish control"], notPoints: [], cite: "Scoring" },
    mount: { must: ["Establish mount control"], notPoints: [], cite: "Scoring" },
    backControl: { must: ["Establish back control"], notPoints: [], cite: "Scoring" },
    takedown: {
      must: ["Establish control after the takedown"],
      notPoints: [
        { scene: "You shoot in and get them down, but they scramble straight back up before you ever settle into a controlling position.",
          verdict: "nothing",
          why: "Grappling Industries has no advantage scoring at all. Control was never established, so the takedown is worth nothing — there is no partial credit in this ruleset." },
      ],
      cite: "Scoring",
    },
  },
  revolution: {
    guardPass: {
      must: ["Clear the legs", "3 seconds of continuous control"],
      notPoints: [
        { scene: "You clear their legs and get to side control, but they recover guard after about 2 seconds — you never hold it for a full 3.",
          verdict: "advantage",
          why: "The Revolution requires 3 seconds of continuous control. Short of that the pass is an advantage rather than 3 points." },
      ],
      cite: "Scoring",
    },
    sideControl: {
      must: ["Establish side mount or technical mount", "3 seconds of continuous control"],
      notPoints: [
        { scene: "You arrive in side mount and they bridge you off after roughly 2 seconds.",
          verdict: "advantage",
          why: "Side mount scores under The Revolution, but only with 3 seconds of continuous control. Short of that it is an advantage." },
      ],
      cite: "Scoring",
    },
    mount: {
      must: ["Establish mount", "3 seconds of continuous control"],
      notPoints: [
        { scene: "You climb to mount and they immediately buck and escape after about 2 seconds.",
          verdict: "advantage",
          why: "Mount needs 3 seconds of continuous control. Escaped before that, it is an advantage rather than 4 points." },
      ],
      cite: "Scoring",
    },
    backControl: {
      must: ["Back control or a back grab", "3 seconds of continuous control"],
      notPoints: [
        { scene: "You get your arms around them from behind in a back grab, but they peel your grip and turn in after about 2 seconds.",
          verdict: "advantage",
          why: "A back grab scores under The Revolution, but it still needs 3 seconds of continuous control. Short of that it is an advantage." },
      ],
      cite: "Scoring",
    },
    takedown: {
      must: ["Land the takedown", "3 seconds of continuous control"],
      notPoints: [
        { scene: "You land the takedown cleanly but they scramble free in about 2 seconds, before you ever settle.",
          verdict: "advantage",
          why: "The takedown needs 3 seconds of continuous control to score. Short of that it is an advantage." },
      ],
      cite: "Scoring",
    },
  },
};
