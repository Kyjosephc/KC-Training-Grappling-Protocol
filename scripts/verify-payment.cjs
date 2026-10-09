// The money path, exercised rather than read. Run: node scripts/verify-payment.cjs
// Build the bundle first (see scripts/verify-payment.sh).
const { __t } = require("../.pay.cjs");
const { freeSessionsUsed, FREE_SESSION_LIMIT, positionAtIndex, buildClient } = __t;

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${ok ? "" : `  (got ${got}, wanted ${want})`}`);
};

const athlete = (over = {}) => ({
  ...buildClient({ id: "a1", firstName: "Test", lastName: "Athlete", weight: 170,
    heightFeet: 5, heightInches: 10, beltLevel: "White", programVariant: "B",
    weeklySchedule: {}, waiver: { version: "x" } }),
  ...over,
});

// The gate an athlete meets. awaitingPayment in the app is
// isCurrent && freeSessionsUsed(client) && !client.paid — isCurrent is a view
// position, so the rule worth testing is the other two clauses.
const blocked = (c) => freeSessionsUsed(c) && !c.paid;

console.log("\nFree sessions, then the ask");
check("brand new athlete trains free", blocked(athlete({ sessionsCompleted: 0, logs: [] })), false);
check("after 1 session still free", blocked(athlete({ sessionsCompleted: 1, logs: [{}] })), false);
check("after 2 sessions still free", blocked(athlete({ sessionsCompleted: 2, logs: [{}, {}] })), false);
check(`after ${FREE_SESSION_LIMIT} sessions the ask appears`,
  blocked(athlete({ sessionsCompleted: 3, logs: [{}, {}, {}] })), true);

console.log("\nWays to try to get out of it");
check("skipping ahead without logging anything is still caught",
  blocked(athlete({ sessionsCompleted: 30, logs: [] })), true);
check("skipping back to day 0 after logging the free week is still caught",
  blocked(athlete({ sessionsCompleted: 0, logs: [{}, {}, {}] })), true);
check("a record claiming six sessions a week gets no extra free ones", (() => {
  const c = athlete({ sessionsCompleted: 3, logs: [{}, {}, {}] });
  c.program = { ...c.program, sessionsPerWeek: 6 };
  return blocked(c);
})(), true);
// Sweep it. The athlete owns their own record, so sessionsPerWeek is a number
// they can set to anything; no value of it may buy a fourth free session.
// (Setting it low shortens their own trial, which is their business.)
check("no sessionsPerWeek value buys a 4th free session", (() => {
  for (let per = 1; per <= 14; per++) {
    const c = athlete({ sessionsCompleted: 3, logs: [{}, {}, {}] });
    c.program = { ...c.program, sessionsPerWeek: per };
    if (!blocked(c)) return false;
  }
  return true;
})(), true);

console.log("\nOnce the coach marks them paid it is permanent");
const paid = (over) => blocked(athlete({ paid: true, ...over }));
check("paid, mid block one", paid({ sessionsCompleted: 5, logs: [{}, {}, {}, {}, {}] }), false);
check("paid, last session of block one", paid({ sessionsCompleted: 35, logs: Array(35).fill({}) }), false);
check("paid, through a program restart (day back to 0, block 2)",
  paid({ sessionsCompleted: 0, blockNumber: 2, logs: Array(36).fill({}) }), false);
check("paid, deep into block 2", paid({ sessionsCompleted: 20, blockNumber: 2, logs: Array(56).fill({}) }), false);
check("paid, block 5, a year in", paid({ sessionsCompleted: 11, blockNumber: 5, logs: Array(155).fill({}) }), false);

console.log("\nOnly an explicit yes opens the wall");
// loadActiveClient sets c.paid = (linkPaid === true), so every other shape the
// server read can come back as has to leave the athlete blocked. These are the
// shapes that used to let somebody through.
const spent = { sessionsCompleted: 3, logs: [{}, {}, {}] };
check("a brand new athlete starts out not paid", athlete().paid, false);
check("paid missing from the record blocks", blocked(athlete({ ...spent, paid: undefined })), true);
check("paid false blocks", blocked(athlete({ ...spent, paid: false })), true);
check("a failed read (null) blocks", blocked(athlete({ ...spent, paid: null })), true);
// The gate itself only asks whether paid is truthy, so a junk truthy value
// would open it. That is exactly why loadActiveClient assigns
// `c.paid = (linkPaid === true)` and never the raw read: the normalising is
// what makes the two checks above hold, and this records the dependency.
check("any truthy paid opens the gate — hence the === true on the way in",
  blocked(athlete({ ...spent, paid: "anything" })), false);
check("a real true opens it", blocked(athlete({ ...spent, paid: true })), false);

console.log("\nRestarting the program is not a fresh free week for the unpaid");
check("unpaid, restarted to day 0 with a block of logs behind them",
  blocked(athlete({ sessionsCompleted: 0, blockNumber: 2, logs: Array(36).fill({}) })), true);

console.log("\nThe week maths the gate leans on");
const prog = athlete().program;
check("day 0 is week 1", positionAtIndex(prog, 0).weekNumber, 1);
check("day 2 is week 1", positionAtIndex(prog, 2).weekNumber, 1);
check("day 3 is week 2", positionAtIndex(prog, 3).weekNumber, 2);

console.log(failed === 0 ? "\nAll payment checks passed.\n" : `\n${failed} payment check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
