const A = require("../.balance.cjs").__t;
const PATTERNS = [
  ["Horizontal press", /bench|floor press|push-?up|dip|landmine punch|offset single arm dumbbell press|spoto/i],
  ["Vertical press",   /overhead press|shoulder press/i],
  ["Horizontal pull",  /row|renegade|scarecrow|face pull|band pull-apart|y,? ?t,? ?w/i],
  ["Vertical pull",    /pull-?up|chin-?up|lat pulldown|toes to bar|dead hang/i],
  ["Squat",            /squat|leg press|step-?up|lunge/i],
  ["Hinge",            /deadlift|romanian|rdl|good morning|hip thrust|glute bridge|hamstring curl|valslide/i],
  ["Carry / grip",     /carry|pinch|farmer|bear-?hug/i],
  ["Neck",             /neck/i],
  ["Adductor / groin", /copenhagen|adduction|clamshell/i],
  ["Trunk / anti-rot", /plank|pallof|abdominal|core/i],
  ["Jump / throw",     /jump|slam|throw|pogo|broad/i],
  ["Sprint / agility", /sprint|shuttle|agility/i],
  ["Conditioning",     /assault bike|treadmill|aerobic|zone 2|round/i],
];
const ORDER = ["Jump / throw","Sprint / agility","Squat","Hinge","Vertical pull","Horizontal pull",
  "Vertical press","Horizontal press","Carry / grip","Neck","Adductor / groin","Trunk / anti-rot","Conditioning"];
const bucket = (name) => {
  const n = String(name).replace(/\([^)]*\)/g, " ");
  for (const label of ORDER) { const r = PATTERNS.find((p) => p[0] === label); if (r && r[1].test(n)) return label; }
  return "Other";
};
for (const v of (process.argv[2] ? [process.argv[2]] : ["A", "B"])) {
  const p = A.buildProgramVariant(v);
  let press = 0, pull = 0, squat = 0, hinge = 0;
  const hard = p.phases.filter((ph) => !/deload/i.test(ph.name));
  hard.forEach((ph) => ph.days.forEach((d) => (d.sections || []).forEach((sec) => (sec.exercises || []).forEach((e) => {
    const b = bucket(e.name || ""); const n = Number(e.sets) || 0;
    if (b.includes("press")) press += n;
    if (b.includes("pull")) pull += n;
    if (b === "Squat") squat += n;
    if (b === "Hinge") hinge += n;
  }))));
  const wk = hard.length ? hard.reduce((n, ph) => n + (ph.weekEnd - ph.weekStart + 1), 0) : 1;
  console.log(`PROGRAM ${v} — nine hard weeks`);
  console.log(`  press ${press} : pull ${pull}  → ${(press / pull).toFixed(2)}:1`);
  console.log(`  squat ${squat} : hinge ${hinge}  → ${(squat / hinge).toFixed(2)}:1`);
  const d1 = hard[0].days.find((d) => d.label === "1");
  const d1pull = (d1.sections || []).flatMap((s) => s.exercises || []).filter((e) => bucket(e.name || "").includes("pull"));
  console.log(`  Day 1 pulling exercises: ${d1pull.length ? d1pull.map((e) => `${e.name} ${e.sets}x${e.reps}`).join(", ") : "NONE"}`);
}
