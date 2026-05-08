import { useState, useEffect } from "react";
import { fetchVSCodeSessions, fetchVSCodeSummary } from "../api.js";
import { PageBanner } from "../components/PageBanner.jsx";

export default function VSCodeSessions() {
  const [sessions, setSessions] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchVSCodeSessions(),
      fetchVSCodeSummary(),
    ])
      .then(([s, sum]) => { setSessions(s); setSummary(sum); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading VS Code sessions…</div>;
  if (error) return <div className="empty"><div className="empty-icon">⚠️</div><p>{error}</p></div>;
  if (!sessions || sessions.length === 0) return (
    <div className="empty">
      <div className="empty-icon">💻</div>
      <h3>No VS Code Sessions Found</h3>
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        VS Code Copilot Chat sessions are read from your workspace storage. Make sure you have VS Code with GitHub Copilot Chat installed and have completed some chat sessions.
      </p>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>💻 VS Code Sessions</h1>
      </div>
      <PageBanner pageId="vscode-sessions">
        Copilot Chat sessions from VS Code — view your conversation history across workspaces.
      </PageBanner>

      {summary && (
        <div className="stats-grid stats-grid-4">
          <div className="card" style={{ textAlign: "center" }}>
            <div className="stat-value">{summary.totalSessions}</div>
            <div className="stat-label">Workspaces</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div className="stat-value">{summary.totalTurns}</div>
            <div className="stat-label">Total Turns</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div className="stat-value">{summary.avgTurnsPerSession}</div>
            <div className="stat-label">Avg Turns/Session</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div className="stat-value">{summary.sessionsWithAttachments}</div>
            <div className="stat-label">With Attachments</div>
          </div>
        </div>
      )}

      {summary && (
        <div className="stats-grid" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="card-header">🤖 Models Used</div>
            {summary.models.map((m) => (
              <div key={m.name} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                <span>{m.name}</span>
                <span style={{ color: "var(--text-muted)" }}>{m.count} turns</span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-header">🎯 Modes</div>
            {summary.modes.map((m) => {
              const label = m.name.includes("/") ? m.name.split("/").pop().replace(/\.agent\.md$|\.md$/i, "").replace(/%20/g, " ") : m.name;
              return (
                <div key={m.name} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                  <span>{label}</span>
                  <span style={{ color: "var(--text-muted)" }}>{m.count} turns</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--yellow)", padding: "12px 16px" }}>
        <div style={{ fontSize: 13 }}>
          <strong>📊 Scoring note:</strong> VS Code sessions are displayed here for visibility but are not yet integrated into the pillar scoring framework.
          CLI sessions (from Copilot in the terminal) drive your Coaching and Learn scores.
        </div>
      </div>

      <div className="card">
        <div className="card-header">Sessions ({sessions.length})</div>
        {[...sessions]
          .sort((a, b) => b.turnCount - a.turnCount)
          .map((session) => {
            const isExpanded = expandedId === session.id;
            return (
              <div key={session.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : session.id)}
                  style={{
                    padding: "12px 0",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {session.firstMessage
                        ? session.firstMessage.substring(0, 100) + (session.firstMessage.length > 100 ? "…" : "")
                        : `Workspace ${session.workspaceId.substring(0, 8)}…`}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {session.vscodeEdition === "insiders" ? "VS Code Insiders" : "VS Code"} ·{" "}
                      {session.turnCount} turns ·{" "}
                      {session.models.join(", ")}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ padding: "0 0 12px 16px" }}>
                    {session.turns.map((turn, i) => (
                      <div key={i} style={{ padding: "6px 0", borderTop: i > 0 ? "1px solid var(--border-color)" : "none" }}>
                        <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 2 }}>
                          Turn {turn.turnIndex + 1} · {turn.mode} · {turn.model}
                        </div>
                        <div style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {turn.userMessage || "(no message)"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
