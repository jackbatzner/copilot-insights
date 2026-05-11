import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchSessionDetail, fetchSessionSprawl, fetchSessionEfficiency, fetchSessionReplay, fetchSessionComplexity, fetchHiddenSessions, hideSession, unhideSession, fetchSessionTokens, fetchChronicleImprove, fetchSessionIntent, fetchIntentSuggestion, setSessionIntent } from "../api.js";
import { ScoreBadge, rateColor, CATEGORY_META } from "../components/ScoreBadge.jsx";
import { CategoryBreakdown } from "../components/CategoryBreakdown.jsx";
import { RedirectionTimeline } from "../components/RedirectionTimeline.jsx";
import { MetricHelp } from "../components/MetricHelp";
import { TabBar, TabPanel } from "../components/TabBar.jsx";
import { SkeletonGrid, SkeletonCard } from "../components/SkeletonCard.jsx";

export default function SessionDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [sprawl, setSprawl] = useState(null);
  const [efficiency, setEfficiency] = useState(null);
  const [replay, setReplay] = useState(null);
  const [complexity, setComplexity] = useState(null);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [improve, setImprove] = useState(null);
  const [isHidden, setIsHidden] = useState(false);
  const [tab, setTab] = useState("summary");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessionIntent, setSessionIntentState] = useState(null);
  const [intentSuggestion, setIntentSuggestion] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setSessionIntentState(null);
    setIntentSuggestion(null);
    Promise.all([
      fetchSessionDetail(id),
      fetchSessionSprawl(id).catch(() => null),
      fetchSessionEfficiency(id).catch(() => null),
      fetchSessionReplay(id).catch(() => null),
      fetchSessionComplexity(id).catch(() => null),
      fetchHiddenSessions().catch(() => ({ sessionIds: [] })),
      fetchSessionTokens(id).catch(() => null),
      fetchChronicleImprove(id).catch(() => null),
      fetchSessionIntent(id).catch(() => null),
      fetchIntentSuggestion(id).catch(() => null),
    ])
      .then(([d, s, e, r, c, h, t, imp, intentData, suggestion]) => {
        setData(d);
        setSprawl(s);
        setEfficiency(e);
        setReplay(r);
        setComplexity(c);
        setIsHidden(h.sessionIds.includes(id));
        setTokenInfo(t);
        setImprove(imp);
        setSessionIntentState(intentData?.intent ?? null);
        setIntentSuggestion(suggestion);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    return () => { /* cleanup: stale fetch guard handled by loading state */ };
  }, [id]);

  const toggleHide = useCallback(async () => {
    try {
      if (isHidden) { await unhideSession(id); setIsHidden(false); }
      else { await hideSession(id); setIsHidden(true); }
    } catch (err) {
      console.warn("Failed to toggle session visibility:", err.message);
    }
  }, [id, isHidden]);

  if (loading) return (
    <>
      <div className="page-header"><h1>Session Detail</h1></div>
      <SkeletonGrid count={4} />
      <SkeletonCard lines={5} />
      <SkeletonCard lines={3} />
    </>
  );
  if (error) return (
    <div className="empty">
      <div className="empty-icon">⚠️</div>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {error.includes("HTTP 404")
          ? "Session not found. It may have been deleted or the ID is incorrect."
          : error.includes("HTTP 500")
          ? "Couldn't load session details. Make sure the Copilot Insights server is running."
          : error}
      </p>
    </div>
  );
  if (!data) return null;

  const { session, stats, categoryBreakdown, redirections, thrashedFiles } =
    data;

  const isLearningSession = complexity && complexity.breakdown && complexity.breakdown.fileOps === 0 && complexity.breakdown.uniqueFiles === 0;

  // Testing/feedback session detection:
  // 1. Scan user messages for feedback-like language patterns
  // 2. Also check structural signals: high turns, repeated file edits, plan mode usage
  const isTestingSession = (() => {
    if (isLearningSession) return false;
    const FEEDBACK_PATTERNS = /\b(feedback|round of|another round|testing|let'?s fix|here'?s what|improvements?|issues?:|bugs?:|fix(es|ing)?:|update(s|d)?:|change(s|d)?:|should be|needs to|doesn'?t (work|look|line|align|match)|still (not|doesn'?t|broken|wrong|missing)|try again|one more)\b/i;
    const PLAN_PATTERNS = /\[\[PLAN\]\]|plan mode/i;

    let feedbackTurns = 0;
    let planTurns = 0;
    const userMessages = replay?.turns?.filter(t => t.speaker === "user") || [];

    for (const turn of userMessages) {
      const msg = turn.messagePreview || "";
      if (FEEDBACK_PATTERNS.test(msg)) feedbackTurns++;
      if (PLAN_PATTERNS.test(msg)) planTurns++;
    }

    // Auto-suggest if: multiple feedback-patterned turns, or plan mode + high corrections
    const hasFeedbackLanguage = feedbackTurns >= 3;
    const hasStructuralSignals = session.turnCount >= 20 && stats.redirectionRate >= 0.15 && complexity?.breakdown?.fileOps > 3;

    return hasFeedbackLanguage || (planTurns >= 2 && hasStructuralSignals);
  })();

  const handleIntentChange = async (intent) => {
    const newIntent = sessionIntent === intent ? null : intent;
    const previousIntent = sessionIntent;
    setSessionIntentState(newIntent);
    try {
      await setSessionIntent(id, newIntent);
    } catch (err) {
      setSessionIntentState(previousIntent);
      console.warn("Failed to save intent:", err.message);
    }
  };

  return (
    <>
      <Link to="/sessions" className="back-link">
        ← Back to Sessions
      </Link>

      <div className="page-header" style={{ flexDirection: "column", alignItems: "flex-start" }}>
        <h1>🔍 Session Detail</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", maxWidth: "100%" }}>
          <p style={{ margin: 0, minWidth: 0 }}>
            <code style={{ wordBreak: "break-all", fontSize: "clamp(10px, 2.5vw, 14px)" }}>{session.id}</code>
          </p>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 8px",
              borderRadius: 999,
              border: "1px solid var(--border-color)",
              background: "rgba(88, 166, 255, 0.08)",
              color: "var(--accent)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            CLI
          </span>
          <button
            onClick={toggleHide}
            style={{
              background: isHidden ? "#da3633" : "var(--bg-card)",
              color: isHidden ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13,
              whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            {isHidden ? "🙈 Hidden from analysis" : "Hide from analysis"}
          </button>
        </div>
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
            <div style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>
              <code style={{ wordBreak: "break-all" }}>{session.branch}</code>
            </div>
          </div>
        )}
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-header">Total Turns</div>
          <div className="stat-value">{session.turnCount}</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-header"><MetricHelp
            label="Redirections"
            definition="Turns where you corrected, redirected, or repeated yourself to the agent. Each one means the agent didn't do what you wanted on the first try."
            target="Fewer is better. Under 10% of turns is smooth; over 25% means your opening prompt needed more context."
            action="Add file paths, constraints, and acceptance criteria to your first message. The clearer your initial prompt, the fewer redirections you'll need."
          /></div>
          <div className={`stat-value ${rateColor(stats.redirectionRate)}`}>
            {stats.totalRedirections}
          </div>
          <div className="stat-label">
            <ScoreBadge rate={stats.redirectionRate} />
          </div>
        </div>
        {stats.autoGeneratedCount > 0 && (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="card-header">Auto-generated</div>
            <div className="stat-value" style={{ color: "#6e7681" }}>
              🤖 {stats.autoGeneratedCount}
            </div>
            <div className="stat-label">turns excluded</div>
          </div>
        )}
        {complexity && (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="card-header"><MetricHelp
              label="Complexity"
              definition="A measure of how complex this session was — based on file operations, unique files touched, and checkpoints created."
              target="Not a target — just context. Higher complexity sessions naturally have more redirections."
            /></div>
            <div className="stat-value">{complexity.tierEmoji} {complexity.complexityScore}</div>
            <div className="stat-label">{complexity.tier}</div>
            <div className="stat-sub">{complexity.fileOps} ops · {complexity.uniqueFiles} files · {complexity.checkpointCount} checkpoints</div>
          </div>
        )}
      </div>

      {/* Session Intent */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Session Intent</div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          What was this session&apos;s purpose? This adjusts how your scores are calculated.
        </p>
        {intentSuggestion && !sessionIntent && (
          <div style={{
            background: "var(--bg-hover)",
            border: "1px solid var(--accent)",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 8,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}>
            <span>💡 Suggested: <strong>{intentSuggestion.intent.charAt(0).toUpperCase() + intentSuggestion.intent.slice(1)}</strong></span>
            <span style={{ color: "var(--text-muted)" }}>
              ({intentSuggestion.confidence} confidence{intentSuggestion.signals.length > 0 ? ` — ${intentSuggestion.signals[0]}` : ""})
            </span>
            <button
              onClick={() => handleIntentChange(intentSuggestion.intent)}
              style={{
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: 11,
                marginLeft: "auto",
              }}
            >
              Accept
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { id: "build", emoji: "🎯", label: "Build", desc: "Clear deliverable" },
            { id: "explore", emoji: "🧠", label: "Explore", desc: "Research & learn" },
            { id: "iterate", emoji: "🔄", label: "Iterate", desc: "Brainstorm & Improve" },
            { id: "debug", emoji: "🔧", label: "Debug", desc: "Troubleshoot" },
          ].map(({ id: intentId, emoji, label, desc }) => (
            <button
              key={intentId}
              onClick={() => handleIntentChange(intentId)}
              style={{
                background: sessionIntent === intentId ? "var(--accent)" : "var(--bg-card)",
                color: sessionIntent === intentId ? "#fff" : "var(--text-secondary)",
                border: `1px solid ${sessionIntent === intentId ? "var(--accent)" : "var(--border-color)"}`,
                borderRadius: 8,
                padding: "8px 16px",
                cursor: "pointer",
                fontSize: 13,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                minWidth: 90,
              }}
            >
              <span style={{ fontSize: 18 }}>{emoji}</span>
              <strong>{label}</strong>
              <span style={{ fontSize: 10, opacity: 0.7 }}>{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {session.summary && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">Summary</div>
          <p>{session.summary}</p>
        </div>
      )}

      <TabBar
        tabs={[
          { id: "summary", label: "📊 Summary" },
          { id: "deep-dive", label: "🎬 Deep Dive" },
          { id: "improve", label: "📈 Chronicle Improve" },
          { id: "tokens", label: "💰 Tokens" },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      <TabPanel id="summary" activeTab={tab}>
      {/* Session grade + coaching tips from replay */}
      {replay?.summary && (() => {
        const gradeColors = { A: "#3fb950", B: "#58a6ff", C: "#d29922", D: "#f85149" };
        const grade = replay.summary.overallGrade;
        return (
          <>
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-value" style={{ color: gradeColors[grade] || "var(--text)", fontSize: 36 }}>
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
              <div className="stat-label">Areas to Improve</div>
              <div className="stat-sub">{replay.summary.redirectionCount} redirections · {replay.summary.dripFeedCount} drip-feeds · {replay.summary.rubberStampCount} rubber stamps</div>
            </div>
          </div>
          <div className="card" style={{ marginBottom: 24, borderLeft: `3px solid ${gradeColors[grade] || "var(--text-muted)"}` }}>
            <div className="card-header">📐 Grade Breakdown</div>
            {isLearningSession && (
              <div style={{ background: "rgba(88, 166, 255, 0.1)", border: "1px solid rgba(88, 166, 255, 0.2)", borderRadius: 6, padding: "8px 12px", marginBottom: 8, fontSize: 12, color: "var(--accent)" }}>
                📚 Learning session — delegation metrics don't apply here.
              </div>
            )}
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0" }}>
              Average of delegation + judgment + feedback (each 0-100).
              <strong style={{ color: "var(--text)" }}> A</strong> ≥ 80 · <strong style={{ color: "var(--text)" }}>B</strong> ≥ 65 · <strong style={{ color: "var(--text)" }}>C</strong> ≥ 50 · <strong style={{ color: "var(--text)" }}>D</strong> &lt; 50
            </p>
          </div>
          </>
        );
      })()}

      {replay?.summary?.coachingTips?.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">💡 Coaching Tips</div>
          <ul style={{ margin: 0, padding: "8px 0 0 20px", listStyle: "none" }}>
            {replay.summary.coachingTips.map((tip, i) => (
              <li key={i} style={{ padding: "6px 0", color: "var(--text)", fontSize: 14, lineHeight: 1.5 }}>
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
                <div className="stat-value" style={{ color: efficiency.grade?.color || "var(--text)" }}>
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

      {/* Category breakdown + repeated edits side by side */}
      <div className="charts-grid" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">Category Breakdown</div>
          <CategoryBreakdown categoryTotals={categoryBreakdown} />
        </div>
        <div className="card">
          <div className="card-header">
            <MetricHelp
              label={thrashedFiles.length > 0 ? "⚠️ Repeated File Edits" : "File Edits"}
              definition="When the same file is edited many times in one session — a sign of iterative refinement that could be reduced with clearer initial direction."
              target="Minimal re-editing. If a file is edited 5+ times, consider providing more detail upfront."
              action="Specify expected behavior and constraints in your first message."
            />
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
              <p>No repeated file edits detected ✅</p>
            </div>
          )}
        </div>
      </div>
      </TabPanel>

      <TabPanel id="deep-dive" activeTab={tab}>
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
          <div className="card-header">🔍 Improvement Opportunities</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {efficiency.dripFeeding?.count > 0 && (
              <div style={{ flex: 1, minWidth: 0 }}>
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: 14, color: "#f85149", marginBottom: 8 }}>
                  👀 Response Skimming ({efficiency.responseSkimming.count})
                </h3>
                {efficiency.responseSkimming.instances.map((s, i) => (
                  <div key={i} className="sprawl-item">
                    <span className="sprawl-turn">Turn {s.turnIndex}</span>
                    <span className="sprawl-msg">{s.message}</span>
                    <span className="stat-sub" style={{ wordBreak: "break-word" }}>({s.responseLength} char response → {s.userMessageLength} char reply)</span>
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
                  gap: 8,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 28, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                  #{turn.turnIndex}
                </span>
                <span style={{ fontSize: 16, minWidth: 20, flexShrink: 0 }}>
                  {turn.speaker === "user" ? "👤" : "🤖"}
                </span>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <div style={{ fontSize: 13, color: "var(--text)", marginBottom: turn.tags?.length ? 6 : 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>
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
      </TabPanel>

      <TabPanel id="improve" activeTab={tab}>
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent)" }}>
          <div className="card-header">📈 Chronicle Improve</div>
          <p style={{ color: "var(--text-muted)", fontSize: 12, padding: "0 16px" }}>
            {improve?.overallAdvice || "Chronicle coaching is not available for this session yet. When it is, you'll see concrete suggestions for improving your next similar session."}
          </p>
        </div>

        {improve && improve.suggestions && improve.suggestions.length > 0 ? (
          <div>
            {improve.suggestions.map((s, i) => (
              <div key={i} className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--yellow)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="pillar-pill" data-pillar={s.pillar}>{s.pillar}</span>
                  <strong>{s.issue}</strong>
                </div>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
                    <strong>What happened:</strong> {s.whatHappened}
                  </div>
                  <div style={{ color: "var(--green)" }}>
                    <strong>Better approach:</strong> {s.whatWouldBeBetter}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : improve ? (
          <div className="card" style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <p style={{ color: "var(--text-muted)" }}>
              This session was already well-scoped — no specific Chronicle improvements were identified.
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📝</div>
            <p style={{ color: "var(--text-muted)" }}>
              Chronicle Improve data is not available for this session yet. Session detail scoring on this page currently reflects CLI session data.
            </p>
          </div>
        )}
      </TabPanel>

      <TabPanel id="tokens" activeTab={tab}>
        {tokenInfo ? (
          <div>
            <div className="stats-grid" style={{ marginBottom: 16 }}>
              <div className="card" style={{ textAlign: "center" }}>
                <div className="card-header">Est. Input Tokens</div>
                <div className="stat-value">{(tokenInfo.tokens?.input || tokenInfo.totals?.input || 0).toLocaleString()}</div>
                <div className="stat-sub">your prompts</div>
              </div>
              <div className="card" style={{ textAlign: "center" }}>
                <div className="card-header">Est. Output Tokens</div>
                <div className="stat-value">{(tokenInfo.tokens?.output || tokenInfo.totals?.output || 0).toLocaleString()}</div>
                <div className="stat-sub">agent responses</div>
              </div>
              <div className="card" style={{ textAlign: "center" }}>
                <div className="card-header">Total Tokens</div>
                <div className="stat-value">{(tokenInfo.tokens?.total || tokenInfo.totals?.total || 0).toLocaleString()}</div>
              </div>
              <div className="card" style={{ textAlign: "center" }}>
                <div className="card-header">Est. Cost</div>
                <div className="stat-value" style={{ color: "var(--accent)" }}>
                  {(tokenInfo.estimatedCost || 0) < 0.01 ? "<$0.01" : `$${(tokenInfo.estimatedCost || 0).toFixed(4)}`}
                </div>
                <div className="stat-sub">{tokenInfo.model || "unknown model"}</div>
              </div>
            </div>

            {tokenInfo.turns && tokenInfo.turns.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header" style={{ marginBottom: 8 }}>Per-Turn Token Breakdown</div>
                <div style={{ maxHeight: 400, overflow: "auto" }}>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                        <th style={{ padding: "6px 8px", color: "var(--text-muted)" }}>Turn</th>
                        <th style={{ padding: "6px 8px", color: "var(--text-muted)" }}>Input</th>
                        <th style={{ padding: "6px 8px", color: "var(--text-muted)" }}>Output</th>
                        <th style={{ padding: "6px 8px", color: "var(--text-muted)" }}>Total</th>
                        <th style={{ padding: "6px 8px", color: "var(--text-muted)" }}>Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokenInfo.turns.map((t, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.05))" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 500 }}>{t.turnIndex}</td>
                          <td style={{ padding: "6px 8px" }}>{(t.inputTokens || 0).toLocaleString()}</td>
                          <td style={{ padding: "6px 8px" }}>{(t.outputTokens || 0).toLocaleString()}</td>
                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>{((t.inputTokens || 0) + (t.outputTokens || 0)).toLocaleString()}</td>
                          <td style={{ padding: "6px 8px", color: "var(--text-muted)", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.preview || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
              {tokenInfo.source === "jsonl" 
                ? "✅ Output tokens from real Copilot session data. Input tokens estimated from message text."
                : tokenInfo.source === "events"
                ? "✅ Token data from session events table."
                : "⚡ Token counts estimated from message text (~4 chars/token). Actual usage may differ."
              }
            </div>
          </div>
        ) : (
          <div className="empty" style={{ padding: 24 }}>
            <div className="empty-icon">💰</div>
            <p>Token data not available for this session.</p>
          </div>
        )}
      </TabPanel>
    </>
  );
}
