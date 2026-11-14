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
    checked: "2026-11-13",
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
      "Then most advantages (Art. 2.5.2)",
      "Then fewest penalties (Art. 2.5.3)",
      "Then referee decision — who was more offensive and came closest to scoring (Art. 2.5.4)",
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
    // Changes the IBJJF has published but which are not in force yet. Kept
    // apart from everything above on purpose: the values above are what a
    // referee will use at a tournament today, and every question in the game
    // is generated from them. These are here so nobody is surprised in
    // January, and verify.mjs holds that no question is ever built from them.
    upcoming: {
      effective: "1 January 2027",
      source: "ibjjf.com/rule-changes-2027 — the organisation's own change list",
      checked: "2026-11-13",
      note: "Published by the IBJJF and in force from 1 January 2027. Until then everything above is what applies, including at a tournament in December. The IBJJF's own page says that in case of doubt the Rules Book text prevails over its summary.",
      changes: [
        { k: "Straight foot lock", v: "Becomes illegal for juveniles 16 and 17 at every belt, and for white belts from Adult through Master 8. It was previously illegal only in the 4–12 and 13–15 divisions.", cite: "Art. 6.2.3 N" },
        { k: "Foot rotation (botinha)", v: "Turning towards the foot that is not being attacked stops being illegal for blue and purple belts, Adult through Master 8. Brown and black belts could already do it. Anybody who may not apply the straight foot lock still may not apply it at all.", cite: "Art. 6.2.3" },
        { k: "Lapel or belt grip with your own leg wrapped", v: "20 seconds to pursue positional progression, or it is a lack-of-combativeness penalty — whatever the intention behind the grip. All athletes.", cite: "Art. 6.2.1 G" },
        { k: "Suspended guard", v: "The 3-second limit to bring the opponent to the ground is removed. To score the takedown the opponent now has to be made to land on their back, on their side or seated, and the main rule's 3 seconds of stabilised top control still applies. All athletes.", cite: "Art. 4.1.12" },
        { k: "Jumping closed guard", v: "Jumping closed guard on a standing opponent becomes a severe foul with immediate disqualification, in the under-15 division at every belt and for white belts in every age group. The old procedure — stand the athletes up and award 2 points — is gone.", cite: "Art. 6.2.3 M, 7.1" },
        { k: "Double guard pull", v: "After 20 seconds with neither athlete having got on top or scored, the referee stops the match, penalises both of them and restarts standing — even if a submission is in hold or a score looks imminent. All athletes.", cite: "Art. 6.2.1 C" },
        { k: "Disciplinary disqualification", v: "The IBJJF may turn a severe foul into a disciplinary disqualification where it was committed intentionally, or with knowing risk of injury, including the use of disproportionate force. At the IBJJF's exclusive discretion, and it has to be requested by the event's Referee Coordinator.", cite: "Art. 6.1.7, 6.1.8" },
        { k: "A new referee gesture", v: "Hands raised palms forward, then lowered palms down, asking the athletes to calm down.", cite: "Art. 1" },
        { k: "Match stopped with a submission locked in", v: "If the stoppage is nobody's fault and the Rules Book has no procedure for it, the match restarts standing in the centre and the athlete who had the submission is given 2 points.", cite: "Art. 1.3.7" },
        { k: "Progression in guard passing", v: "The progression concept already used for sweeps now applies to guard passing as well. No change to the Rules Book text — this is a change in how it is refereed.", cite: "ibjjf.com rule-change page" },
        { k: "A new Master 8 division", v: "Ages 66 and over, with 4-minute matches. Master 7 becomes 61 to 65 and stays at 5 minutes.", cite: "Art. 1.3, 3.3.2" },
        { k: "No-gi shirts", v: "The 10% belt-colour rule applies only to coloured belts, grey through brown, and the colour has to be visible from the front and the back. White belts wear a predominantly white shirt, over half, with black as the only other colour. Black belts wear predominantly black with white as the only other colour.", cite: "Art. 8.1.16" },
        { k: "No-gi shorts", v: "No longer than the knee, with the hem no more than 15cm above the middle of the knee. In kids divisions they have to cover at least halfway down the thigh.", cite: "Art. 8.1.16" },
        { k: "No-gi compression garments", v: "Men may wear spats and/or compression shorts under the shorts, in black, white, black and white, or their belt colour.", cite: "Art. 8.1.16" },
      ],
    },
  },

  adcc: {
    id: "adcc",
    name: "ADCC",
    longName: "Abu Dhabi Combat Club",
    version: "Rules & Regulations, current published edition",
    effective: "Rules PDF dated 19 October 2026",
    source: "adcc-official.com — ADCC_Rules_2026_10-19.pdf, with the legal-techniques grid updated 20 July 2026",
    checked: "2026-11-13",
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
        "Negative point for jumping to guard, or going from standing to the ground and staying down 3 or more seconds — in the second half of regulation, all of overtime, and the first half of a finals match",
        "Negative point for disengaging, backing up and avoiding re-engagement",
        "Negative point for a flying submission attempt that ends with the attacker on their back, if the opponent escapes and holds them down 3 seconds",
        "Passivity — warned twice, then a negative point. After that first negative there are no more warnings",
        "In Worlds finals and superfights, and in Trials and Opens finals, negatives can be given during the scoreless period as well",
      ],
      stalling: "Passivity is warned twice before a minus point is given, and after the first minus there are no further warnings.",
      cite: "Penalties",
    },
    durations: [
      { division: "World Championship, qualifying", time: "10 min — first 5 scoreless, second 5 with points" },
      { division: "World Championship, finals & superfights", time: "20 min — first 10 scoreless, then points; up to two overtimes" },
      { division: "Trials, qualifying", time: "6 min — first 3 scoreless, second 3 with points" },
      { division: "Trials, finals", time: "8 min — first 4 scoreless, second 4 with points" },
      { division: "Opens, adult", time: "6 min — first 3 scoreless, second 3 with points" },
      { division: "Opens, masters", time: "5 min — first 2:30 scoreless, second 2:30 with points" },
    ],
    durationCite: "Match structure",
    tiebreak: [
      "Most points",
      "Then overtime — half the regulation length, with points and negatives live throughout",
      "Then referee decision. The published judging criterion is who was the aggressor and initiated the action",
      "No advantages exist to separate a tie",
    ],
    tiebreakSummary: "Overtime, then a referee decision — there are no advantages to count.",
    specials: [
      { k: "The scoreless period", v: "In the first half of a match no positive points are awarded. Negative points still apply. This is the single biggest difference from every other ruleset here.", cite: "Match structure" },
      { k: "Clean vs regular", v: "A takedown or sweep that lands past the guard is worth 4, not 2. Landing in guard or half guard is 2.", cite: "Scoring" },
      { k: "Mount is cheap", v: "Mount is 2 and back mount is 3 — the opposite emphasis to IBJJF, where both are 4.", cite: "Scoring" },
      { k: "Guard pulling", v: "Pulling guard and staying down 3 seconds or more is a negative point — in the second half of regulation, throughout overtime, and in the first half of a finals match. Sitting to a neutral position during points time with your opponent in your guard counts as pulling, and so does pulling guard on an opponent who is in turtle.", cite: "Penalties, Other topics" },
      { k: "Slams", v: "Legal only at ADCC Adult Trials and the World Championships, and even there only while you are locked in a submission — if your opponent lets go of the submission you have to let go of the slam. Illegal in every division of the North and South American Opens, including adults advanced.", cite: "Illegal techniques; Opens modification" },
      { k: "Kani basami (scissor takedown)", v: "In the North and South American Opens it is legal only in Adults Advanced, and illegal in every other division there — all kids, all teens, adults beginner and intermediate, and all masters. The restriction is written into the Opens modification and nowhere else.", cite: "Opens modification" },
      { k: "Which masters age", v: "The rules PDF says Masters is 30 and over; the rules page on the same site says 35 and over. Two official sources that disagree — check your division with the event before you enter it.", cite: "Time limits (PDF) vs. rules page" },
      { k: "Points do not chain", v: "The rules say points are not combined or chained. A sweep straight into a pass is counted as the positions it is, not added up the way IBJJF adds a sequence together — this is the opposite of IBJJF's cumulative scoring.", cite: "Scoring" },
    ],
  },

  gi: {
    id: "gi",
    name: "Grappling Industries",
    longName: "Grappling Industries",
    version: "G.I Rulebook",
    effective: "9 February 2026",
    source: "grapplingindustries.com — official G.I Rulebook PDF dated 2026-02-09",
    checked: "2026-11-13",
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
      submissionAttempt: P(2, "A strong submission attempt stopped because the athletes went out of bounds — unless the defender was the one forcing it off the mat to escape", "Rule 6.12"),
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
      "Within a match: fewest penalties, then referee decision — judged on submission threat, then positional dominance, then aggression",
      "Within a round-robin division: most wins, then most submissions, then head-to-head, then most points scored, then fewest points conceded",
    ],
    tiebreakSummary: "Fewest penalties, then a referee decision. There are no advantages in this ruleset.",
    specials: [
      { k: "No advantages", v: "A near-miss is worth nothing. A position either scores or it does not.", cite: "Scoring" },
      { k: "Submission attempt scores", v: "A strong submission attempt stopped by going out of bounds is worth 2 points — unique among these four rule sets. Not if the defender was the one driving it off the mat to escape, and doing that deliberately during a submission is a disqualification.", cite: "Rules 6.12, 9.1" },
      { k: "Round robin", v: "Most divisions are round-robin, so the division is decided by wins before it is decided by points.", cite: "Format" },
    ],
  },

  revolution: {
    id: "revolution",
    name: "The Revolution",
    longName: "The Revolution (Liberty Events)",
    version: "Tournament Rules, current published edition",
    effective: "Checked November 2026",
    source: "leapllc.com/tournament-rules — The Revolution official tournament rules page",
    checked: "2026-11-13",
    gi: true,
    blurb: "Uses IBJJF as a guideline for points, advantages and penalties, and scores a back grab with hooks among its four-point positions.",
    control: "3 seconds of continuous control; short of that it is an advantage.",
    scoring: {
      takedown:   P(2, "3s of control", "Scoring"),
      guardPass:  P(3, "3s of control", "Scoring"),
      kneeOnBelly:P(2, "3s of control", "Scoring"),
      mount:      P(4, "3s of control", "Scoring"),
      backMount:  P(4, "3s of control", "Scoring"),
      backControl:P(4, "3s of control, hooks in. A back grab counts at 4 only with the hooks in — arms around from behind with the feet crossed, or both arms trapped under the legs, is an advantage", "Scoring"),
      // Not a scoring position, here or anywhere else in this app. The rules
      // list "Side/Technical Mount" among the four-point positions, beside
      // front mount and back mount — that is the mount variation you land in
      // coming off mount onto your side, not side control. An earlier version
      // of this file read it as side control and taught that settling chest
      // to chest scored 4, which is the kind of thing that loses an argument
      // with a referee. If your event reads it the other way, their director
      // has the final say and this is worth asking before you compete.
      sideControl:P(null, "No points on its own. The four-point group is front mount, back mount, side/technical mount and a back grab with hooks", "Scoring"),
      sweep:      P(2, "3s of control", "Scoring"),
      submissionAttempt: P(null, "No points — near misses are advantages", "Scoring"),
    },
    advantages: {
      used: true,
      rule: "Awarded when a position is nearly achieved but the 3 seconds of continuous control is not held.",
      cite: "Scoring",
    },
    penalties: {
      ladder: [
        "1st serious foul — penalty marked on the offender's scoreboard",
        "2nd — penalty, plus an advantage to the opponent",
        "3rd — penalty, plus 2 points to the opponent",
        "4th — disqualification, for athletes 15 and over",
        "Age 14 and under: the 4th and 5th each add a penalty and 2 points, and the 6th disqualifies",
        "A severe foul is an immediate disqualification",
      ],
      stalling: "20 consecutive seconds for each stalling penalty, stacked on the same ladder as serious fouls. Gripping in 50/50 starts the 20-second count.",
      cite: "Fouls",
    },
    durations: [
      { division: "Master 1/2 black, brown, purple & advanced", time: "6 min" },
      { division: "Master 1/2 white, blue, intermediate & beginner", time: "5 min" },
      { division: "Master 3/4 & Master 5", time: "5 min" },
      { division: "Consolation matches", time: "Up to 1 min less than standard" },
    ],
    durationCite: "Match durations",
    tiebreak: [
      "The published rules do not state a tiebreak",
      "They do say IBJJF is the guideline for points, advantages and penalties, so expect advantages, then fewest penalties, then a referee decision",
      "The tournament director has the final say on anything the rules do not cover — worth asking on the day rather than assuming",
    ],
    tiebreakSummary: "Not published. IBJJF is the stated guideline for points, advantages and penalties, and the tournament director decides anything else.",
    specials: [
      { k: "Four points covers the mount family", v: "Front mount, back mount and side/technical mount are all 4. Side control is not on that list — under these rules and IBJJF's alike, settling chest to chest scores nothing on its own, and the points for getting there came from the guard pass.", cite: "Scoring" },
      { k: "A back grab scores, with hooks", v: "A back grab counts among the 4-point positions when the hooks are in. Arms around from behind with the feet crossed, or with both arms trapped under the legs, is an advantage rather than 4.", cite: "Scoring" },
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
