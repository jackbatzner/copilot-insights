import { useState, useEffect } from "react";
import { fetchDevPlan, fetchProgressCheck, fetchRetro, fetchInstructionGaps } from "../api.js";
import { TimeframeSelector } from "../components/TimeframeSelector.jsx";
import { useRefresh } from "../App.jsx";
import { PageBanner } from "../components/PageBanner.jsx";
import { SuggestedNext } from "../components/SuggestedNext.jsx";
import { CollapsibleSection } from "../components/CollapsibleSection.jsx";

export default function Learn() {
  const { key: refreshKey } = useRefresh();
  const [plan, setPlan] = useState(null);
  const [progress, setProgress] = useState(null);
  const [retro, setRetro] = useState(null);
  const [gaps, setGaps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState("all");
  const [tab, setTab] = useState("plan");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchDevPlan(timeframe),
      fetchProgressCheck(timeframe),
      fetchRetro(timeframe),
      fetchInstructionGaps(timeframe).catch(() => null),
    ])
      .then(([p, pr, r, g]) => { setPlan(p); setProgress(pr); setRetro(r); setGaps(g); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="loading">Loading your development plan…</div>;
  if (error) return <div className="empty"><div className="empty-icon">❌</div><p>{error}</p></div>;

  const tabs = [
    { id: "plan", label: "🎯 Dev Plan" },
    { id: "check", label: "📊 Daily Check" },
    { id: "retro", label: "🔄 Retro" },
    { id: "learn", label: "📚 Resources" },
  ];

  return (
    <>
      <div className="page-header">
        <h1>📚 Learn & Grow</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>
      <PageBanner pageId="learn">
        Your personalized improvement plan — pick a focus and build habits.
      </PageBanner>

      {/* Pillar score hero */}
      {plan && (
        <div className="stats-grid stats-grid-4">
          <ScoreCard emoji="🤝" label="Delegation" score={plan.pillarScores.delegation} />
          <ScoreCard emoji="🧠" label="Judgment" score={plan.pillarScores.judgment} />
          <ScoreCard emoji="💬" label="Feedback" score={plan.pillarScores.feedback} />
          <ScoreCard emoji="⭐" label="Overall" score={plan.pillarScores.overall} highlight />
        </div>
      )}

      <div className="tab-bar">
        {tabs.map((t) => (
          <button key={t.id} className={`tab-btn${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "plan" && plan && <DevPlanTab plan={plan} gaps={gaps} />}
      {tab === "check" && progress && <DailyCheckTab progress={progress} />}
      {tab === "retro" && retro && <RetroTab retro={retro} />}
      {tab === "learn" && plan && <ResourcesTab plan={plan} />}
      <SuggestedNext
        to="/sessions"
        icon="📋"
        label="Sessions"
        description="Browse your individual sessions and click any to see the turn-by-turn detail"
      />
    </>
  );
}

function ScoreCard({ emoji, label, score, highlight }) {
  const color = score >= 70 ? "var(--green)" : score >= 45 ? "var(--yellow)" : "var(--red)";
  return (
    <div className={`card pillar-score-card${highlight ? " highlight" : ""}`} style={{ textAlign: "center" }}>
      <div style={{ fontSize: 28 }}>{emoji}</div>
      <div className="stat-value" style={{ color, fontSize: 36 }}>{score}</div>
      <div className="stat-label">{label}</div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
        {label === "Overall" ? "Average of 3 pillars" : "Score out of 100"}
      </div>
      {score < 80 && <div style={{ fontSize: 10, color: "var(--yellow)" }}>→ Target: 80</div>}
    </div>
  );
}

function QuickWinsCard({ wins }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? wins : wins.slice(0, 1);
  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--green)" }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>⚡ Quick Wins — Start Here</span>
        {wins.length > 1 && (
          <button onClick={() => setExpanded(!expanded)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>
            {expanded ? "Show less" : `Show all ${wins.length}`}
          </button>
        )}
      </div>
      {shown.map((w, i) => (
        <div key={i} className="opportunity-item quick-win">
          <div className="opp-header">
            <span className="pillar-pill" data-pillar={w.pillar}>{w.pillar}</span>
            <strong>{w.title}</strong>
          </div>
          <p className="opp-desc">{w.description}</p>
          <div className="opp-metric">{w.metric}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Dev Plan Tab ──────────────────────────────────────────────── */
function DevPlanTab({ plan, gaps }) {
  const highImpact = plan.opportunities.filter((o) => o.type === "high_impact");

  return (
    <>
      {/* Quick wins */}
      {plan.quickWins.length > 0 && (
        <QuickWinsCard wins={plan.quickWins} />
      )}

      {/* High impact opportunities with mapped weekly goals */}
      {highImpact.length > 0 && (
        <CollapsibleSection title="🚀 High-Impact Opportunities & Weekly Goals" id="learn-high-impact" defaultOpen={false}>
          {highImpact.map((o, i) => {
            const relatedGoals = plan.weeklyGoals.filter((g) => g.pillar === o.pillar);
            return (
              <div key={i} className="opportunity-item">
                <div className="opp-header">
                  <span className="pillar-pill" data-pillar={o.pillar}>{o.pillar}</span>
                  <strong>{o.title}</strong>
                  <span className="impact-badge">Impact: {o.impact}/10</span>
                </div>
                <p className="opp-desc">{o.description}</p>
                <div className="opp-metric">{o.metric}</div>
                <div style={{ marginTop: 6, padding: "6px 10px", background: "rgba(88, 166, 255, 0.08)", borderRadius: 6, fontSize: 12, color: "var(--accent)" }}>
                  🎯 <strong>This week's mission:</strong> In your next 3 sessions, try {o.title.toLowerCase()} and see if your {o.pillar} score improves.
                </div>
                {relatedGoals.length > 0 && (
                  <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>Related weekly goals:</div>
                    {relatedGoals.map((g, gi) => (
                      <div key={gi} style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>
                        {g.emoji} <strong style={{ color: "var(--text)" }}>{g.goal}</strong>
                        <span style={{ marginLeft: 8, fontSize: 11 }}>{g.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CollapsibleSection>
      )}

      {/* Weekly goals — full list with starring */}
      <WeeklyGoals goals={plan.weeklyGoals} />

      {/* Instruction gaps — stop repeating yourself */}
      {gaps && gaps.totalGaps > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--purple)" }}>
          <div className="card-header">🔁 Stop Repeating Yourself</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 4px 8px" }}>
            {gaps.totalSignals} manual corrections across {gaps.totalGaps} patterns. Add them to <code>.copilot-instructions.md</code>.
          </div>
          {gaps.gaps?.slice(0, 3).map((g, i) => (
            <div key={i} style={{ padding: "8px 8px", borderTop: "1px solid var(--border)", fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text)" }}>{g.label}</span>
                <span style={{ color: "var(--text-muted)" }}>{g.count}× corrected</span>
              </div>
              <div style={{ marginTop: 6, padding: "6px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", userSelect: "all", cursor: "text" }}>
                {g.suggestedRule || `Add to .copilot-instructions.md: "${g.label}"`}
              </div>
            </div>
          ))}
          <div style={{ padding: "8px 8px 4px", fontSize: 11 }}>
            <a href="/instructions" style={{ color: "var(--accent)" }}>View all {gaps.totalGaps} gaps →</a>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Daily Check Tab ───────────────────────────────────────────── */
function DailyCheckTab({ progress }) {
  const { today, baseline, deltas, momentum, tips } = progress;

  return (
    <>
      {/* Today's stats vs baseline */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">📊 Today vs Baseline — {progress.date}</div>
        {!today ? (
          <div className="empty-section">
            <div className="empty-icon">🌅</div>
            <p>No sessions yet today. Start one and check back!</p>
          </div>
        ) : (
          <>
            <div className="stats-grid stats-grid-3" style={{ gap: 12, marginBottom: 16 }}>
              <DeltaCard label="Delegation" current={today.delegationScore} delta={deltas.delegation} />
              <DeltaCard label="Judgment" current={today.judgmentScore} delta={deltas.judgment} />
              <DeltaCard label="Feedback" current={today.feedbackScore} delta={deltas.feedback} />
            </div>
            <div className="check-stats">
              <span>📋 {today.sessionCount} sessions</span>
              <span>💬 {today.totalTurns} turns</span>
              {today.leverage != null && <span>📐 {today.leverage}x leverage</span>}
            </div>
          </>
        )}
      </div>

      {/* Momentum signals */}
      {momentum.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">📈 Momentum</div>
          {momentum.map((m, i) => (
            <div key={i} className="momentum-item">
              <span className="momentum-emoji">{m.emoji}</span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tips */}
      <div className="card">
        <div className="card-header">💡 Today's Tips</div>
        {tips.map((t, i) => (
          <div key={i} className="tip-item">{t}</div>
        ))}
      </div>
    </>
  );
}

function DeltaCard({ label, current, delta }) {
  const color = current >= 70 ? "var(--green)" : current >= 45 ? "var(--yellow)" : "var(--red)";
  const deltaColor = delta > 0 ? "var(--green)" : delta < 0 ? "var(--red)" : "var(--text-muted)";
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  return (
    <div className="card delta-card" style={{ textAlign: "center", padding: 12 }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color, fontSize: 28 }}>{current}</div>
      <div style={{ color: deltaColor, fontSize: 14, fontWeight: 600 }}>
        {arrow} {delta > 0 ? "+" : ""}{delta}pts
      </div>
    </div>
  );
}

/* ── Retro Tab ─────────────────────────────────────────────────── */
function RetroTab({ retro }) {
  if (retro.empty) return <div className="empty"><div className="empty-icon">📭</div><p>{retro.message}</p></div>;

  return (
    <>
      {/* Period summary */}
      <div className="card retro-header" style={{ marginBottom: 16 }}>
        <div className="retro-grade">{retro.grade}</div>
        <div className="retro-summary">
          <h3>Period Retro</h3>
          {retro.period.startDate && retro.period.endDate ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {new Date(retro.period.startDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} – {new Date(retro.period.endDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Weekly review (Mon–Sun)</div>
          )}
          <p>{retro.period.sessions} sessions · {retro.period.totalTurns} turns · Overall {retro.pillarScores.overall}/100</p>
        </div>
      </div>

      <div className="stats-grid stats-grid-2" style={{ gap: 16, marginBottom: 16 }}>
        {/* Wins */}
        <div className="card" style={{ borderLeft: "3px solid var(--green)" }}>
          <div className="card-header">✅ Wins</div>
          {retro.wins.length === 0 ? <p className="empty-text">Keep working — wins are coming!</p> : retro.wins.map((w, i) => (
            <div key={i} className="retro-item win">
              <span>{w.emoji}</span> <span>{w.text}</span>
            </div>
          ))}
        </div>

        {/* Misses */}
        <div className="card" style={{ borderLeft: "3px solid var(--red)" }}>
          <div className="card-header">⚠️ Areas to Improve</div>
          {retro.misses.length === 0 ? <p className="empty-text">No major misses — solid work!</p> : retro.misses.map((m, i) => (
            <div key={i} className="retro-item miss">
              <span>{m.emoji}</span> <span>{m.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trends */}
      {retro.trends.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">📊 Trends</div>
          {retro.trends.map((t, i) => (
            <div key={i} className="retro-item trend">
              <span>{t.direction === "up" ? "📈" : "📉"}</span> <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Next focus */}
      <div className="card" style={{ borderLeft: "3px solid var(--purple)" }}>
        <div className="card-header">🎯 Next Focus: {retro.nextFocus.pillar}</div>
        <p style={{ margin: "8px 0" }}>{retro.nextFocus.recommendation}</p>
        {retro.nextFocus.resources.length > 0 && (
          <div className="retro-resources">
            {retro.nextFocus.resources.map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="resource-link">
                📖 {r.title} <span className="resource-provider">{r.provider} · {r.time}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Resources Tab ─────────────────────────────────────────────── */
function ResourcesTab({ plan }) {
  const { learningPath } = plan;

  return (
    <>
      <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--purple)" }}>
        <div className="card-header">🎯 Focus Area: {learningPath.focus}</div>
        <p style={{ margin: "8px 0", color: "var(--text-muted)" }}>
          Estimated time: ~{learningPath.totalTime} min total
        </p>
      </div>

      {/* Primary resources */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">📖 Priority Reading</div>
        {learningPath.primary.map((r, i) => (
          <ResourceCard key={i} resource={r} priority />
        ))}
      </div>

      {/* Secondary resources */}
      {learningPath.secondary.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">📚 Also Recommended</div>
          {learningPath.secondary.map((r, i) => (
            <ResourceCard key={i} resource={r} />
          ))}
        </div>
      )}

      {/* Instruction resources */}
      {learningPath.instructionResources.length > 0 && (
        <div className="card">
          <div className="card-header">⚙️ Instruction File Guides</div>
          {learningPath.instructionResources.map((r, i) => (
            <ResourceCard key={i} resource={r} />
          ))}
        </div>
      )}
    </>
  );
}

/* ── Weekly Goals with Habit Stacking ──────────────────────────── */
function WeeklyGoals({ goals }) {
  const storageKey = "insights-focus-goals";
  const [focused, setFocused] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || []; } catch { return []; }
  });
  const [showAll, setShowAll] = useState(false);

  const toggleFocus = (idx) => {
    setFocused((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      if (prev.length < 2) return [...prev, idx];
      return prev;
    });
  };

  // TODO: indices break if server reorders goals — use stable identifiers
  // Sync focused goals to localStorage outside the updater
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(focused)); } catch { /* storage unavailable */ }
  }, [focused, storageKey]);

  const hasFocused = focused.length > 0;
  const displayGoals = hasFocused && !showAll
    ? goals.map((g, i) => ({ ...g, _idx: i })).filter((_, i) => focused.includes(i))
    : goals.map((g, i) => ({ ...g, _idx: i }));

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>🎯 Weekly Goals</span>
        {hasFocused && (
          <button
            onClick={() => setShowAll(!showAll)}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}
          >
            {showAll ? "Show focused only" : `Show all ${goals.length}`}
          </button>
        )}
      </div>

      {!hasFocused && (
        <div style={{ background: "rgba(88, 166, 255, 0.06)", border: "1px solid rgba(88, 166, 255, 0.15)", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "var(--accent)" }}>
          💡 <strong>Habit stacking tip:</strong> Pick 1-2 goals to focus on this week instead of tackling all {goals.length}. Click the ⭐ to mark your focus goals.
        </div>
      )}

      {displayGoals.map((g) => (
        <div key={g._idx} className="goal-item" style={{ opacity: hasFocused && !focused.includes(g._idx) && showAll ? 0.5 : 1 }}>
          <div className="goal-header">
            <button
              onClick={() => toggleFocus(g._idx)}
              title={focused.includes(g._idx) ? "Remove focus" : focused.length >= 2 ? "Max 2 focus goals" : "Set as focus goal"}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: 0, marginRight: 6, filter: focused.includes(g._idx) ? "none" : "grayscale(1) opacity(0.4)" }}
            >
              ⭐
            </button>
            <span className="goal-emoji">{g.emoji}</span>
            <div>
              <strong>{g.goal}</strong>
              {focused.includes(g._idx) && <span style={{ fontSize: 10, color: "var(--accent)", marginLeft: 6, fontWeight: 600 }}>FOCUS</span>}
              <p className="goal-desc">{g.description}</p>
            </div>
          </div>
          <div className="goal-progress-row">
            <div className="goal-progress-bar">
              <div className="goal-progress-fill" style={{ width: `${g.progress}%` }} />
            </div>
            <span className="goal-target">{Math.round(g.progress)}% → {g.target}</span>
          </div>
          {focused.includes(g._idx) && g.progress < 30 && (
            <div style={{ fontSize: 10, color: "var(--yellow)", marginTop: 2 }}>💪 Consider continuing this focus next week if you haven't mastered it yet, or pick a new area to improve.</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ResourceCard({ resource: r, priority }) {
  return (
    <a href={r.url} target="_blank" rel="noopener noreferrer" className={`resource-card${priority ? " priority" : ""}`}>
      <div className="resource-main">
        <div className="resource-title">{r.title}</div>
        <div className="resource-desc">{r.description}</div>
      </div>
      <div className="resource-meta">
        <span className="resource-provider-tag">{r.provider}</span>
        <span className="resource-time">⏱ {r.time}</span>
        <span className="resource-type">{r.type}</span>
      </div>
    </a>
  );
}
