import { useState, useEffect } from "react";
import { fetchDevPlan, fetchProgressCheck, fetchRetro } from "../api.js";
import { TimeframeSelector } from "../components/TimeframeSelector.jsx";
import { useRefresh } from "../App.jsx";

export default function Learn() {
  const { key: refreshKey } = useRefresh();
  const [plan, setPlan] = useState(null);
  const [progress, setProgress] = useState(null);
  const [retro, setRetro] = useState(null);
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
    ])
      .then(([p, pr, r]) => { setPlan(p); setProgress(pr); setRetro(r); })
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

      {tab === "plan" && plan && <DevPlanTab plan={plan} />}
      {tab === "check" && progress && <DailyCheckTab progress={progress} />}
      {tab === "retro" && retro && <RetroTab retro={retro} />}
      {tab === "learn" && plan && <ResourcesTab plan={plan} />}
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
    </div>
  );
}

/* ── Dev Plan Tab ──────────────────────────────────────────────── */
function DevPlanTab({ plan }) {
  return (
    <>
      {/* Quick wins */}
      {plan.quickWins.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--green)" }}>
          <div className="card-header">⚡ Quick Wins</div>
          {plan.quickWins.map((w, i) => (
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
      )}

      {/* Weekly goals */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">🎯 Weekly Goals</div>
        {plan.weeklyGoals.map((g, i) => (
          <div key={i} className="goal-item">
            <div className="goal-header">
              <span className="goal-emoji">{g.emoji}</span>
              <div>
                <strong>{g.goal}</strong>
                <p className="goal-desc">{g.description}</p>
              </div>
            </div>
            <div className="goal-progress-row">
              <div className="goal-progress-bar">
                <div className="goal-progress-fill" style={{ width: `${g.progress}%` }} />
              </div>
              <span className="goal-target">{g.target}</span>
            </div>
          </div>
        ))}
      </div>

      {/* High impact opportunities */}
      {plan.opportunities.filter((o) => o.type === "high_impact").length > 0 && (
        <div className="card" style={{ borderLeft: "3px solid var(--yellow)" }}>
          <div className="card-header">🚀 High-Impact Opportunities</div>
          {plan.opportunities.filter((o) => o.type === "high_impact").map((o, i) => (
            <div key={i} className="opportunity-item">
              <div className="opp-header">
                <span className="pillar-pill" data-pillar={o.pillar}>{o.pillar}</span>
                <strong>{o.title}</strong>
                <span className="impact-badge">Impact: {o.impact}/10</span>
              </div>
              <p className="opp-desc">{o.description}</p>
              <div className="opp-metric">{o.metric}</div>
            </div>
          ))}
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
