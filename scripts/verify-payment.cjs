// The money path, exercised rather than read. Run: node scripts/verify-payment.cjs
// Build the bundle first (see scripts/verify-payment.sh).
const { __t } = require("../.pay.cjs");
const { freeSessionsUsed, FREE_SESSION_LIMIT, positionAtIndex, buildClient, resolvePaid,
        PROGRAM_PRICE, PROMO_CODES } = __t;

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

console.log("\nWhat it costs");
// One number, used everywhere. A price written into a sentence somewhere is a
// price that stays at the old figure after it changes, and the first anybody
// hears about it is an athlete being asked for the wrong amount.
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
  const body = src.replace(/const PROGRAM_PRICE = \d+;/, "");
  const hardcoded = [...body.matchAll(/\$(\d+)\b/g)]
    .map((m) => m[1])
    .filter((n) => Number(n) >= 5 && Number(n) <= 500);
  check("the price is never written into a sentence",
    hardcoded.length ? hardcoded.join(", ") : "none", "none");
  // Nothing should be able to claim a discount that is not already on a
  // profile: the box is gone from sign-up and the codes are honoured, not
  // offered. A source check rather than a render, because this screen cannot
  // be mounted without an auth client — but it pins the thing that matters,
  // which is that nowhere asks for a code.
  // Asking is a label and a field. Reading one off an account that already
  // carries it is not asking, and that path has to keep working — so this
  // looks for the box, not for every mention of the word.
  check("sign-up does not ask for a promo code",
    /setPromoCode\(|Promo Code/.test(src) ? "it still asks" : "it does not", "it does not");
  // The box is gone, but a discount already attached to somebody is a promise
  // that was already made to them. Taking it back off quietly, because the
  // feature behind it was retired, is not a thing to do to a person.
  const held = buildClient({ id: "p1", firstName: "Ana", lastName: "Diaz", weight: 150,
    heightFeet: 5, heightInches: 4, beltLevel: "Blue", programVariant: "B",
    weeklySchedule: {}, waiver: { version: "x" }, promoDiscount: 5 });
  check("a discount already on a profile is still honoured",
    PROGRAM_PRICE - (held.promoDiscount || 0), PROGRAM_PRICE - 5);
  check("an athlete with no discount pays the flat price",
    PROGRAM_PRICE - (buildClient({ id: "p2", firstName: "Bo", lastName: "Li", weight: 150,
      heightFeet: 5, heightInches: 4, beltLevel: "White", programVariant: "B",
      weeklySchedule: {}, waiver: { version: "x" } }).promoDiscount || 0), PROGRAM_PRICE);
  check("the price is a positive whole number of dollars",
    Number.isInteger(PROGRAM_PRICE) && PROGRAM_PRICE > 0, true);
  // A discount that meets or beats the price leaves an athlete looking at a
  // payment screen asking for nothing, or for a negative amount. Promo codes
  // are edited by hand in a map, and the price has already moved once.
  const bad = Object.entries(PROMO_CODES || {}).filter(([, off]) => !(off > 0 && off < PROGRAM_PRICE));
  check(`every promo code leaves something to pay at $${PROGRAM_PRICE}`,
    bad.length ? bad.map(([c, off]) => `${c} takes $${off}`).join(", ") : "none", "none");
}

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
// loadActiveClient sets c.paid = resolvePaid(linkPaid, cachedFlag), so every
// other shape the server read can come back as has to leave the athlete
// blocked. These are the shapes that used to let somebody through.
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

// The read can fail, and an installed copy in a gym with no signal falls back
// to the last answer the server gave rather than locking a paying athlete out
// of a session. The whole security of that rests on one property: no cached
// value except a real `true` counts, and a real `true` can only be there
// because the server once said it. Sweep every combination.
console.log("\nPaid, decided from a live read and this device's last answer");
check("live yes, nothing cached", resolvePaid(true, undefined), true);
check("live yes beats a cached no", resolvePaid(true, false), true);
check("live no, nothing cached", resolvePaid(false, undefined), false);
check("live no overrides a cached yes — un-marking takes effect online",
  resolvePaid(false, true), false);
check("read failed, cached yes keeps a paid athlete training",
  resolvePaid(null, true), true);
check("read failed, cached no stays blocked", resolvePaid(null, false), false);
check("read failed, nothing cached stays blocked", resolvePaid(null, undefined), false);
check("read failed and the cache was never written stays blocked",
  resolvePaid(undefined, undefined), false);
// Anything that is not the boolean true must not count, however truthy.
check("no truthy cached junk opens the wall", (() => {
  const junk = ["true", 1, "yes", {}, [], " ", "1", Infinity, new Date()];
  return junk.every((v) => resolvePaid(null, v) === false);
})(), true);
check("no truthy live junk opens the wall either", (() => {
  const junk = ["true", 1, "yes", {}, [], "1"];
  return junk.every((v) => resolvePaid(v, false) === false);
})(), true);

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
