// =============================================================================
// COMPETITION RULES DATABASE
// =============================================================================
// Every value here was read from the organisation's own published rules. The
// `source` on each ruleset says which document and when it was checked. Nothing
// in this file is inferred from another organisation: the four rule sets are
// stored independently on purpose, because they genuinely differ — a guard pass
// is 3 everywhere here, but a mount is 4 under IBJJF and 2 under ADCC, and
// Grappling Industries has no advantages at all.
//
// TO UPDATE A RULE: change the value, bump `version`, update `checked`, and fix
// the `cite` if the article number moved. Nothing else in the game needs
// touching — questions are generated from this file.
// =============================================================================

export const DISCLAIMER =
  "Rules are based on the official rules published by each organization. Always verify the rules for your specific tournament — event-specific rules and updates may apply.";

// A scoring entry: what it is worth, what control is required, and the article
// it comes from. `pts: null` means the position is not a scoring position in
// that rule set, which is itself a thing competitors get wrong.
const P = (points, control, cite, note) => ({ points, control, cite, note: note || "" });

export const RULESETS = {
  ibjjf: {
    id: "ibjjf",
    name: "IBJJF",
    longName: "International Brazilian Jiu-Jitsu Federation",
    version: "Rule Book v6.1",
    effective: "June 2024",
    source: "ibjjf.com — official Rule Book PDF (2024JUN_IBJJF_Rules_EN.pdf)",
    checked: "2026-10-05",
    gi: true,
    blurb: "Points, advantages and penalties. The most widely used ruleset in gi competition.",
    control: "3 seconds of stabilised control before points are awarded (Art. 3.1).",
    scoring: {
      takedown:   P(2, "3s stabilised on the ground", "Art. 4.1"),
      guardPass:  P(3, "3s of side control past the legs", "Art. 4.2"),
      kneeOnBelly:P(2, "3s, knee on the stomach, opponent on their back", "Art. 4.3"),
      mount:      P(4, "3s, sitting on the torso, knees or one foot and one knee down", "Art. 4.4"),
      backMount:  P(4, "3s — scored the same as mount under Art. 4.4", "Art. 4.4"),
      backControl:P(4, "3s with both hooks in, heels on the inner thighs", "Art. 4.5"),
      sweep:      P(2, "3s on top after inverting from guard or half guard", "Art. 4.6"),
      submissionAttempt: P(null, "No points — a near submission is an advantage", "Art. 5.3"),
    },
    advantages: {
      used: true,
      rule: "Awarded for near-completion of a scoring position, or for a submission attempt where the opponent was in real danger. The referee judges how close it came.",
      cite: "Art. 5.1–5.3",
    },
    penalties: {
      ladder: [
        "1st penalty — marked on the scoreboard, nothing awarded",
        "2nd penalty — opponent is given an advantage",
        "3rd penalty — opponent is given 2 points",
        "4th penalty — disqualification",
      ],
      stalling: "20 consecutive seconds of non-combativeness is penalised, and those penalties stack with serious fouls on the same ladder.",
      cite: "Art. 7.2.1, 7.3.1",
    },
    durations: [
      { division: "Adult white belt", time: "5 min" },
      { division: "Adult blue belt", time: "6 min" },
      { division: "Adult purple belt", time: "7 min" },
      { division: "Adult brown belt", time: "8 min" },
      { division: "Adult black belt", time: "10 min" },
      { division: "Master 1 white/blue", time: "5 min" },
      { division: "Master 1 purple/brown/black", time: "6 min" },
      { division: "Master 2–7", time: "5 min" },
      { division: "Juvenile", time: "5 min" },
    ],
    durationCite: "General Competition Guidelines, Art. 1.3",
    tiebreak: [
      "Most points",
      "Then most advantages (Art. 2.5.3)",
      "Then fewest penalties (Art. 2.5.4)",
      "Then referee decision — who was more offensive and came closest to scoring (Art. 2.6.2)",
    ],
    tiebreakSummary: "Advantages are counted first, then fewest penalties, then a referee decision.",
    specials: [
      { k: "Cumulative points", v: "Positions passed through in one continuous sequence all score, counted once at the end of the sequence. A guard pass straight into mount is 7 (3+4).", cite: "Art. 3.4" },
      { k: "Scoring while submitted", v: "An athlete who reaches a scoring position while caught in a submission scores nothing until they escape and hold it 3 seconds. If the 3-second count is interrupted by a submission, they get an advantage for each position instead.", cite: "Art. 3.3, 3.3.2" },
      { k: "Repeating a position", v: "Deliberately giving up a position to score it again does not score again.", cite: "Art. 3.2" },
      { k: "Taken down from the knees", v: "No points for taking an opponent down who is already on one or both knees, unless it is a sweep-defence situation.", cite: "Art. 4.1.6" },
      { k: "Guard pull vs takedown", v: "Whoever initiates first decides it. A takedown started before the opponent initiates a guard pull scores; started after, it does not.", cite: "Art. 4.1.10, 4.1.11" },
      { k: "Defence out of bounds", v: "If the correct defence to a submission takes an athlete out of the area, the attacker gets 2 points.", cite: "Art. 3.1.1" },
      { k: "Both pull guard", v: "The one who gets on top first gets an advantage — but not if they go straight to side control.", cite: "Art. 3.5" },
    ],
  },

  adcc: {
    id: "adcc",
    name: "ADCC",
    longName: "Abu Dhabi Combat Club",
    version: "Rules & Regulations, current published edition",
    effective: "Checked October 2026",
    source: "adcombat.com — official Rules & Regulations, cross-checked against the ADCC rules update PDF",
    checked: "2026-10-05",
    gi: false,
    blurb: "No-gi submission wrestling. Scoreless first half, negative points, and takedowns worth more than mount.",
    control: "3 seconds of control before points are awarded.",
    scoring: {
      takedown:   P(2, "3s, ending in guard or half guard", "Takedown"),
      cleanTakedown: P(4, "3s, landing past the guard with 75% of the back on the mat", "Clean takedown"),
      guardPass:  P(3, "3s of control past the legs", "Passing the guard"),
      kneeOnBelly:P(2, "3s, knee on the middle of the stomach, opponent flat", "Knee on stomach"),
      mount:      P(2, "3s, both knees on the floor, knees below the shoulder line", "Mount"),
      backMount:  P(3, "3s with both hooks in or a body triangle", "Back mount"),
      backControl:P(3, "3s with both hooks in or a body triangle", "Back mount"),
      sweep:      P(2, "3s on top, ending in guard or half guard", "Sweep"),
      cleanSweep: P(4, "3s, landing past the guard with 75% of the back pinned", "Clean sweep"),
      submissionAttempt: P(null, "No points and no advantages — ADCC does not use advantages", "Scoring"),
    },
    advantages: { used: false, rule: "ADCC does not use advantage points.", cite: "Scoring" },
    penalties: {
      ladder: [
        "Negative point for voluntarily pulling guard and staying down 3+ seconds during the scoring period",
        "Negative point for disengaging and avoiding re-engagement, or fleeing the mat",
        "Passivity — warned twice, then a negative point",
      ],
      stalling: "Passivity is warned twice before a minus point is given.",
      cite: "Negative points",
    },
    durations: [
      { division: "World Championship, qualifying", time: "10 min — first 5 scoreless, second 5 with points" },
      { division: "World Championship, finals & superfights", time: "20 min — first 10 scoreless, then points; up to two overtimes" },
      { division: "Trials, qualifying", time: "6 min — first 3 scoreless, second 3 with points" },
      { division: "Opens, adult", time: "6 min — first 3 scoreless, second 3 with points" },
      { division: "Opens, masters", time: "5 min — first 2:30 scoreless, second 2:30 with points" },
    ],
    durationCite: "Match structure",
    tiebreak: [
      "Most points",
      "Then referee decision based on who was more dominant and aggressive",
      "No advantages exist to separate a tie",
    ],
    tiebreakSummary: "A referee decision, straight away — there are no advantages to count.",
    specials: [
      { k: "The scoreless period", v: "In the first half of a match no positive points are awarded. Negative points still apply. This is the single biggest difference from every other ruleset here.", cite: "Match structure" },
      { k: "Clean vs regular", v: "A takedown or sweep that lands past the guard is worth 4, not 2. Landing in guard or half guard is 2.", cite: "Scoring" },
      { k: "Mount is cheap", v: "Mount is 2 and back mount is 3 — the opposite emphasis to IBJJF, where both are 4.", cite: "Scoring" },
      { k: "Guard pulling", v: "Pulling guard and staying there during the scoring period is a negative point.", cite: "Negative points" },
    ],
  },

  gi: {
    id: "gi",
    name: "Grappling Industries",
    longName: "Grappling Industries",
    version: "G.I Rulebook",
    effective: "9 February 2026",
    source: "grapplingindustries.com — official rules page and rulebook PDF dated 2026-02-09",
    checked: "2026-10-05",
    gi: true,
    blurb: "Round-robin format, no advantages, and points for a submission attempt stopped out of bounds.",
    control: "Control must be established before points are awarded.",
    scoring: {
      takedown:   P(2, "Established control", "Scoring"),
      guardPass:  P(3, "Established control past the legs", "Scoring"),
      kneeOnBelly:P(2, "Established control", "Scoring"),
      mount:      P(4, "Established control", "Scoring"),
      backMount:  P(4, "Established control", "Scoring"),
      backControl:P(4, "Established control", "Scoring"),
      sweep:      P(2, "Established control", "Scoring"),
      submissionAttempt: P(2, "A solid submission attempt stopped because the athletes went out of bounds", "Scoring"),
    },
    advantages: { used: false, rule: "There is no advantage scoring.", cite: "Scoring" },
    penalties: {
      ladder: [
        "1st — warning",
        "2nd — 2 points to the opponent",
        "3rd — disqualification",
        "A major foul is immediate disqualification",
      ],
      stalling: "Handled through the same warning ladder.",
      cite: "Penalties",
    },
    durations: [
      { division: "Adults, Masters, Seniors", time: "5 min" },
      { division: "Kids 14–17", time: "4 min" },
      { division: "Kids 13 and under", time: "3 min" },
    ],
    durationCite: "Match duration",
    tiebreak: [
      "Within a match: fewest penalties, then referee decision",
      "Within a round-robin division: most wins, then most submissions, then head-to-head, then most points scored, then fewest points conceded",
    ],
    tiebreakSummary: "Fewest penalties, then a referee decision. There are no advantages in this ruleset.",
    specials: [
      { k: "No advantages", v: "A near-miss is worth nothing. A position either scores or it does not.", cite: "Scoring" },
      { k: "Submission attempt scores", v: "A solid submission attempt stopped by going out of bounds is worth 2 points — unique among these four rule sets.", cite: "Scoring" },
      { k: "Round robin", v: "Most divisions are round-robin, so the division is decided by wins before it is decided by points.", cite: "Format" },
    ],
  },

  revolution: {
    id: "revolution",
    name: "The Revolution",
    longName: "The Revolution (Liberty Events)",
    version: "Tournament Rules, current published edition",
    effective: "Checked October 2026",
    source: "leapllc.com — The Revolution official tournament rules page",
    checked: "2026-10-05",
    gi: true,
    blurb: "Uses IBJJF as a guideline but scores side control and a back grab — four points where IBJJF gives none.",
    control: "3 seconds of continuous control; short of that it is an advantage.",
    scoring: {
      takedown:   P(2, "3s of control", "Scoring"),
      guardPass:  P(3, "3s of control", "Scoring"),
      kneeOnBelly:P(2, "3s of control", "Scoring"),
      mount:      P(4, "3s of control", "Scoring"),
      backMount:  P(4, "3s of control", "Scoring"),
      backControl:P(4, "3s of control — including a back grab", "Scoring"),
      sideControl:P(4, "3s of control — side mount and technical mount both score", "Scoring"),
      sweep:      P(2, "3s of control", "Scoring"),
      submissionAttempt: P(null, "No points — near misses are advantages", "Scoring"),
    },
    advantages: {
      used: true,
      rule: "Awarded when a position is nearly achieved but the 3 seconds of continuous control is not held.",
      cite: "Scoring",
    },
    penalties: {
      ladder: ["Follows IBJJF's penalty guideline, with the tournament director as the final authority"],
      stalling: "Follows the IBJJF guideline.",
      cite: "Rules",
    },
    durations: [
      { division: "Master 1/2 black, brown, purple & advanced", time: "6 min" },
      { division: "Master 1/2 white, blue, intermediate & beginner", time: "5 min" },
      { division: "Master 3/4 & Master 5", time: "5 min" },
      { division: "Consolation matches", time: "Up to 1 min less than standard" },
    ],
    durationCite: "Match durations",
    tiebreak: [
      "Points, then advantages, then penalties, following the IBJJF guideline",
      "The tournament director has the final say on anything the document does not cover",
    ],
    tiebreakSummary: "Advantages, then penalties, following the IBJJF guideline, with the tournament director as the final authority.",
    specials: [
      { k: "Side control scores", v: "Side mount and technical mount are worth 4 points. Under IBJJF, side control is worth nothing on its own — this is the difference that costs people matches.", cite: "Scoring" },
      { k: "Back grab scores", v: "A back grab is worth 4.", cite: "Scoring" },
      { k: "A guideline, not a copy", v: "The rules say IBJJF is used as the guideline for points, advantages and penalties — not that the rules are identical.", cite: "Rules" },
    ],
  },
};

export const RULESET_IDS = ["ibjjf", "adcc", "gi", "revolution"];

// The positions the comparison mode walks through, in the order a match tends
// to go. `key` matches the scoring keys above.
export const COMPARE_ROWS = [
  { key: "takedown", label: "Takedown" },
  { key: "cleanTakedown", label: "A takedown landing past the guard" },
  { key: "sweep", label: "Sweep" },
  { key: "cleanSweep", label: "A sweep landing past the guard" },
  { key: "guardPass", label: "Guard pass" },
  { key: "kneeOnBelly", label: "Knee on belly" },
  { key: "mount", label: "Mount" },
  { key: "backControl", label: "Back control" },
  { key: "sideControl", label: "Side control" },
  { key: "submissionAttempt", label: "Submission attempt (stopped out of bounds)" },
];

export function scoreFor(rulesetId, key) {
  const rs = RULESETS[rulesetId];
  if (!rs) return null;
  return rs.scoring[key] || null;
}
