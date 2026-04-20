import { useState, useEffect } from "react";
import { fetchTokenEfficiency } from "../api.js";
import { useRefresh } from "../App.jsx";

const GRADE_COLORS = {
  "Excellent": "#3fb950",
  "Good": "#58a6ff",
  "Needs Work": "#d29922",
  "Poor": "#f85149",
};

// Actionable coaching tips per waste category
const CATEGORY_COACHING = {
  explicit_correction: {
    icon: "✏️",
    label: "Corrections",
    tip: "Be specific upfront — include file paths, function names, and expected behavior.",
    action: "Next session: before sending a prompt, ask yourself 'Could the agent misunderstand what file or function I mean?' If yes, add the path.",
    example: 'Instead of "fix the auth" → "In src/auth.mjs line 42, the JWT validation throws on expired tokens — add a try/catch returning 401."',
  },
  course_change: {
    icon: "🔀",
    label: "Course Changes",
    tip: "You're changing direction mid-session, which wastes everything the agent already did.",
    action: "Next session: write your goal in one sentence BEFORE you start. If you catch yourself pivoting, start a new session instead.",
    example: "One session = one task. Pivoting from 'add login page' to 'fix the navbar' should be two sessions.",
  },
  frustration: {
    icon: "😤",
    label: "Frustration Retries",
    tip: "Frustrated follow-ups ('that's wrong, try again') rarely help. The agent needs specifics, not emotion.",
    action: "Next time you're frustrated: pause, describe WHAT is wrong and WHAT you expected instead. This one change can cut retries in half.",
    example: 'Instead of "that\'s still wrong" → "The output is missing the header row — the first line should be column names: Name, Email, Role."',
  },
  repetition: {
    icon: "🔁",
    label: "Repetition",
    tip: "Repeating yourself means a constraint wasn't clear enough the first time.",
    action: "Next session: list your requirements as bullet points upfront. Constraints you add later cost a full round-trip.",
    example: 'Front-load constraints: "Requirements: TypeScript only, don\'t modify existing tests, keep under 50 lines."',
  },
  rollback: {
    icon: "⏪",
    label: "Rollbacks",
    tip: "You're undoing the agent's work — it went down a wrong path.",
    action: "Next session: ask for a plan first ('outline your approach') before letting the agent write code. Review the plan, THEN say 'implement it'.",
    example: 'Start with: "Before coding, outline your approach in 3-4 bullet points." Then review before proceeding.',
  },
};

function GradeBadge({ grade, score }) {
  const color = GRADE_COLORS[grade] || "#8b949e";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 12,
      background: `${color}20`, color,
      fontSize: 13, fontWeight: 600,
    }}>
      {score !== undefined && <span>{score}</span>}
      {grade}
    </span>
  );
}

function BarChart({ label, value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: "var(--text-muted)" }}>{value.toLocaleString()} tokens</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--border)" }}>
        <div style={{ height: 6, borderRadius: 3, width: `${pct}%`, background: color, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

/**
 * Derive personalized coaching insights from the user's actual data.
 */
function deriveInsights(aggregate, wasteBreakdown, displaySessions) {
  const insights = { topAction: null, quickWins: [], level: "beginner" };

  const totalTokens = aggregate?.totalTokens || 0;
  const totalWasted = aggregate?.totalWasted || 0;
  const sessionsAnalyzed = aggregate?.sessionsAnalyzed || 0;
  const wasteRatio = totalTokens > 0 ? totalWasted / totalTokens : 0;

  // Determine user level
  if (sessionsAnalyzed >= 20 && wasteRatio < 0.05) insights.level = "expert";
  else if (sessionsAnalyzed >= 10 && wasteRatio < 0.15) insights.level = "intermediate";
  else insights.level = "beginner";

  // Find the #1 waste category
  const sortedCategories = Object.entries(wasteBreakdown).sort((a, b) => b[1] - a[1]);
  if (sortedCategories.length > 0) {
    const [topCategory] = sortedCategories[0];
    const coaching = CATEGORY_COACHING[topCategory];
    if (coaching) {
      insights.topAction = {
        category: topCategory,
        ...coaching,
        wastedTokens: sortedCategories[0][1],
      };
    }
  }

  // Generate quick wins based on data patterns
  if (totalWasted === 0 && sessionsAnalyzed > 0) {
    insights.quickWins.push({
      icon: "🌟", text: "Zero waste detected — you're prompting efficiently. Try the Practice Lab to push for even more concise prompts.",
    });
  }

  // Check for sessions with many wasted turns
  const highWasteSessions = displaySessions.filter((s) => s.wastedTokens > 5000);
  if (highWasteSessions.length > 0) {
    insights.quickWins.push({
      icon: "🎯",
      text: `${highWasteSessions.length} session${highWasteSessions.length > 1 ? "s" : ""} had 5k+ wasted tokens. For complex tasks, try breaking them into smaller sessions — each focused on one goal.`,
    });
  }

  // Check if corrections dominate
  if (wasteBreakdown.explicit_correction > (totalWasted * 0.5)) {
    insights.quickWins.push({
      icon: "📝",
      text: "Most of your waste comes from corrections. Try the 'file path test': before sending, check that every file and function you reference is explicitly named.",
    });
  }

  // Check if frustration is present
  if (wasteBreakdown.frustration > 0) {
    insights.quickWins.push({
      icon: "🧘",
      text: "Frustration retries detected. When stuck, try: 'The problem is [X]. I expected [Y]. Please try [Z approach].' — this format cuts retries dramatically.",
    });
  }

  // Advice for power users
  if (insights.level === "expert") {
    insights.quickWins.push({
      icon: "⚡",
      text: "You're already efficient. To go further: try setting up custom instructions or session templates for your most common task types.",
    });
  }

  // Beginner advice
  if (insights.level === "beginner" && insights.quickWins.length === 0) {
    insights.quickWins.push(
      { icon: "1️⃣", text: "Start every prompt with the specific file path and function name you want changed." },
      { icon: "2️⃣", text: "Describe what you WANT, not just what's wrong. 'Add X' beats 'fix this'." },
      { icon: "3️⃣", text: "One task per session. If you catch yourself saying 'also', that's a new session." },
    );
  }

  return insights;
}

export default function TokenEfficiency() {
  const { key: refreshKey } = useRefresh();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState("30d");
  const [showSessions, setShowSessions] = useState(false);
  const [sessionSort, setSessionSort] = useState({ key: "wastedTokens", dir: "desc" });
  const [gradeFilter, setGradeFilter] = useState("all");
  const [sessionLimit, setSessionLimit] = useState(10);

  useEffect(() => {
    setLoading(true);
    fetchTokenEfficiency(timeframe)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="page"><div className="loading-spinner" /></div>;
  if (error) return <div className="page"><div className="card" style={{ padding: 24, color: "var(--red)" }}>Error: {error}</div></div>;
  if (!data) return null;

  const { aggregate, sessions } = data;

  // Flatten session data for display
  const displaySessions = (sessions || []).map((s) => ({
    sessionId: s.sessionId,
    summary: s.summary,
    totalTokens: s.efficiency?.totalTokens || 0,
    wastedTokens: s.efficiency?.wastedTokens || 0,
    efficiencyRatio: s.efficiency?.efficiencyRatio,
    grade: s.efficiency?.grade?.label || "—",
  }));

  // Build waste breakdown
  const wasteBreakdown = {};
  if (aggregate?.wasteByCategory) {
    for (const { category, tokens } of aggregate.wasteByCategory) {
      wasteBreakdown[category] = tokens;
    }
  }

  const aggWastedTokens = aggregate?.totalWasted || 0;
  const aggEfficiencyPct = aggregate?.avgEfficiency ?? null;
  const insights = deriveInsights(aggregate, wasteBreakdown, displaySessions);

  return (
    <div className="page">
      <div className="page-header">
        <h1>⚡ Token Efficiency</h1>
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          aria-label="Select time period for token efficiency data"
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text)", fontSize: 13 }}
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {/* Hero: Your #1 Thing to Fix */}
      {insights.topAction ? (
        <div className="card" style={{
          marginBottom: 16, padding: 20,
          borderLeft: "4px solid var(--orange)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>{insights.topAction.icon}</span>
            <span>Your #1 opportunity: {insights.topAction.label}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 400 }}>
              ({insights.topAction.wastedTokens.toLocaleString()} tokens wasted)
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px" }}>
            {insights.topAction.tip}
          </p>
          <div style={{
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(63, 185, 80, 0.06)", border: "1px solid rgba(63, 185, 80, 0.2)",
            fontSize: 13,
          }}>
            <strong>🎯 Try this:</strong> {insights.topAction.action}
          </div>
          {insights.topAction.example && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              {insights.topAction.example}
            </div>
          )}
        </div>
      ) : aggregate && aggWastedTokens === 0 && (
        <div className="card" style={{
          marginBottom: 16, padding: 20,
          borderLeft: "4px solid var(--green)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>🌟</span>
            <span>No wasted tokens detected!</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Your prompts are clean and focused. Head to the Practice Lab to experiment with pushing efficiency even further.
          </p>
        </div>
      )}

      {/* Quick Wins */}
      {insights.quickWins.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 20 }}>
          <div className="card-header" style={{ marginBottom: 12 }}>
            {insights.level === "expert" ? "🚀 Power User Tips" : insights.level === "intermediate" ? "💪 Level Up" : "🏁 Getting Started"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {insights.quickWins.map((win, i) => (
              <div key={i} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "10px 14px", borderRadius: 8,
                background: "rgba(139, 148, 158, 0.04)", border: "1px solid var(--border)",
                fontSize: 13, lineHeight: 1.5,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{win.icon}</span>
                <span>{win.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Score Summary — compact, not the hero */}
      {aggregate && (
        <div className="card" style={{ marginBottom: 16, padding: "14px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>
                <strong style={{ color: "var(--accent)" }}>{(aggregate.totalTokens || 0).toLocaleString()}</strong>
                <span style={{ color: "var(--text-muted)" }}> total tokens</span>
              </span>
              <span style={{ fontSize: 13 }}>
                <strong style={{ color: aggWastedTokens > 0 ? "var(--orange)" : "var(--green)" }}>{aggWastedTokens.toLocaleString()}</strong>
                <span style={{ color: "var(--text-muted)" }}> wasted</span>
              </span>
              <span style={{ fontSize: 13 }}>
                <strong style={{ color: "var(--text-primary)" }}>{aggEfficiencyPct != null ? `${aggEfficiencyPct}%` : "—"}</strong>
                <span style={{ color: "var(--text-muted)" }}> efficient</span>
              </span>
              <span style={{ fontSize: 13 }}>
                <strong>{aggregate.sessionsAnalyzed || 0}</strong>
                <span style={{ color: "var(--text-muted)" }}> sessions</span>
              </span>
            </div>
            {aggEfficiencyPct != null && (
              <GradeBadge grade={aggEfficiencyPct >= 90 ? "Excellent" : aggEfficiencyPct >= 75 ? "Good" : aggEfficiencyPct >= 60 ? "Needs Work" : "Poor"} />
            )}
          </div>
        </div>
      )}

      {/* Your Patterns — waste breakdown with coaching */}
      {Object.keys(wasteBreakdown).length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 20 }}>
          <div className="card-header" style={{ marginBottom: 4 }}>📊 Your Patterns</div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px" }}>
            What's costing you tokens — sorted by impact
          </p>
          {Object.entries(wasteBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([category, tokens]) => {
              const coaching = CATEGORY_COACHING[category] || { icon: "❓", label: category, tip: "", action: "", example: "" };
              return (
                <div key={category} style={{ marginBottom: 16 }}>
                  <BarChart
                    label={`${coaching.icon} ${coaching.label}`}
                    value={tokens}
                    max={aggWastedTokens || 1}
                    color="var(--orange)"
                  />
                  {coaching.action && (
                    <div style={{
                      marginTop: 4, padding: "8px 12px", borderRadius: 6,
                      background: "rgba(139, 148, 158, 0.06)", border: "1px solid var(--border)",
                      fontSize: 12, lineHeight: 1.5,
                    }}>
                      <div style={{ color: "var(--text-primary)", marginBottom: coaching.example ? 4 : 0 }}>
                        🎯 <strong>Try this:</strong> {coaching.action}
                      </div>
                      {coaching.example && (
                        <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                          {coaching.example}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Session Details — collapsed by default, with sort/filter */}
      {displaySessions.length > 0 && (() => {
        // Filter
        const filtered = gradeFilter === "all"
          ? displaySessions
          : displaySessions.filter((s) => s.grade === gradeFilter);

        // Sort
        const sorted = [...filtered].sort((a, b) => {
          const aVal = a[sessionSort.key] ?? 0;
          const bVal = b[sessionSort.key] ?? 0;
          return sessionSort.dir === "desc" ? bVal - aVal : aVal - bVal;
        });

        const visible = sorted.slice(0, sessionLimit);
        const hasMore = sorted.length > sessionLimit;

        // Unique grades for filter
        const grades = [...new Set(displaySessions.map((s) => s.grade))].sort();

        function toggleSort(key) {
          setSessionSort((prev) =>
            prev.key === key
              ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
              : { key, dir: "desc" }
          );
        }

        function sortTh(label, sortKey) {
          const active = sessionSort.key === sortKey;
          return (
            <th
              key={sortKey}
              onClick={() => toggleSort(sortKey)}
              style={{
                textAlign: "left", padding: "10px 12px",
                borderBottom: "1px solid var(--border)",
                color: active ? "var(--accent)" : "var(--text-muted)", fontWeight: 500,
                fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px",
                cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
              }}
            >
              {label} {active ? (sessionSort.dir === "desc" ? "↓" : "↑") : ""}
            </th>
          );
        }

        return (
        <div className="card" style={{ padding: 0 }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 16px", flexWrap: "wrap", gap: 8,
          }}>
            <button
              onClick={() => { setShowSessions(!showSessions); setSessionLimit(10); }}
              style={{
                border: "none", cursor: "pointer", background: "transparent",
                color: "var(--text-primary)", fontSize: 14, fontWeight: 600,
                padding: 0, display: "flex", alignItems: "center", gap: 6,
              }}
            >
              📋 Session Details ({filtered.length}{gradeFilter !== "all" ? ` of ${displaySessions.length}` : ""})
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {showSessions ? "▲" : "▼"}
              </span>
            </button>
            {showSessions && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={gradeFilter}
                  onChange={(e) => { setGradeFilter(e.target.value); setSessionLimit(10); }}
                  aria-label="Filter by grade"
                  style={{
                    padding: "3px 8px", borderRadius: 4, fontSize: 12,
                    border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text)",
                  }}
                >
                  <option value="all">All grades</option>
                  {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
          </div>
          {showSessions && (
            <>
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{
                    textAlign: "left", padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text-muted)", fontWeight: 500,
                    fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px",
                  }}>Session</th>
                  {sortTh("Total Tokens", "totalTokens")}
                  {sortTh("Wasted", "wastedTokens")}
                  {sortTh("Efficiency", "efficiencyRatio")}
                  <th style={{
                    textAlign: "left", padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text-muted)", fontWeight: 500,
                    fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px",
                  }}>Grade</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.sessionId}>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", fontSize: 13, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.summary?.substring(0, 40) || s.sessionId?.substring(0, 8)}
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>{s.totalTokens.toLocaleString()}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: s.wastedTokens > 0 ? "var(--orange)" : "var(--text-muted)" }}>{s.wastedTokens.toLocaleString()}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>{s.efficiencyRatio != null ? `${Math.round(s.efficiencyRatio * 100)}%` : "—"}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}><GradeBadge grade={s.grade} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {hasMore && (
              <button
                onClick={() => setSessionLimit((l) => l + 20)}
                style={{
                  width: "100%", padding: "10px", border: "none", cursor: "pointer",
                  background: "transparent", color: "var(--accent)", fontSize: 13, fontWeight: 500,
                }}
              >
                Show more ({sorted.length - sessionLimit} remaining)
              </button>
            )}
            {filtered.length === 0 && (
              <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No sessions match this filter.
              </div>
            )}
            </>
          )}
        </div>
        );
      })()}

      {/* Empty state */}
      {displaySessions.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "40px 16px" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>No token data yet</div>
          <div style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 13 }}>
            Token efficiency data will appear once sessions have been analyzed.
            Check that session-state JSONL files exist in ~/.copilot/session-state/.
          </div>
        </div>
      )}
    </div>
  );
}
