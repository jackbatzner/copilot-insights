import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchSessionDetail, fetchSessionSprawl, fetchSessionEfficiency, fetchSessionReplay, fetchSessionComplexity } from "../api.js";
import { ScoreBadge, rateColor, CATEGORY_META } from "../components/ScoreBadge.jsx";
import { CategoryBreakdown } from "../components/CategoryBreakdown.jsx";
import { RedirectionTimeline } from "../components/RedirectionTimeline.jsx";

export default function SessionDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [sprawl, setSprawl] = useState(null);
  const [efficiency, setEfficiency] = useState(null);
  const [replay, setReplay] = useState(null);
  const [complexity, setComplexity] = useState(null);
  const [tab, setTab] = useState("summary");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      fetchSessionDetail(id),
      fetchSessionSprawl(id).catch(() => null),
      fetchSessionEfficiency(id).catch(() => null),
      fetchSessionReplay(id).catch(() => null),
      fetchSessionComplexity(id).catch(() => null),
    ])
      .then(([d, s, e, r, c]) => { setData(d); setSprawl(s); setEfficiency(e); setReplay(r); setComplexity(c); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loading">Loading session…</div>;
  if (error) return <div className="empty"><div className="empty-icon">❌</div><p>{error}</p></div>;
  if (!data) return null;

  const { session, stats, categoryBreakdown, redirections, thrashedFiles } =
    data;

  return (
    <>
      <Link to="/sessions" className="back-link">
        ← Back to Sessions
      </Link>

      <div className="page-header">
        <h1>🔍 Session Detail</h1>
        <p>
          <code>{session.id}</code>
        </p>
      </div>

      {/* Session metadata */}
      <div className="stats-grid">
        {session.repository && (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="card-header">Repository</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {session.repository}
            </div>
          </div>
        )}
        {session.branch && (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="card-header">Branch</div>
            <div style={{ fontSize: 14 }}>
              <code>{session.branch}</code>
            </div>
          </div>
        )}
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-header">Total Turns</div>
          <div className="stat-value">{session.turnCount}</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-header">Redirections</div>
          <div className={`stat-value ${rateColor(stats.redirectionRate)}`}>
            {stats.totalRedirections}
          </div>
          <div className="stat-label">
            <ScoreBadge rate={stats.redirectionRate} />
          </div>
        </div>
        {complexity && (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="card-header">Complexity</div>
            <div className="stat-value">{complexity.tierEmoji} {complexity.complexityScore}</div>
            <div className="stat-label">{complexity.tier}</div>
            <div className="stat-sub">{complexity.fileOps} ops · {complexity.uniqueFiles} files · {complexity.checkpointCount} checkpoints</div>
          </div>
        )}
      </div>

      {session.summary && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">Summary</div>
          <p>{session.summary}</p>
        </div>
      )}

      <div className="tab-bar">
        <button className={`tab-btn${tab === "summary" ? " active" : ""}`} onClick={() => setTab("summary")}>📊 Summary</button>
        <button className={`tab-btn${tab === "deep-dive" ? " active" : ""}`} onClick={() => setTab("deep-dive")}>🎬 Deep Dive</button>
      </div>

      {tab === "summary" && (<>
      {/* Session grade + coaching tips from replay */}
      {replay?.summary && (() => {
        const gradeColors = { A: "#3fb950", B: "#58a6ff", C: "#d29922", D: "#f85149" };
        const grade = replay.summary.overallGrade;
        return (
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-value" style={{ color: gradeColors[grade] || "#e6edf3", fontSize: 36 }}>
                {grade}
              </div>
              <div className="stat-label">Session Grade</div>
              <div className="stat-sub">{replay.summary.totalTurns} turns reviewed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "#3fb950" }}>
                {replay.summary.goodSignals}
              </div>
              <div className="stat-label">Good Signals</div>
              <div className="stat-sub">delegation, quality catches, clear feedback</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "#f85149" }}>
                {replay.summary.redirectionCount + replay.summary.dripFeedCount + replay.summary.rubberStampCount}
              </div>
              <div className="stat-label">Problems</div>
              <div className="stat-sub">{replay.summary.redirectionCount} redirections · {replay.summary.dripFeedCount} drip-feeds · {replay.summary.rubberStampCount} rubber stamps</div>
            </div>
          </div>
        );
      })()}

      {replay?.summary?.coachingTips?.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">💡 Coaching Tips</div>
          <ul style={{ margin: 0, padding: "8px 0 0 20px", listStyle: "none" }}>
            {replay.summary.coachingTips.map((tip, i) => (
              <li key={i} style={{ padding: "6px 0", color: "#e6edf3", fontSize: 14, lineHeight: 1.5 }}>
                <span style={{ marginRight: 8, color: "#d29922" }}>💬</span>{tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Efficiency + Sprawl badges */}
      {(efficiency || sprawl) && (
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          {efficiency && (
            <>
              <div className="stat-card">
                <div className="stat-value" style={{ color: efficiency.grade?.color || "#e6edf3" }}>
                  {efficiency.grade?.emoji} {Math.round(efficiency.efficiencyRatio * 100)}%
                </div>
                <div className="stat-label">Turn Efficiency</div>
                <div className="stat-sub">{efficiency.productiveTurns} productive / {efficiency.turnCount} total</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: efficiency.recoverySpeed.avgTurns <= 2 ? "#3fb950" : "#f85149" }}>
                  {efficiency.recoverySpeed.avgTurns || "—"}
                </div>
                <div className="stat-label">Avg Recovery</div>
                <div className="stat-sub">turns after redirect ({efficiency.recoverySpeed.incidents} incidents)</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{efficiency.completion?.emoji}</div>
                <div className="stat-label">{efficiency.completion?.label}</div>
                <div className="stat-sub">session outcome</div>
              </div>
            </>
          )}
          {sprawl && (
            <div className="stat-card">
              <div className="stat-value" style={{ color: sprawl.level?.color === "red" ? "#f85149" : sprawl.level?.color === "yellow" ? "#d29922" : "#3fb950" }}>
                {sprawl.level?.emoji} {sprawl.sprawlScore}
              </div>
              <div className="stat-label">{sprawl.level?.label}</div>
              <div className="stat-sub">{sprawl.fileSpread?.directories} dirs, {sprawl.fileSpread?.files} files touched</div>
            </div>
          )}
        </div>
      )}

      {/* Category breakdown + thrashing side by side */}
      <div className="charts-grid" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">Category Breakdown</div>
          <CategoryBreakdown categoryTotals={categoryBreakdown} />
        </div>
        <div className="card">
          <div className="card-header">
            {thrashedFiles.length > 0 ? "⚠️ File Thrashing" : "File Edits"}
          </div>
          {thrashedFiles.length > 0 ? (
            <ul className="thrash-list">
              {thrashedFiles.map((f, i) => (
                <li key={i} className="thrash-item">
                  <code>{f.file_path}</code>
                  <span className="thrash-count">{f.edit_count} edits</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty" style={{ padding: 30 }}>
              <p>No file thrashing detected ✅</p>
            </div>
          )}
        </div>
      </div>
      </>)}

      {tab === "deep-dive" && (<>
      {/* Sprawl details */}
      {sprawl && (sprawl.scopeAdditions?.length > 0 || sprawl.topicShifts?.length > 0) && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">📐 Session Sprawl</div>
          {sprawl.scopeAdditions?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, color: "#d29922", marginBottom: 8 }}>
                Scope Additions ({sprawl.scopeAdditions.length})
              </h3>
              {sprawl.scopeAdditions.map((s, i) => (
                <div key={i} className="sprawl-item">
                  <span className="sprawl-turn">Turn {s.turnIndex}</span>
                  <span className="sprawl-label">{s.label}</span>
                  <span className="sprawl-msg">{s.message}</span>
                </div>
              ))}
            </div>
          )}
          {sprawl.topicShifts?.length > 0 && (
            <div>
              <h3 style={{ fontSize: 14, color: "#58a6ff", marginBottom: 8 }}>
                Topic Shifts ({sprawl.topicShifts.length})
              </h3>
              {sprawl.topicShifts.map((s, i) => (
                <div key={i} className="sprawl-item">
                  <span className="sprawl-turn">Turn {s.fromTurn} → {s.toTurn}</span>
                  <span className="sprawl-msg">{s.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Anti-pattern signals */}
      {efficiency && (efficiency.dripFeeding?.count > 0 || efficiency.responseSkimming?.count > 0) && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">⚠️ Anti-Patterns Detected</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {efficiency.dripFeeding?.count > 0 && (
              <div style={{ flex: 1, minWidth: 250 }}>
                <h3 style={{ fontSize: 14, color: "#d29922", marginBottom: 8 }}>
                  💧 Context Drip-Feeding ({efficiency.dripFeeding.count})
                </h3>
                {efficiency.dripFeeding.instances.map((d, i) => (
                  <div key={i} className="sprawl-item">
                    <span className="sprawl-turn">Turn {d.turnIndex}</span>
                    <span className="sprawl-msg">{d.message}</span>
                  </div>
                ))}
              </div>
            )}
            {efficiency.responseSkimming?.count > 0 && (
              <div style={{ flex: 1, minWidth: 250 }}>
                <h3 style={{ fontSize: 14, color: "#f85149", marginBottom: 8 }}>
                  👀 Response Skimming ({efficiency.responseSkimming.count})
                </h3>
                {efficiency.responseSkimming.instances.map((s, i) => (
                  <div key={i} className="sprawl-item">
                    <span className="sprawl-turn">Turn {s.turnIndex}</span>
                    <span className="sprawl-msg">{s.message}</span>
                    <span className="stat-sub">({s.responseLength} char response → {s.userMessageLength} char reply)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Session replay annotations (falls back to redirection timeline) */}
      <div className="card">
        <div className="card-header">{replay ? "🎬 Session Replay" : "Redirection Timeline"}</div>
        {replay?.turns?.length > 0 ? (
          <div style={{ padding: "12px 0", maxHeight: 600, overflowY: "auto" }}>
            {replay.turns.map((turn) => (
              <div
                key={turn.turnIndex}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 16px",
                  borderBottom: "1px solid #30363d",
                }}
              >
                <span style={{ fontSize: 12, color: "#8b949e", minWidth: 32, fontVariantNumeric: "tabular-nums" }}>
                  #{turn.turnIndex}
                </span>
                <span style={{ fontSize: 16, minWidth: 24 }}>
                  {turn.speaker === "user" ? "👤" : "🤖"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#e6edf3", marginBottom: turn.tags?.length ? 6 : 0, wordBreak: "break-word" }}>
                    {turn.messagePreview}
                  </div>
                  {turn.tags?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {turn.tags.map((tag, ti) => (
                        <span
                          key={ti}
                          title={tag.tip || tag.label}
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#0d1117",
                            backgroundColor: tag.color || "#8b949e",
                            cursor: tag.tip ? "help" : "default",
                          }}
                        >
                          {tag.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "12px 0" }}>
            <RedirectionTimeline redirections={redirections} />
          </div>
        )}
      </div>
      </>)}
    </>
  );
}
