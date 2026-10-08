// =============================================================================
// CONTROL REQUIREMENTS — what you actually have to do to get the points
// =============================================================================
// Knowing a mount is 4 is the easy half. The half that loses matches is what
// counts as a mount, how long you have to hold it, and which near-misses are
// only an advantage. Everything here is quoted from the same official rulebooks
// as rulesets.js.
// =============================================================================

export const HOLD_SECONDS = {
  ibjjf: { n: 3, rule: "Points are awarded once a position is stabilised for 3 seconds.", cite: "IBJJF Art. 3.1" },
  adcc: { n: 3, rule: "Positions must be controlled for 3 seconds.", cite: "ADCC scoring" },
  gi: { n: 3, rule: "Control must be established before points are awarded.", cite: "G.I scoring" },
  revolution: { n: 3, rule: "3 seconds of continuous control; short of that it is an advantage.", cite: "The Revolution scoring" },
};

// Each entry: what the referee is looking for, and the near-misses that score
// an advantage instead of points (or nothing at all).
export const REQUIREMENTS = {
  ibjjf: {
    guardPass: {
      must: [
        "Get past the legs — the opponent is no longer using a leg to block you",
        "Reach side control OR north–south",
        "Hold it for 3 seconds",
      ],
      notPoints: [
        "Stacking them or controlling the back in four-point kneeling, one knee down — advantage only",
        "Reaching half guard from guard without finishing the pass — advantage only",
        "Ending on bottom from a top attack without using your legs — no points at all, because that is not guard",
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
      notPoints: ["Posting the other knee on the mat — that is not knee on belly"],
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
        "A leg trapping an arm that extends past their shoulder line — no mount points",
        "Landing on top with a triangle locked around them — no points",
        "Mounted over both arms — advantage only",
        "Backwards mount — no points",
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
        "Legs crossed in a figure four or triangle — advantage only, not 4 points",
        "Feet crossed — advantage only",
        "Both their arms trapped — advantage only",
      ],
      cite: "Art. 4.5",
    },
    takedown: {
      must: ["Start with both feet on the ground", "Land them on their back or side", "Stabilise on the ground for 3 seconds"],
      notPoints: [
        "They were already on one or two knees — no points, unless it is sweep defence",
        "You started the takedown after they began pulling guard — no points",
        "Landing them face-down or on all fours — points only if you then establish a scoring position",
      ],
      cite: "Art. 4.1",
    },
    sweep: {
      must: ["You are on bottom with them in your guard or half guard", "You invert the position", "You end on top and hold 3 seconds"],
      notPoints: ["Both of you end up standing for under 3 seconds and they go back down — that is still your takedown points"],
      cite: "Art. 4.6",
    },
  },
  adcc: {
    guardPass: { must: ["Clear the legs", "75% of their back on the mat", "Hold 3 seconds"], notPoints: ["ADCC has no advantages — short of the requirement is nothing"], cite: "Passing the guard" },
    mount: { must: ["Both knees on the floor", "Knees below their shoulder line", "Hold 3 seconds"], notPoints: ["Knees above the shoulder line does not count"], cite: "Mount" },
    backControl: { must: ["Both hooks in, or a body triangle", "Squared up on their back", "Hold 3 seconds"], notPoints: ["One hook and no body triangle is not back mount"], cite: "Back mount" },
    takedown: { must: ["Their backside on the mat 3+ seconds", "Ends in guard or half guard = 2", "Lands past the guard with 75% of the back down = 4"], notPoints: ["During the scoreless first half, no positive points are awarded at all"], cite: "Takedown" },
    kneeOnBelly: { must: ["Knee on the MIDDLE of the stomach", "They are flat", "Hold 3 seconds"], notPoints: [], cite: "Knee on stomach" },
  },
  gi: {
    guardPass: { must: ["Clear the legs and establish control"], notPoints: ["No advantages exist — it either scores or it does not"], cite: "Scoring" },
    mount: { must: ["Establish mount control"], notPoints: ["No advantages exist"], cite: "Scoring" },
    backControl: { must: ["Establish back control"], notPoints: ["No advantages exist"], cite: "Scoring" },
    takedown: { must: ["Establish control after the takedown"], notPoints: ["No advantages exist"], cite: "Scoring" },
  },
  revolution: {
    guardPass: { must: ["Clear the legs", "3 seconds of continuous control"], notPoints: ["Short of 3 seconds is an advantage"], cite: "Scoring" },
    sideControl: { must: ["Establish side mount or technical mount", "3 seconds of continuous control"], notPoints: ["Short of 3 seconds is an advantage"], cite: "Scoring" },
    mount: { must: ["Establish mount", "3 seconds of continuous control"], notPoints: ["Short of 3 seconds is an advantage"], cite: "Scoring" },
    backControl: { must: ["Back control or a back grab", "3 seconds of continuous control"], notPoints: ["Short of 3 seconds is an advantage"], cite: "Scoring" },
    takedown: { must: ["Land the takedown", "3 seconds of continuous control"], notPoints: ["Short of 3 seconds is an advantage"], cite: "Scoring" },
  },
};
