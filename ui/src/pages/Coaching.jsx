import { useState, useEffect } from "react";
import { fetchClarity, fetchEfficiency, fetchDelegation, fetchJudgment } from "../api";
import { TimeframeSelector } from "../components/TimeframeSelector";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { useRefresh } from "../App.jsx";

export default function Coaching() {
  const { key: refreshKey } = useRefresh();
  const [timeframe, setTimeframe] = useState("all");
  const [clarity, setClarity] = useState(null);
  const [efficiency, setEfficiency] = useState(null);
  const [delegation, setDelegation] = useState(null);
  const [judgment, setJudgment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchClarity(timeframe),
      fetchEfficiency(timeframe),
      fetchDelegation(timeframe),
      fetchJudgment(timeframe),
    ])
      .then(([c, e, d, j]) => { setClarity(c); setEfficiency(e); setDelegation(d); setJudgment(j); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="loading">Analyzing coaching metrics…</div>;
  if (error) return <div className="empty"><div className="empty-icon">❌</div><p>{error}</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>🎓 Agent Coaching</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>

      {/* Three pillars hero */}
      <div className="stats-grid stats-grid-3">
        <div className={`stat-card pillar-card ${tab === "delegation" ? "pillar-active" : ""}`}onClick={() => setTab("delegation")} style={{ cursor: "pointer" }}>
          <div className="stat-value" style={{ color: "#58a6ff" }}>{delegation?.overallDelegationRatio ?? "—"}%</div>
          <div className="stat-label">🤝 Delegation</div>
          <div className="stat-sub">work handed off to agent</div>
        </div>
        <div className={`stat-card pillar-card ${tab === "judgment" ? "pillar-active" : ""}`} onClick={() => setTab("judgment")} style={{ cursor: "pointer" }}>
          <div className="stat-value" style={{ color: judgment?.avgScore >= 70 ? "#3fb950" : "#d29922" }}>{judgment?.avgScore ?? "—"}</div>
          <div className="stat-label">🧠 Judgment</div>
          <div className="stat-sub">review quality / 100</div>
        </div>
        <div className={`stat-card pillar-card ${tab === "feedback" ? "pillar-active" : ""}`} onClick={() => setTab("feedback")} style={{ cursor: "pointer" }}>
          <div className="stat-value" style={{ color: clarity?.avgScore >= 60 ? "#3fb950" : "#d29922" }}>{clarity?.avgScore ?? "—"}</div>
          <div className="stat-label">💬 Feedback</div>
          <div className="stat-sub">clarity score / 100</div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>📊 Overview</button>
        <button className={`tab-btn ${tab === "delegation" ? "active" : ""}`} onClick={() => setTab("delegation")}>🤝 Delegation</button>
        <button className={`tab-btn ${tab === "judgment" ? "active" : ""}`} onClick={() => setTab("judgment")}>🧠 Judgment</button>
        <button className={`tab-btn ${tab === "feedback" ? "active" : ""}`} onClick={() => setTab("feedback")}>💬 Feedback</button>
      </div>

      {tab === "overview" && <OverviewTab clarity={clarity} efficiency={efficiency} delegation={delegation} judgment={judgment} />}
      {tab === "delegation" && <DelegationTab data={delegation} />}
      {tab === "judgment" && <JudgmentTab data={judgment} />}
      {tab === "feedback" && <FeedbackTab clarity={clarity} efficiency={efficiency} />}
    </div>
  );
}

/* ── Overview Tab ──────────────────────────────────────────── */

function OverviewTab({ clarity, efficiency, delegation, judgment }) {
  const allSuggestions = [
    ...(judgment?.suggestions || []),
    ...(delegation ? buildDelegationSuggestions(delegation) : []),
    ...(efficiency?.aggregate?.totalDripFeeds > 5 ? [{
      priority: "medium", emoji: "💧", title: "Reduce Drip-Feeding",
      body: `${efficiency.aggregate.totalDripFeeds} times you added context piecemeal. Front-load requirements in your first message.`,
    }] : []),
    ...(clarity?.avgScore < 50 ? [{
      priority: "high", emoji: "📝", title: "Improve Opening Prompts",
      body: `Average clarity score of ${clarity.avgScore}/100. Include file paths, constraints, and expected behavior in your first message.`,
    }] : []),
  ].sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2, info: 3 };
    return (p[a.priority] ?? 3) - (p[b.priority] ?? 3);
  });

  return (
    <>
      <div className="card">
        <div className="card-header">🎯 Key Metrics</div>
        <div className="stats-grid stats-grid-4">
          <MiniStat label="Agent Leverage" value={`${delegation?.overallLeverage ?? 0}x`} sub="output/input ratio" />
          <MiniStat label="File Operations" value={delegation?.totalFileOps ?? 0} sub="agent-created files" />
          <MiniStat label="Rubber-Stamp Rate" value={`${judgment?.rubberStampRate ?? 0}%`} sub="approvals before fix" />
          <MiniStat label="Turn Efficiency" value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="productive turns" />
        </div>
      </div>

      {allSuggestions.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Top Coaching Tips</div>
          <SuggestionsStack suggestions={allSuggestions.slice(0, 5)} />
        </div>
      )}
    </>
  );
}

/* ── Delegation Tab ────────────────────────────────────────── */

function DelegationTab({ data }) {
  if (!data) return null;

  return (
    <>
      <p className="page-intro">
        How you divide work between yourself and the agent. High delegation means you give goals
        and let the agent figure out the approach. Low delegation means you guide step-by-step.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label="Delegation Ratio" value={`${data.overallDelegationRatio}%`} sub="autonomous turns" />
        <MiniStat label="Agent Leverage" value={`${data.overallLeverage}x`} sub="output per input char" />
        <MiniStat label="File Operations" value={data.totalFileOps} sub="agent-touched files" />
        <MiniStat label="Your Input" value={`${data.userInputKB}KB`} sub={`→ ${data.agentOutputKB}KB output`} />
      </div>

      {/* Turn type breakdown */}
      {data.turnTypeBreakdown?.length > 0 && (
        <div className="card">
          <div className="card-header">📊 How You Interact</div>
          <div className="delegation-chart-row">
            <div className="delegation-donut">
              <PieChart width={180} height={180}>
                <Pie data={data.turnTypeBreakdown} dataKey="count" nameKey="type" cx="50%" cy="50%" innerRadius={45} outerRadius={75}>
                  {data.turnTypeBreakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </div>
            <div className="delegation-legend">
              {data.turnTypeBreakdown.map((t, i) => (
                <div key={i} className="delegation-legend-row">
                  <span className="dot" style={{ background: t.color }} />
                  <span className="delegation-legend-label">{t.type}</span>
                  <span className="delegation-legend-count">{t.count}</span>
                  <span className="delegation-legend-desc">{t.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Session styles */}
      {data.styleDistribution?.length > 0 && (
        <div className="card">
          <div className="card-header">🎭 Session Styles</div>
          <div className="style-pills">
            {data.styleDistribution.map((s, i) => (
              <div key={i} className="style-pill">
                <span className="style-pill-icon">{styleEmoji(s.style)}</span>
                <span>{s.style}</span>
                <span className="pill-count" style={{ background: "#58a6ff" }}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Most productive sessions */}
      {data.topDelegated?.length > 0 && (
        <div className="card">
          <div className="card-header">🚀 Most Productive Sessions</div>
          <p className="card-subtitle">Highest file operations per turn — effective delegation</p>
          <table className="data-table">
            <thead>
              <tr><th>Productivity</th><th>Output</th><th>Session</th></tr>
            </thead>
            <tbody>
              {data.topDelegated.slice(0, 5).map((s, i) => (
                <tr key={i}>
                  <td><span className="clarity-badge" style={{ background: "#3fb950" }}>{s.productivity}</span> files/turn</td>
                  <td style={{ fontSize: 12 }}>{s.filesCreated + s.filesEdited} files · {s.turnCount} turns</td>
                  <td className="truncate" style={{ maxWidth: 250 }}>{s.summary || s.repo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ── Judgment Tab ──────────────────────────────────────────── */

function JudgmentTab({ data }) {
  if (!data) return null;

  return (
    <>
      <p className="page-intro">
        How well you evaluate agent output. Good judgment means catching issues early,
        not rubber-stamping work, and avoiding costly late-stage corrections.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label="Judgment Score" value={data.avgScore} sub="/100 average" />
        <MiniStat label="Issues Caught" value={data.totalCatches} sub="problems spotted" />
        <MiniStat label="Late Catches" value={data.totalLateCatches} sub="costly rollbacks" />
        <MiniStat label="Rubber-Stamp" value={`${data.rubberStampRate}%`} sub="approve → correct" />
      </div>

      {/* Score distribution */}
      {data.scoreBuckets && (
        <div className="card">
          <div className="card-header">📊 Judgment Score Distribution</div>
          <div className="score-buckets">
            {data.scoreBuckets.map((b, i) => (
              <div key={i} className="score-bucket-row">
                <span className="score-bucket-label" style={{ color: b.color }}>{b.label}</span>
                <div className="failure-type-bar-bg">
                  <div className="failure-type-bar" style={{
                    width: `${data.sessionsAnalyzed > 0 ? (b.count / data.sessionsAnalyzed) * 100 : 0}%`,
                    background: b.color,
                  }} />
                </div>
                <span className="failure-type-count">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.suggestions?.length > 0 && (
        <div className="card">
          <div className="card-header">💡 How to Improve</div>
          <SuggestionsStack suggestions={data.suggestions} />
        </div>
      )}

      {/* Most thrashed files */}
      {data.allThrashed?.length > 0 && (
        <div className="card">
          <div className="card-header">🔄 Most Revised Files</div>
          <p className="card-subtitle">Files edited 3+ times in a session — sign of unclear requirements</p>
          <table className="data-table">
            <thead><tr><th>File</th><th>Edits</th></tr></thead>
            <tbody>
              {data.allThrashed.slice(0, 8).map((f, i) => (
                <tr key={i}>
                  <td className="truncate" style={{ maxWidth: 400 }}>{f.path}</td>
                  <td><span className="clarity-badge" style={{ background: "#f85149" }}>{f.editCount}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Worst judgment sessions */}
      {data.worstJudgment?.length > 0 && (
        <div className="card">
          <div className="card-header">⚠️ Sessions Needing Better Review</div>
          <table className="data-table">
            <thead><tr><th>Score</th><th>Issues</th><th>Session</th></tr></thead>
            <tbody>
              {data.worstJudgment.slice(0, 5).map((s, i) => (
                <tr key={i}>
                  <td><span className="clarity-badge" style={{ background: s.score < 40 ? "#f85149" : "#d29922" }}>{s.score}</span></td>
                  <td style={{ fontSize: 12 }}>{s.catches} catches · {s.lateCatches} late</td>
                  <td className="truncate" style={{ maxWidth: 300 }}>{s.summary || s.repo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ── Feedback Tab ─────────────────────────────────────────── */

function FeedbackTab({ clarity, efficiency }) {
  return (
    <>
      <p className="page-intro">
        How effectively you communicate requirements and corrections to the agent.
        Clear feedback = fewer iterations, faster results.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label="Clarity Score" value={clarity?.avgScore ?? "—"} sub="/100 avg first-turn" />
        <MiniStat label="Turn Efficiency" value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="productive turns" />
        <MiniStat label="Recovery Speed" value={efficiency?.aggregate?.avgRecoveryTurns ?? "—"} sub="turns after redirect" />
        <MiniStat label="Context Drips" value={efficiency?.aggregate?.totalDripFeeds ?? 0} sub="piecemeal info adds" />
      </div>

      {clarity && (
        <div className="card">
          <div className="card-header">📏 First-Turn Clarity Distribution</div>
          <ClarityBar distribution={clarity.distribution} />
        </div>
      )}

      {clarity?.topTips?.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Most Common Feedback Gaps</div>
          <div className="tips-list">
            {clarity.topTips.map((t, i) => (
              <div key={i} className="tip-row">
                <div className="tip-bar-track"><div className="tip-bar-fill" style={{ width: `${t.pct}%` }} /></div>
                <span className="tip-pct">{t.pct}%</span>
                <span className="tip-text">{t.tip}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {efficiency?.aggregate?.completionBreakdown && (
        <div className="card">
          <div className="card-header">🏁 Session Outcomes</div>
          <div className="completion-grid">
            {Object.entries(efficiency.aggregate.completionBreakdown).map(([status, count]) => (
              <div key={status} className="completion-item">
                <span className="completion-count">{count}</span>
                <span className="completion-label">{status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-row">
        {efficiency?.aggregate?.totalDripFeeds > 0 && (
          <div className="card" style={{ flex: 1 }}>
            <h2>💧 Context Drip-Feeding</h2>
            <p className="card-subtitle">Info added piecemeal ({efficiency.aggregate.totalDripFeeds} instances)</p>
            <p className="coaching-tip"><strong>Fix:</strong> Write down everything the agent needs in your first message.</p>
          </div>
        )}
        {efficiency?.aggregate?.totalSkimSignals > 0 && (
          <div className="card" style={{ flex: 1 }}>
            <h2>👀 Response Skimming</h2>
            <p className="card-subtitle">Quick redirects after long responses ({efficiency.aggregate.totalSkimSignals} instances)</p>
            <p className="coaching-tip"><strong>Fix:</strong> Read the full response before redirecting.</p>
          </div>
        )}
      </div>

      {clarity?.sessions?.length > 0 && (
        <div className="card">
          <div className="card-header">🔍 Weakest Opening Prompts</div>
          <table className="data-table">
            <thead><tr><th>Score</th><th>Session</th><th>Missing</th></tr></thead>
            <tbody>
              {clarity.sessions.slice(0, 8).map((s) => (
                <tr key={s.sessionId}>
                  <td><span className="clarity-badge" style={{ background: clarityColor(s.clarity.score) }}>{s.clarity.score}</span></td>
                  <td className="truncate" title={s.firstMessage}>{s.summary || s.firstMessage?.substring(0, 80) || s.sessionId.slice(0, 8)}</td>
                  <td className="tip-cell">{s.clarity.tips[0] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ── Shared Components ─────────────────────────────────────── */

function MiniStat({ label, value, sub }) {
  return (
    <div className="stat-card" style={{ padding: "12px 16px" }}>
      <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

function SuggestionsStack({ suggestions }) {
  const PRIORITY_COLORS = { high: "#f85149", medium: "#d29922", low: "#58a6ff", info: "#3fb950" };
  return (
    <div className="suggestions-stack">
      {suggestions.map((s, i) => (
        <div key={i} className="suggestion-block" style={{ borderLeftColor: PRIORITY_COLORS[s.priority] || "#8b949e" }}>
          <div className="suggestion-header">
            <span className="suggestion-emoji">{s.emoji}</span>
            <span className="suggestion-title">{s.title}</span>
            <span className="priority-tag" style={{ background: PRIORITY_COLORS[s.priority] }}>{s.priority}</span>
          </div>
          <p className="suggestion-body">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

function ClarityBar({ distribution }) {
  const total = distribution.excellent + distribution.good + distribution.fair + distribution.poor;
  if (total === 0) return null;
  const segments = [
    { label: "Excellent", count: distribution.excellent, color: "#3fb950" },
    { label: "Good", count: distribution.good, color: "#58a6ff" },
    { label: "Fair", count: distribution.fair, color: "#d29922" },
    { label: "Poor", count: distribution.poor, color: "#f85149" },
  ];
  return (
    <div className="clarity-bar-wrapper">
      <div className="clarity-bar">
        {segments.map((seg) => seg.count > 0 && (
          <div key={seg.label} className="clarity-segment" style={{ width: `${(seg.count / total) * 100}%`, background: seg.color }} title={`${seg.label}: ${seg.count}`} />
        ))}
      </div>
      <div className="clarity-legend">
        {segments.map((seg) => (
          <span key={seg.label} className="clarity-legend-item">
            <span className="dot" style={{ background: seg.color }} /> {seg.label} ({seg.count})
          </span>
        ))}
      </div>
    </div>
  );
}

function clarityColor(score) {
  if (score >= 80) return "#3fb950";
  if (score >= 60) return "#58a6ff";
  if (score >= 40) return "#d29922";
  return "#f85149";
}

function styleEmoji(style) {
  const map = { delegator: "🎯", collaborative: "🤝", "hands-on": "🔧", corrective: "🔄", exploratory: "🔍" };
  return map[style] || "📋";
}

function buildDelegationSuggestions(data) {
  const suggestions = [];
  if (data.overallDelegationRatio < 20) {
    suggestions.push({
      priority: "medium", emoji: "🤝", title: "Delegate More",
      body: `Only ${data.overallDelegationRatio}% delegation. Try giving high-level goals and letting the agent choose the approach.`,
    });
  }
  if (data.overallLeverage < 0.5) {
    suggestions.push({
      priority: "medium", emoji: "📈", title: "Low Agent Leverage",
      body: `Agent output is only ${data.overallLeverage}x your input. You may be writing more than the agent — consider delegating larger chunks.`,
    });
  }
  return suggestions;
}
