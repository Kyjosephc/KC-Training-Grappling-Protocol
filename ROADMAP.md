# Strength Matrix — where to go next

Written after driving three simulated athletes through the real code for 26
weeks: 175 logged sessions, every one of them produced by the app's own
`positionAtIndex` → `resolveDaySections` → `adjustSectionsForReadiness` →
`sessionShape` chain rather than by guesswork.

**The app did not break once.** No crash, no bad position, no lost log, no
readiness or injury path that threw. Deloads fired on schedule and really did
cut the work. In-progress sessions are kept in `localStorage`, so a dropped
connection mid-workout does not cost anybody their sets. The competition taper
works. That is a solid foundation and most of what follows is about depth, not
repair.

The athletes:

| | Program | Belt | BJJ/wk | Adherence | Sessions logged | Finished in |
|---|---|---|---|---|---|---|
| Marcus | A | Blue | 5× | 92% | 69 of 78 | block 2 |
| Dani | B | White | 3× | 62% | 51 of 78 | block 2 |
| Theo | A | Purple | 4× | 75% (3 weeks off) | 55 of 78 | block 2 |

---

## 1. Month four is where this app currently ends

Both programs are 12 weeks and 36 sessions. Every athlete I ran finished the
program between week 14 and week 18 and spent the rest of the six months on a
second pass.

Program A handles this reasonably: `resolveExercise` folds `blockNumber` into
the rotation offset, so **54 of 214 exercise slots change on block 2** — a
quarter of the work is new. Box Squat becomes Front Squat, Speed Bench becomes
Speed Floor Press.

**Program B changes 0 of 282 slots.** It is bit-for-bit the same twelve weeks
again, and Program B is the default variant for anyone who does not pick one
(`buildClient` falls back to `"B"`). A new athlete who signs up, trains for six
months, and never changes anything does the same 28 exercises at the same
percentages twice in a row.

This is the single biggest thing to fix. The cheapest version is to give
Program B the rotating pools Program A already has — the machinery exists and is
tested. The better version is a third block that is genuinely different in
emphasis, so the year reads as base → build → peak rather than loop → loop.

## 2. Program B has no progression inside a block

Measured top percentage by week:

```
Program A    wk1-3: 100% / 100% / 100%   wk5-7: 100% / 100% / 88%   wk9-11: 100% / 100% / 88%
Program B    wk1-3:  80% /  80% /  80%   wk5-7:  85% /  85% /  85%  wk9-11:  85% /  85% /  85%
```

Program A is a proper conjugate: a new max-effort lift every two weeks, worked to
a true top set, so progress comes from the lift rotating rather than the
percentage climbing. That is coherent.

Program B asks for 80% for three straight weeks, then 85% for six. Within a
block there is nothing to chase. Three weeks at an identical percentage is three
weeks of the same session. A simple 75/80/85 or 80/82.5/85 wave inside each
three-week block would fix it without touching anything else, and would make the
deload feel earned.

The deloads themselves are real and well judged — Program A drops 67 working
sets to 17, Program B drops 71 to 36. No change needed.

## 3. Four exercises in five never tell the athlete what to lift

| | Slots with a usable %-of-1RM | Share |
|---|---|---|
| Program A | 42 of 202 | 21% |
| Program B | 47 of 270 | 17% |

The rest carry a word: `moderate` (41×), `light` (33×), `autoregulated` (24×),
or nothing at all (219 slots in Program B). The app has the machinery to turn a
percentage into a number — `targetWeight` in the logging screen multiplies the
athlete's best logged e1RM by the prescribed percentage and prints "try about
185 lb" — and it is excellent where it fires. It just does not fire four times
out of five. It also needs a prior logged best, so in week one a brand-new
athlete gets no number anywhere.

Two things would change the experience more than anything else in this document:

**Suggest a weight for every loaded exercise, not just the percentage-based
ones.** For accessories you do not need a percentage — you need last week. "Last
time: 3 × 8 at 55 lb. Try 60." The data is already there; `lastWeekBest` is
already computed and displayed as a read-only line. Turn that line into a
suggestion and prefill the box.

**Ask for three or four starting numbers during onboarding** — a rough squat,
bench, deadlift and overhead press, or an honest "I don't know" that routes them
to a first-week testing session. Right now week one is a blank sheet for a
beginner, which is exactly the person least able to fill it in.

## 4. Six months of data, and the app says almost nothing about it

Marcus finished with 69 sessions, 1.6 million pounds moved and a 176 KB training
history. What the app shows him for that is a volume chart, a heatmap, and a
leaderboard figure reading **"8,816×"**.

That number is `total volume ÷ bodyweight` accumulated forever
(`leaderboardTotalsFor`), and it grows without bound. Nobody can hold "8,816×" in
their head or feel anything about it. The weekly figure is defensible; the
all-time one should be replaced with something a person can picture — total
tonnage with a comparison ("that's 11 cars"), or best-ever week, or current
streak.

More importantly, nothing in the app tells an athlete **what got stronger**. You
hold six months of e1RM per exercise. A month-six screen that says "your trap bar
deadlift e1RM is up 18% since January, your bench is flat, your neck work has
been consistent 22 weeks running" is the thing that renews a subscription. The
raw material is all in `logs`; none of it is being turned into a verdict.

## 5. The money is the weakest link in the business

There is no way to pay inside the app. An athlete hits the paywall at week two,
and then both of you wait on something happening outside the product before you
flip the flag by hand. At five clients that is fine. At fifty it is a job, and
every missed flip is someone locked out of a program they paid for.

Stripe Payment Links are the smallest honest fix: one hosted link, a webhook
that sets `client_links.paid`, done. Until that exists, at minimum the paywall
screen should tell the athlete exactly how to pay and roughly how long it takes
to be unlocked, so the silence is not mistaken for a bug.

Related: there is no way for an athlete to delete their own account and data.
`resetAppData` wipes every client record for the signed-in user but is framed as
a reset, and nothing removes the leaderboard row, group posts or `client_links`
entry. Taking public money makes a real "delete my account" a legal expectation,
not a nicety. Data export already exists, which is the harder half.

## 6. Volume against a real training week

| | Lifting | Mat time | Total |
|---|---|---|---|
| Marcus (A, BJJ 5×) | 2.3 h/wk | 7.5 h | 9.8 h |
| Dani (B, BJJ 3×) | 2.8 h/wk | 4.5 h | 7.3 h |
| Theo (A, BJJ 4×) | 2.4 h/wk | 6.0 h | 8.4 h |

Program A runs 160–185 min/week across three sessions, Program B 185–210. For an
athlete on the mat five times a week, Program B's 71–74 working sets and 28–29
exercises per week is the heavier end of defensible, and it is the one beginners
get by default. Worth considering a declared "3× BJJ" and "5× BJJ" setting at
signup that trims accessory volume for the busier athlete — `trimAccessoryVolume`
already exists and could simply be applied harder.

## 7. Smaller things worth doing

**The technique library launches empty.** Post fifteen or twenty named clips
before launch. A library with nothing in it and a search box that finds nothing
is worse than no library.

**Uploaded clips all render as identical black 16:9 rectangles.** Ten clips look
like ten of the same thing. A captured first frame would fix it.

**Reports go nowhere you will reliably see.** Once 25 newer posts arrive the
flagged one falls off the page. A solo operator needs a queue, not a flag.

**Replies cannot be reported or liked at all** — anything ugly posted as a reply
has no athlete-side escalation.

**The notifications row is four UI states that mostly apologise**, undeliverable
on iPhone, and drives a second polling loop. Cut it.

**One JSON blob, rewritten on every save.** 176 KB at six months, growing
linearly, written in full every time a set is logged. It works now; at two years
and a few hundred athletes it is the thing that will start timing out on gym
wifi. Splitting `logs` into their own append-only table is the eventual answer.

---

## If you only do five things

1. Give Program B rotating pools so month four is not month one again.
2. Wave the percentages inside each Program B block.
3. Suggest a working weight on every loaded exercise, from last week's log.
4. Build a month-six progress verdict — what actually got stronger.
5. Take payment inside the app.
