const A = require("../.balance.cjs").__t;
const PATTERNS = [
  ["Arms",             /triceps|curl(?! up)/i],
  ["Horizontal press", /bench|floor press|push-?up|dip|landmine punch|offset single arm dumbbell press|spoto|incline barbell press|chest pass/i],
  ["Vertical press",   /overhead press|shoulder press|landmine press|landmine rotational press|plate lifts/i],
  ["Horizontal pull",  /row|renegade|scarecrow|face pull|band pull-apart|y,? ?t,? ?w|zottman/i],
  ["Vertical pull",    /pull-?up|chin-?up|lat pulldown|toes to bar|dead hang/i],
  ["Squat",            /squat|leg press|step-?up|lunge|terminal knee extension/i],
  ["Hinge",            /deadlift|romanian|rdl|good morning|hip thrust|glute bridge|hamstring curl|valslide/i],
  ["Carry / grip",     /carry|pinch|farmer|bear-?hug|bar hold|kettlebell hold|static hold/i],
  ["Neck",             /neck/i],
  ["Adductor / groin", /copenhagen|adduction|clamshell/i],
  ["Trunk / anti-rot", /plank|pallof|abdominal|core|anti-rotation|hanging leg raise|hollow|dead ?bug|side bend/i],
  ["Jump / throw",     /jump|slam|throw|pogo|broad/i],
  ["Sprint / agility", /sprint|shuttle|agility/i],
  ["Conditioning",     /assault bike|treadmill|aerobic|zone 2|round/i],
];
const ORDER = ["Jump / throw","Sprint / agility","Squat","Hinge","Vertical pull","Horizontal pull",
  "Vertical press","Horizontal press","Arms","Carry / grip","Neck","Adductor / groin","Trunk / anti-rot","Conditioning"];
const bucket = (name) => {
  const n = String(name).replace(/\([^)]*\)/g, " ");
  for (const label of ORDER) { const r = PATTERNS.find((p) => p[0] === label); if (r && r[1].test(n)) return label; }
  return "Other";
};
for (const v of (process.argv[2] ? [process.argv[2]] : ["A", "B", "C", "D"])) {
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

// =============================================================================
// WHAT EACH WEEK ACTUALLY ASKS FOR
// =============================================================================
// Every session of every program, resolved the way the athlete's screen
// resolves it, then measured: hard sets, and the app's own time estimate.
// A readout, not a pass/fail — the judgement about whether it is too much
// belongs to whoever reads it.
const fakeClient = { blockNumber: 1, excludedExercises: [], injuryAreas: [] };
console.log("\n=============== SESSION LOAD, WEEK BY WEEK ===============");
for (const v of ["A", "B", "C", "D"]) {
  const p = A.buildProgramVariant(v);
  const perWeek = p.sessionsPerWeek || 3;
  const totalWeeks = Math.max(...p.phases.map((x) => x.weekEnd));
  console.log(`\n${A.PROGRAM_VARIANT_LABELS[v]} — ${perWeek} days a week, ${totalWeeks} weeks`);
  const weeks = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const row = { week: w, phase: "", days: [] };
    for (let d = 0; d < perWeek; d++) {
      const pos = A.positionAtIndex(p, (w - 1) * perWeek + d);
      row.phase = pos.phase.name;
      const sections = A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, A.resolveOptsFor(fakeClient));
      const sh = A.sessionShape(sections);
      row.days.push(sh);
    }
    weeks.push(row);
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log("   wk  " + pad("phase", 26) + weeks[0].days.map((_, i) => pad(`day ${i + 1}`, 12)).join("") + "  week total");
  weeks.forEach((r) => {
    const sets = r.days.reduce((n, d) => n + d.working, 0);
    const lift = r.days.reduce((n, d) => n + d.liftMinutes, 0);
    const cond = r.days.reduce((n, d) => n + d.conditioningMinutes, 0);
    console.log(`   ${pad(r.week, 3)} ` + pad(r.phase.slice(0, 25), 26)
      // lifting minutes, then conditioning after a plus — an easy Zone 2 ride
      // is not the same minutes as a set of squats and is not counted as them.
      + r.days.map((d) => pad(`${d.working}s ${d.liftMinutes}m${d.conditioningMinutes ? `+${d.conditioningMinutes}` : ""}`, 12)).join("")
      + `  ${sets} sets, ${lift} min lifting${cond ? ` + ${cond} min easy` : ""}`);
  });
  const all = weeks.flatMap((r) => r.days);
  const mins = all.map((d) => d.liftMinutes).sort((a, b) => a - b);
  const sets = all.map((d) => d.working).sort((a, b) => a - b);
  const med = (xs) => xs[Math.floor(xs.length / 2)];
  const hard = weeks.filter((r) => !/deload/i.test(r.phase));
  const hardMins = hard.map((r) => r.days.reduce((n, d) => n + d.liftMinutes, 0));
  console.log(`   lifting ${mins[0]}–${mins[mins.length - 1]} min a session (median ${med(mins)}), `
    + `${sets[0]}–${sets[sets.length - 1]} hard sets (median ${med(sets)})`);
  console.log(`   hard weeks ${Math.min(...hardMins)}–${Math.max(...hardMins)} min of lifting, `
    + `${hard.length} of ${totalWeeks} weeks hard`);
}

// --- weekly hard sets by movement pattern, averaged over the hard weeks ----
console.log("\n=============== WEEKLY HARD SETS BY PATTERN (hard weeks) ===============");
const rows = {};
for (const v of ["A", "B", "C", "D"]) {
  const p = A.buildProgramVariant(v);
  const perWeek = p.sessionsPerWeek || 3;
  const totalWeeks = Math.max(...p.phases.map((x) => x.weekEnd));
  const tally = {}; let hardWeeks = 0;
  for (let w = 1; w <= totalWeeks; w++) {
    const first = A.positionAtIndex(p, (w - 1) * perWeek);
    if (/deload/i.test(first.phase.name)) continue;
    hardWeeks++;
    for (let d = 0; d < perWeek; d++) {
      const pos = A.positionAtIndex(p, (w - 1) * perWeek + d);
      const secs = A.resolveDaySections(pos.day, pos.weekNumber, p, pos.phase, false, A.resolveOptsFor(fakeClient));
      secs.forEach((sec) => (sec.exercises || []).forEach((e) => {
        const b = bucket(e.name || "");
        const t2 = e.perSetTargets || null;
        const n = t2 ? t2.filter((x) => !/^(Warm-up|Build)$/.test(x.note || "")).length : (Number(e.sets) || 0);
        tally[b] = (tally[b] || 0) + n;
      }));
    }
  }
  rows[v] = {}; Object.keys(tally).forEach((k) => { rows[v][k] = tally[k] / hardWeeks; });
}
const labels = [...ORDER, "Other"].filter((l) => ["A", "B", "C", "D"].some((v) => rows[v][l]));
console.log("   " + "pattern".padEnd(20) + ["A", "B", "C", "D"].map((v) => v.padStart(7)).join(""));
labels.forEach((l) => console.log("   " + l.padEnd(20)
  + ["A", "B", "C", "D"].map((v) => (rows[v][l] ? rows[v][l].toFixed(1) : "–").padStart(7)).join("")));
