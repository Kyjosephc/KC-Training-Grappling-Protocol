import React, { useState, useMemo, useCallback } from "react";
import { Trophy, ChevronRight, Check, X, Info, BookOpen, Zap, BarChart3, RotateCcw, Flame, Gavel } from "lucide-react";
import { RULESETS, RULESET_IDS, COMPARE_ROWS, DISCLAIMER } from "./rules/rulesets.js";
import { buildQuestionBank, pickQuestions, rankFor, buildMatch, REF_POINT_CHOICES } from "./rules/engine.js";
import { REQUIREMENTS, HOLD_SECONDS, SCENES } from "./rules/requirements.js";

const BANK = buildQuestionBank();
const XP_RIGHT = 10, XP_STREAK_BONUS = 5;

// Progress lives on the athlete's own record, like everything else they log.
export function emptyRulesProgress() {
  return {
    xp: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0, topics: {}, lastSeen: null,
    // Question ids they have got wrong, each with how many more times it should
    // come back. Getting one right in a review takes one off; getting it wrong
    // again puts it back to full.
    missed: {},
    // Days in a row with at least one answer. lastSeen was already written on
    // every answer and never read by anything.
    dayStreak: 0, bestDayStreak: 0,
  };
}
const REVIEW_TIMES = 2;
const todayStamp = () => new Date().toISOString().slice(0, 10);
function dayStreakAfter(progress) {
  const today = todayStamp();
  if (progress.lastSeen === today) return progress.dayStreak || 1;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (progress.lastSeen === yesterday) return (progress.dayStreak || 0) + 1;
  return 1;
}
const missedIds = (progress) => Object.keys(progress.missed || {});
function topicStats(progress) {
  return Object.entries(progress.topics || {})
    .map(([t, v]) => ({ topic: t, pct: v.n ? Math.round((v.ok / v.n) * 100) : 0, n: v.n }))
    .filter((x) => x.n >= 2).sort((a, b) => a.pct - b.pct);
}
const TOPIC_LABEL = {
  takedown: "Takedowns", sweep: "Sweeps", guardPass: "Guard passing", mount: "Mount",
  backControl: "Back control", backMount: "Back mount", kneeOnBelly: "Knee on belly",
  sideControl: "Side control", sequence: "Scoring sequences", special: "Special situations",
  advantages: "Advantages", penalties: "Penalties", duration: "Match times",
  cleanTakedown: "Clean takedowns", cleanSweep: "Clean sweeps", submissionAttempt: "Submission attempts",
};
const tLabel = (t) => TOPIC_LABEL[t] || t;

export default function RulesGame({ progress, onProgress }) {
  const p = progress || emptyRulesProgress();
  const [view, setView] = useState("home");
  const [ruleset, setRuleset] = useState("all");
  const [quiz, setQuiz] = useState(null);
  const [match, setMatch] = useState(null);

  const weak = useMemo(() => topicStats(p).filter((x) => x.pct < 70).map((x) => x.topic), [p]);
  const rank = rankFor(p.xp);
  const accuracy = p.answered ? Math.round((p.correct / p.answered) * 100) : 0;

  const startQuiz = useCallback((rsId, count, difficulty, minDifficulty, opts = {}) => {
    const qs = pickQuestions(BANK, {
      ruleset: rsId, count, difficulty, minDifficulty, weakTopics: weak,
      reviewIds: opts.onlyReview ? missedIds(p) : (opts.noReview ? [] : missedIds(p)),
      seed: Date.now(),
    });
    setQuiz({ qs, i: 0, picked: null, right: 0, showWhy: false, wrong: [] });
    setView("quiz");
  }, [weak, p]);

  const startMatch = useCallback((rsId) => {
    const id = rsId === "all" ? "ibjjf" : rsId;
    setMatch({ ...buildMatch(id, Date.now()), i: 0, picked: null, calls: [] });
    setView("ref");
  }, []);

  const answer = (choice) => {
    if (!quiz || quiz.picked) return;
    const q = quiz.qs[quiz.i];
    const ok = choice === q.answer;
    const next = { ...p };
    next.answered += 1;
    next.correct += ok ? 1 : 0;
    next.streak = ok ? next.streak + 1 : 0;
    next.bestStreak = Math.max(next.bestStreak || 0, next.streak);
    next.xp += ok ? XP_RIGHT + (next.streak >= 3 ? XP_STREAK_BONUS : 0) : 0;
    const t = next.topics[q.topic] || { n: 0, ok: 0 };
    next.topics = { ...next.topics, [q.topic]: { n: t.n + 1, ok: t.ok + (ok ? 1 : 0) } };
    // The question itself is what comes back, not merely its topic.
    const missed = { ...(next.missed || {}) };
    if (ok) {
      if (missed[q.id] !== undefined) {
        const left = missed[q.id] - 1;
        if (left <= 0) delete missed[q.id]; else missed[q.id] = left;
      }
    } else {
      missed[q.id] = REVIEW_TIMES;
    }
    next.missed = missed;
    next.dayStreak = dayStreakAfter(next);
    next.bestDayStreak = Math.max(next.bestDayStreak || 0, next.dayStreak);
    next.lastSeen = todayStamp();
    onProgress(next);
    setQuiz({
      ...quiz, picked: choice, right: quiz.right + (ok ? 1 : 0),
      wrong: ok ? quiz.wrong : [...(quiz.wrong || []), { ...q, picked: choice }],
    });
  };

  const nextQ = () => {
    if (quiz.i + 1 >= quiz.qs.length) { setView("result"); return; }
    setQuiz({ ...quiz, i: quiz.i + 1, picked: null, showWhy: false });
  };

  // ---------- QUIZ ----------
  if (view === "quiz" && quiz) {
    const q = quiz.qs[quiz.i];
    const rs = RULESETS[q.ruleset];
    return (
      <div className="pad">
        <div className="rg-bar">
          <button className="link-btn" onClick={() => setView("home")}>Quit</button>
          <span>{quiz.i + 1} of {quiz.qs.length}</span>
          <span className="rg-streak">{p.streak > 0 ? `${p.streak} in a row` : ""}</span>
        </div>
        <div className="rg-progress"><div className="rg-progress-fill" style={{ width: `${((quiz.i) / quiz.qs.length) * 100}%` }} /></div>

        <div className="rg-card">
          <div className="rg-tag">{rs ? rs.name : "Compare rulesets"}</div>
          <p className="rg-prompt">{q.prompt}</p>
          <div className="rg-options">
            {q.options.map((o) => {
              const picked = quiz.picked === o;
              const isAnswer = o === q.answer;
              const state = !quiz.picked ? "" : isAnswer ? " right" : picked ? " wrong" : " dim";
              return (
                <button key={o} className={`rg-option${state}`} disabled={!!quiz.picked} onClick={() => answer(o)}>
                  <span>{o}</span>
                  {quiz.picked && isAnswer && <Check size={16} />}
                  {quiz.picked && picked && !isAnswer && <X size={16} />}
                </button>
              );
            })}
          </div>

          {quiz.picked && (
            <div className={`rg-explain${quiz.picked === q.answer ? " ok" : ""}`}>
              <strong>{quiz.picked === q.answer ? "Correct." : `Not quite — the answer is ${q.answer}.`}</strong>
              <p>{q.why}</p>
              {q.wrong && q.wrong[quiz.picked] && <p className="rg-wrongnote">Why {quiz.picked} is wrong: {q.wrong[quiz.picked]}</p>}
              <button className="link-btn" onClick={() => setQuiz({ ...quiz, showWhy: !quiz.showWhy })}>
                {quiz.showWhy ? "Hide the rule" : "Why? Show the rule"}
              </button>
              {quiz.showWhy && <p className="rg-cite">{q.cite}</p>}
              <button className="btn-primary wide" style={{ marginTop: 12 }} onClick={nextQ}>
                {quiz.i + 1 >= quiz.qs.length ? "Finish" : "Next"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- RESULT ----------
  if (view === "result" && quiz) {
    const pct = Math.round((quiz.right / quiz.qs.length) * 100);
    return (
      <div className="pad">
        <div className="rg-result">
          <Trophy size={34} color="var(--accent)" />
          <div className="rg-big">{quiz.right} / {quiz.qs.length}</div>
          <div className="muted">{pct}% on this round</div>
          <div className="rg-rank">{rank.name}{rank.next ? ` · ${rank.toNext} XP to ${rank.next.name}` : ""}</div>
        </div>
        {(quiz.wrong || []).length > 0 ? (
          <>
            <div className="rg-review-head">What you missed</div>
            {quiz.wrong.map((q) => (
              <div key={q.id} className="rg-review">
                <div className="rg-review-q">{q.prompt}</div>
                <div className="rg-review-line bad"><X size={13} /> You said {q.picked}</div>
                <div className="rg-review-line good"><Check size={13} /> {q.answer}</div>
                <p className="rg-review-why">{q.why}</p>
                {q.wrong && q.wrong[q.picked] && <p className="rg-review-why dim">{q.wrong[q.picked]}</p>}
                <div className="rg-review-foot">
                  <span className="rg-cite">{q.cite}</span>
                  {q.ruleset && RULESETS[q.ruleset] && (
                    <button className="link-btn" onClick={() => { setRuleset(q.ruleset); setView("learn"); }}>Read the rule</button>
                  )}
                </div>
              </div>
            ))}
            <div className="adjust-box" style={{ marginBottom: 12 }}>
              {quiz.wrong.length === 1 ? "This one comes" : `These ${quiz.wrong.length} come`} back in your next couple of rounds until you have them.
            </div>
          </>
        ) : (
          <div className="adjust-box" style={{ marginBottom: 12, borderColor: "var(--green)" }}>
            Clean round — nothing missed.
          </div>
        )}
        {topicStats(p).filter((x) => x.pct < 70).length > 0 && (
          <div className="adjust-box" style={{ marginBottom: 12 }}>
            <strong>Worth drilling:</strong> {topicStats(p).filter((x) => x.pct < 70).slice(0, 3).map((x) => `${tLabel(x.topic)} (${x.pct}%)`).join(", ")}. These come up more often from now on.
          </div>
        )}
        <button className="btn-primary wide" onClick={() => startQuiz(ruleset, 10, 3)}>Another round</button>
        <button className="btn-ghost wide" onClick={() => setView("home")}>Back</button>
      </div>
    );
  }

  // ---------- REFEREE ----------
  // One exchange at a time, and the only question is the one a referee has to
  // answer in the moment: how many is that worth? The running score is theirs
  // to keep, not the app's to show.
  if (view === "ref" && match) {
    const done = match.i >= match.events.length;
    const ev = done ? null : match.events[match.i];

    if (done) {
      const right = match.calls.filter((c) => c.ok).length;
      const yourBlue = match.calls.reduce((n, c) => n + (c.who === "Blue" ? c.said : 0), 0);
      const yourWhite = match.calls.reduce((n, c) => n + (c.who === "White" ? c.said : 0), 0);
      const cardRight = yourBlue === match.finalBlue && yourWhite === match.finalWhite;
      return (
        <div className="pad">
          <div className="rg-result">
            <Gavel size={30} color="var(--accent)" />
            <div className="rg-big">{right} / {match.events.length}</div>
            <div className="muted">calls correct · {match.rulesetName}</div>
          </div>
          <div className={`rg-card-compare ${cardRight ? "ok" : "off"}`}>
            <div>
              <span>Your card</span>
              <strong>Blue {yourBlue} — {yourWhite} White</strong>
            </div>
            <div>
              <span>The real score</span>
              <strong>Blue {match.finalBlue} — {match.finalWhite} White</strong>
            </div>
          </div>
          <div className="rg-review-head">Every exchange, and why</div>
          {match.events.map((e, i) => {
            const call = match.calls[i];
            return (
              <div key={i} className={`rg-review ${call && call.ok ? "ok" : ""}`}>
                <div className="rg-review-q">{e.text}</div>
                <div className={`rg-review-line ${call && call.ok ? "good" : "bad"}`}>
                  {call && call.ok ? <Check size={13} /> : <X size={13} />}
                  You gave {call ? call.said : 0} — the correct call is {e.points}
                  {e.points > 0 ? ` to ${e.who}` : ", no points"}
                </div>
                <p className="rg-review-why">{e.why}</p>
                <span className="rg-cite">{e.cite}</span>
              </div>
            );
          })}
          <button className="btn-primary wide" onClick={() => startMatch(match.ruleset)}>Another match</button>
          <button className="btn-ghost wide" onClick={() => { setMatch(null); setView("home"); }}>Back</button>
        </div>
      );
    }

    const picked = match.picked;
    return (
      <div className="pad">
        <div className="rg-quiz-top">
          <span className="rg-progress">Exchange {match.i + 1} of {match.events.length} · {match.rulesetName} rules</span>
          <button className="link-btn" onClick={() => { setMatch(null); setView("home"); }}>Quit</button>
        </div>
        <div className="rg-scorecard-label">The card you are keeping</div>
        <div className="rg-scorecard">
          <div><span>Blue</span><strong>{match.calls.reduce((n, c) => n + (c.who === "Blue" ? c.said : 0), 0)}</strong></div>
          <div><span>White</span><strong>{match.calls.reduce((n, c) => n + (c.who === "White" ? c.said : 0), 0)}</strong></div>
        </div>
        <p className="rg-control-rule">{match.controlRule}</p>
        <div className="rg-ref-event">{ev.text}</div>
        <p className="rg-ref-ask">{ev.question}</p>
        {REF_POINT_CHOICES.map((n) => {
          const chosen = picked === n;
          const isRight = n === ev.points;
          const cls = picked == null ? "" : isRight ? " right" : chosen ? " wrong" : "";
          return (
            <button key={n} className={`rg-option${cls}`} disabled={picked != null}
              onClick={() => setMatch({ ...match, picked: n })}>
              {n === 0 ? "No points" : `${n} points`}
            </button>
          );
        })}
        {picked != null && (
          <>
            <div className={`adjust-box ${picked === ev.points ? "" : ""}`} style={{ marginTop: 12, borderColor: picked === ev.points ? "var(--green)" : "var(--amber)" }}>
              <strong>{picked === ev.points
                ? "Correct."
                : ev.points === 0
                  ? "Nothing is awarded here."
                  : `It is ${ev.points} to ${ev.who}.`}</strong> {ev.why}
              <div className="rg-cite" style={{ marginTop: 6 }}>{ev.cite}</div>
            </div>
            <button className="btn-primary wide" onClick={() => {
              const call = { who: ev.who, said: picked, ok: picked === ev.points };
              setMatch({ ...match, i: match.i + 1, picked: null, calls: [...match.calls, call] });
            }}>{match.i + 1 >= match.events.length ? "See the card" : "Next exchange"}</button>
          </>
        )}
      </div>
    );
  }

  // ---------- COMPARE ----------
  if (view === "compare") {
    return (
      <div className="pad">
        <button className="link-btn" onClick={() => setView("home")}>Back</button>
        <h2 className="program-title" style={{ marginTop: 8 }}>Side by side</h2>
        <p className="muted" style={{ fontSize: 12.5 }}>The same action, scored four different ways. This is the part that costs people matches when they cross over.</p>
        <div className="rg-table-wrap">
          <table className="rg-table">
            <thead><tr><th>Action</th>{RULESET_IDS.map((id) => <th key={id}>{RULESETS[id].name}</th>)}</tr></thead>
            <tbody>
              {COMPARE_ROWS.map((row) => {
                const vals = RULESET_IDS.map((id) => RULESETS[id].scoring[row.key]);
                const nums = vals.map((s) => (s && s.points != null ? s.points : null));
                const differs = new Set(nums.map(String)).size > 1;
                return (
                  <tr key={row.key} className={differs ? "rg-differs" : ""}>
                    <td>{row.label}</td>
                    {nums.map((n, i) => <td key={i} className="rg-num">{n == null ? "—" : n}</td>)}
                  </tr>
                );
              })}
              <tr className="rg-differs">
                <td>Advantages</td>
                {RULESET_IDS.map((id) => <td key={id} className="rg-num">{RULESETS[id].advantages.used ? "Yes" : "No"}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Highlighted rows are where the rule sets disagree. “—” means the action scores nothing under that ruleset.</p>
      </div>
    );
  }

  // ---------- LEARN ----------
  if (view === "learn") {
    const rs = RULESETS[ruleset === "all" ? "ibjjf" : ruleset];
    return (
      <div className="pad">
        <button className="link-btn" onClick={() => setView("home")}>Back</button>
        <h2 className="program-title" style={{ marginTop: 8 }}>{rs.longName}</h2>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>{rs.version} · {rs.effective}</p>
        <p className="muted" style={{ fontSize: 11.5, marginBottom: 14 }}>Source: {rs.source} · checked {rs.checked}</p>

        <div className="rg-chiprow">
          {RULESET_IDS.map((id) => (
            <button key={id} className={`tech-suggest${ruleset === id ? " on" : ""}`} onClick={() => setRuleset(id)}>{RULESETS[id].name}</button>
          ))}
        </div>

        <div className="rg-holdbox">
          <strong>{HOLD_SECONDS[rs.id] ? HOLD_SECONDS[rs.id].n : 3} seconds</strong>
          <span>{HOLD_SECONDS[rs.id] ? HOLD_SECONDS[rs.id].rule : ""}</span>
        </div>

        <Card2 title="Scoring">
          {Object.entries(rs.scoring).map(([k, s]) => s && (
            <div key={k} className="rg-rule">
              <div className="rg-rule-head"><span>{tLabel(k)}</span><strong>{s.points == null ? "No points" : s.points}</strong></div>
              {SCENES[rs.id] && SCENES[rs.id][k] && <div className="rg-scene">{SCENES[rs.id][k]}</div>}
              <div className="muted">{s.control} <span className="rg-cite-inline">{s.cite}</span></div>
            </div>
          ))}
        </Card2>

        {REQUIREMENTS[rs.id] && (
          <Card2 title="What actually counts">
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
              Knowing a mount is {rs.scoring.mount ? rs.scoring.mount.points : 4} is the easy half. This is the half that decides matches.
            </p>
            {Object.entries(REQUIREMENTS[rs.id]).map(([pos, r]) => (
              <div key={pos} className="rg-req">
                <div className="rg-req-head">{tLabel(pos)}</div>
                <ul className="rg-must">{r.must.map((x, i) => <li key={i}>{x}</li>)}</ul>
                {r.notPoints.length > 0 && (
                  <ul className="rg-not">{r.notPoints.map((x, i) => (
                    <li key={i}>
                      <span className={`rg-verdict ${x.verdict}`}>{x.verdict === "advantage" ? "Advantage only" : "Scores nothing"}</span>
                      {x.why}
                    </li>
                  ))}</ul>
                )}
                <span className="rg-cite-inline">{r.cite}</span>
              </div>
            ))}
          </Card2>
        )}

        <Card2 title="Advantages">
          <p className="muted">{rs.advantages.rule} <span className="rg-cite-inline">{rs.advantages.cite}</span></p>
        </Card2>

        <Card2 title="Penalties">
          {rs.penalties.ladder.map((l, i) => <div key={i} className="rg-rule"><div className="muted">{l}</div></div>)}
          <p className="muted" style={{ marginTop: 8 }}>{rs.penalties.stalling} <span className="rg-cite-inline">{rs.penalties.cite}</span></p>
        </Card2>

        <Card2 title="Match times">
          {rs.durations.map((d, i) => (
            <div key={i} className="rg-rule"><div className="rg-rule-head"><span>{d.division}</span><strong>{d.time}</strong></div></div>
          ))}
          <p className="muted" style={{ marginTop: 6 }}><span className="rg-cite-inline">{rs.durationCite}</span></p>
        </Card2>

        <Card2 title="If the score is level">
          <ol className="rg-ol">{rs.tiebreak.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </Card2>

        <Card2 title="The situations people get wrong">
          {rs.specials.map((sp, i) => (
            <div key={i} className="rg-rule">
              <div className="rg-rule-head"><span>{sp.k}</span></div>
              <div className="muted">{sp.v} <span className="rg-cite-inline">{sp.cite}</span></div>
            </div>
          ))}
        </Card2>
      </div>
    );
  }

  // ---------- STATS ----------
  if (view === "stats") {
    const stats = topicStats(p);
    return (
      <div className="pad">
        <button className="link-btn" onClick={() => setView("home")}>Back</button>
        <h2 className="program-title" style={{ marginTop: 8 }}>Your rules IQ</h2>
        <div className="stat-chip-row" style={{ marginBottom: 14 }}>
          <StatChip2 label="Rules IQ" value={String(p.xp)} />
          <StatChip2 label="Accuracy" value={p.answered ? `${accuracy}%` : "—"} />
          <StatChip2 label="Best streak" value={String(p.bestStreak || 0)} />
        </div>
        <Card2 title="By area">
          {stats.length === 0 ? <p className="muted">Answer a few rounds and your weak areas show up here.</p>
            : stats.map((x) => (
              <div key={x.topic} className="rg-rule">
                <div className="rg-rule-head"><span>{tLabel(x.topic)}</span><strong>{x.pct}%</strong></div>
                <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${x.pct}%` }} /></div>
              </div>
            ))}
        </Card2>
      </div>
    );
  }

  // ---------- HOME ----------
  return (
    <div className="pad">
      <h2 className="program-title">Rules Game</h2>
      <p className="muted" style={{ fontSize: 12.5 }}>Know exactly how your match is scored before you step on the mat.</p>

      <div className="rg-hero">
        <div>
          <div className="rg-rank-big">{rank.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {p.xp} Rules IQ{rank.next ? ` · ${rank.toNext} to ${rank.next.name}` : " · top rank"}
          </div>
        </div>
        <div className="rg-hero-stats">
          <div><strong>{p.answered ? `${accuracy}%` : "—"}</strong><span>accuracy</span></div>
          <div><strong>{p.bestStreak || 0}</strong><span>best run</span></div>
          <div><strong>{p.lastSeen === todayStamp() ? (p.dayStreak || 1) : 0}</strong><span>day streak</span></div>
        </div>
      </div>

      <div className="rg-chiprow">
        <button className={`tech-suggest${ruleset === "all" ? " on" : ""}`} onClick={() => setRuleset("all")}>All</button>
        {RULESET_IDS.map((id) => (
          <button key={id} className={`tech-suggest${ruleset === id ? " on" : ""}`} onClick={() => setRuleset(id)}>{RULESETS[id].name}</button>
        ))}
      </div>

      {p.lastSeen !== todayStamp() && (p.dayStreak || 0) > 0 && (
        <div className="rg-streak-nudge">
          <Flame size={14} />
          <span>{p.dayStreak} day{p.dayStreak === 1 ? "" : "s"} in a row. One round today keeps it.</span>
        </div>
      )}

      <button className="rg-mode" onClick={() => startQuiz(ruleset, 10, 3)}>
        <Zap size={18} /><div><strong>Five-minute drill</strong><span>10 questions, mixed difficulty</span></div><ChevronRight size={16} />
      </button>
      {missedIds(p).length > 0 && (
        <button className="rg-mode" onClick={() => startQuiz(ruleset, Math.min(10, missedIds(p).length), 3, undefined, { onlyReview: true })}>
          <RotateCcw size={18} /><div><strong>Put it right</strong><span>{missedIds(p).length} question{missedIds(p).length === 1 ? "" : "s"} you have got wrong</span></div><ChevronRight size={16} />
        </button>
      )}
      <button className="rg-mode" onClick={() => startMatch(ruleset)}>
        <Gavel size={18} /><div><strong>You are the referee</strong><span>Score a match as it happens, then check your card</span></div><ChevronRight size={16} />
      </button>
      <button className="rg-mode" onClick={() => startQuiz(ruleset, 5, 1)}>
        <BookOpen size={18} /><div><strong>Basics</strong><span>5 questions, scoring values only</span></div><ChevronRight size={16} />
      </button>
      <button className="rg-mode" onClick={() => startQuiz(ruleset, 10, 3, 2)}>
        <Trophy size={18} /><div><strong>Hard round</strong><span>Sequences and the situations people lose on</span></div><ChevronRight size={16} />
      </button>
      <button className="rg-mode" onClick={() => setView("compare")}>
        <BarChart3 size={18} /><div><strong>Side by side</strong><span>All four rule sets on one screen</span></div><ChevronRight size={16} />
      </button>
      <button className="rg-mode" onClick={() => { if (ruleset === "all") setRuleset("ibjjf"); setView("learn"); }}>
        <Info size={18} /><div><strong>The rules themselves</strong><span>Scoring, penalties, times, with citations</span></div><ChevronRight size={16} />
      </button>
      <button className="rg-mode" onClick={() => setView("stats")}>
        <BarChart3 size={18} /><div><strong>Your stats</strong><span>Accuracy by area, and what to drill</span></div><ChevronRight size={16} />
      </button>

      <p className="rg-disclaimer">{DISCLAIMER}</p>
    </div>
  );
}

function Card2({ title, children }) {
  return <div className="card" style={{ marginBottom: 12 }}><div className="card-title">{title}</div>{children}</div>;
}
function StatChip2({ label, value }) {
  return <div className="stat-chip"><div className="stat-chip-value">{value}</div><div className="stat-chip-label">{label}</div></div>;
}
