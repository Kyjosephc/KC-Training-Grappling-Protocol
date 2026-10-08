import React, { useState, useMemo, useCallback } from "react";
import { Trophy, ChevronRight, Check, X, Info, BookOpen, Zap, BarChart3 } from "lucide-react";
import { RULESETS, RULESET_IDS, COMPARE_ROWS, DISCLAIMER } from "./rules/rulesets.js";
import { buildQuestionBank, pickQuestions, rankFor } from "./rules/engine.js";

const BANK = buildQuestionBank();
const XP_RIGHT = 10, XP_STREAK_BONUS = 5;

// Progress lives on the athlete's own record, like everything else they log.
export function emptyRulesProgress() {
  return { xp: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0, topics: {}, lastSeen: null };
}
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

  const weak = useMemo(() => topicStats(p).filter((x) => x.pct < 70).map((x) => x.topic), [p]);
  const rank = rankFor(p.xp);
  const accuracy = p.answered ? Math.round((p.correct / p.answered) * 100) : 0;

  const startQuiz = useCallback((rsId, count, difficulty, minDifficulty) => {
    const qs = pickQuestions(BANK, { ruleset: rsId, count, difficulty, minDifficulty, weakTopics: weak, seed: Date.now() });
    setQuiz({ qs, i: 0, picked: null, right: 0, showWhy: false });
    setView("quiz");
  }, [weak]);

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
    next.lastSeen = new Date().toISOString().slice(0, 10);
    onProgress(next);
    setQuiz({ ...quiz, picked: choice, right: quiz.right + (ok ? 1 : 0) });
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

        <Card2 title="Scoring">
          {Object.entries(rs.scoring).map(([k, s]) => s && (
            <div key={k} className="rg-rule">
              <div className="rg-rule-head"><span>{tLabel(k)}</span><strong>{s.points == null ? "No points" : s.points}</strong></div>
              <div className="muted">{s.control} <span className="rg-cite-inline">{s.cite}</span></div>
            </div>
          ))}
        </Card2>

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
        </div>
      </div>

      <div className="rg-chiprow">
        <button className={`tech-suggest${ruleset === "all" ? " on" : ""}`} onClick={() => setRuleset("all")}>All</button>
        {RULESET_IDS.map((id) => (
          <button key={id} className={`tech-suggest${ruleset === id ? " on" : ""}`} onClick={() => setRuleset(id)}>{RULESETS[id].name}</button>
        ))}
      </div>

      <button className="rg-mode" onClick={() => startQuiz(ruleset, 10, 3)}>
        <Zap size={18} /><div><strong>Five-minute drill</strong><span>10 questions, mixed difficulty</span></div><ChevronRight size={16} />
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
