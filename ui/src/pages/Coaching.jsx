import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchClarity, fetchEfficiency, fetchDelegation, fetchJudgment, fetchDevPlan, fetchChronicleTips, fetchVSCodeSummary } from "../api";
import { TimeframeSelector } from "../components/TimeframeSelector";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { useRefresh } from "../App.jsx";
import { useTimeframe } from "../TimeframeContext.jsx";
import { PageBanner } from "../components/PageBanner.jsx";
import { SuggestedNext } from "../components/SuggestedNext.jsx";
import { MetricHelp } from "../components/MetricHelp.jsx";
import { CollapsibleSection } from "../components/CollapsibleSection.jsx";
import { EmptyState, MIN_SESSIONS_FOR_TRENDS } from "../components/EmptyState.jsx";
import { PILLARS, PILLAR_ORDER, BACKEND_KEY_MAP, getPillarStatus } from "../pillar-config.js";

export default function Coaching() {
  const { key: refreshKey } = useRefresh();
  const { timeframe, setTimeframe } = useTimeframe();
  const [clarity, setClarity] = useState(null);
  const [efficiency, setEfficiency] = useState(null);
  const [delegation, setDelegation] = useState(null);
  const [judgment, setJudgment] = useState(null);
  const [pillarScores, setPillarScores] = useState(null);
  const [tips, setTips] = useState(null);
  const [vscodeSummary, setVSCodeSummary] = useState(null);
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
      fetchDevPlan(timeframe),
      fetchChronicleTips(timeframe).catch(() => null),
      fetchVSCodeSummary().catch(() => null),
    ])
      .then(([c, e, d, j, plan, chronicleTips, vscode]) => {
        setClarity(c);
        setEfficiency(e);
        setDelegation(d);
        setJudgment(j);
        setPillarScores(plan?.pillarScores || null);
        setTips(Array.isArray(chronicleTips) ? { tips: chronicleTips } : chronicleTips);
        setVSCodeSummary(vscode);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="loading">Analyzing coaching metrics…</div>;
  if (error) return (
    <div className="empty">
      <div className="empty-icon">⚠️</div>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {error.includes("HTTP 500")
          ? "Couldn't load coaching data. Make sure the Copilot Insights server is running and your session database exists."
          : error}
      </p>
    </div>
  );

  const sessionCount = delegation?.sessionsAnalyzed ?? clarity?.sessions?.length ?? 0;
  const pillarScoresByKey = Object.fromEntries(
    Object.entries(pillarScores || {}).map(([backendKey, value]) => [BACKEND_KEY_MAP[backendKey] || backendKey, value])
  );
  const pillarFallbacks = {
    intent: clarity?.avgScore,
    workDesign: delegation?.overallDelegationRatio,
    qualityControl: judgment?.avgScore,
    evaluation: efficiency?.aggregate?.avgEfficiency,
  };
  const pillarDetailLines = {
    intent: `Clarity: ${clarity?.avgScore ?? 0} · Efficiency: ${efficiency?.aggregate?.avgEfficiency ?? 0}%`,
    workDesign: `Delegation ratio: ${delegation?.overallDelegationRatio ?? 0}% · Leverage: ${delegation?.overallLeverage ?? 0}x`,
    qualityControl: null,
    evaluation: `Turn efficiency: ${efficiency?.aggregate?.avgEfficiency ?? 0}%`,
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>🎓 Agent Coaching</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>
      <PageBanner pageId="coaching">
        Intent, Work Design, Quality Control, Evaluation — your four AI leadership skills.
      </PageBanner>

      {vscodeSummary?.totalSessions > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--purple)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            VS Code Copilot chats detected in {vscodeSummary.totalSessions} workspace{vscodeSummary.totalSessions === 1 ? "" : "s"}.
            Coaching and dev-plan scores currently reflect CLI sessions only while VS Code support is still separate.
            {" "}
            <a href="/api/vscode/sessions" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              View VS Code sessions →
            </a>
          </div>
        </div>
      )}

      {sessionCount < MIN_SESSIONS_FOR_TRENDS && (
        <EmptyState sessionCount={sessionCount} feature="coaching insights" />
      )}

      {/* Four pillars hero */}
      <div className="stats-grid stats-grid-4">
        {PILLAR_ORDER.map((pillarKey) => {
          const config = PILLARS[pillarKey];
          const score = pillarScoresByKey[pillarKey] ?? pillarFallbacks[pillarKey];
          const status = getPillarStatus(score, pillarKey);

          return (
            <div
              key={pillarKey}
              className={`stat-card pillar-card ${tab === config.oldKey ? "pillar-active" : ""}`}
              onClick={() => setTab(config.oldKey)}
              style={{ cursor: "pointer" }}
            >
              <div className="stat-value" style={{ color: status.color }}>{score ?? "—"}</div>
              <div className="stat-label">
                <MetricHelp
                  label={`${config.emoji} ${config.label}`}
                  definition={config.definition}
                  target={`Target: ${config.target}+`}
                  action={config.action}
                />
              </div>
              <div
                style={{ fontSize: 10, color: "var(--accent)", fontStyle: "italic" }}
                title={config.wtiAnchor}
              >
                {config.subtitle}
              </div>
              <div className="stat-sub">score / 100</div>
              <div className="stat-sub" style={{ color: status.color, fontSize: 11 }}>
                {status.text} · Target: {config.target}+
              </div>
              {pillarDetailLines[pillarKey] && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                  {pillarDetailLines[pillarKey]}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>📊 Overview</button>
        <button className={`tab-btn ${tab === "delegation" ? "active" : ""}`} onClick={() => setTab("delegation")}>🤝 Work Design</button>
        <button className={`tab-btn ${tab === "judgment" ? "active" : ""}`} onClick={() => setTab("judgment")}>🧠 Quality Control</button>
        <button className={`tab-btn ${tab === "specification" ? "active" : ""}`} onClick={() => setTab("specification")}>🎯 Intent</button>
      </div>

      {tab === "overview" && tips && tips.tips && tips.tips.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent)" }}>
          <div className="card-header">💡 Chronicle Coaching Tips</div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
            Personalized tips based on patterns across your recent sessions.
          </p>
          {tips.tips.slice(0, 3).map((tip, i) => (
            <div key={i} style={{ padding: "6px 0", borderTop: i > 0 ? "1px solid var(--border-color)" : "none" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{tip.title || tip.category}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{tip.suggestion || tip.description}</div>
            </div>
          ))}
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
            <Link to="/learn" style={{ color: "var(--accent)" }}>View all tips on Learn tab →</Link>
          </div>
        </div>
      )}

      {tab === "overview" && <OverviewTab clarity={clarity} efficiency={efficiency} delegation={delegation} judgment={judgment} />}
      {tab === "delegation" && <DelegationTab data={delegation} />}
      {tab === "judgment" && <JudgmentTab data={judgment} />}
      {tab === "specification" && <FeedbackTab clarity={clarity} efficiency={efficiency} />}
      <SuggestedNext
        to="/learn"
        icon="📚"
        label="Learn & Grow"
        description="Your personalized improvement plan with goals, retros, and learning resources"
      />
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
      body: `${efficiency.aggregate.totalDripFeeds} times you added context piecemeal. Front-load all requirements in your first message.`,
    }] : []),
    ...(clarity?.avgScore < 50 ? [{
      priority: "high", emoji: "📝", title: "Improve Opening Prompts",
      body: `Average clarity score of ${clarity.avgScore}/100. Include file paths, constraints, and expected behavior upfront.`,
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
          <MiniStat label={<MetricHelp label="Agent Leverage" definition="Ratio of agent output characters to your input characters. Higher means the agent is doing more of the work." target="2x+ is good, 3x+ is excellent." action="Delegate higher-level tasks instead of giving step-by-step instructions." />} value={`${delegation?.overallLeverage ?? 0}x`} sub="output/input ratio" />
          <MiniStat label={<MetricHelp label="File Operations" definition="Number of files the agent created or edited across your sessions. More file operations = agent doing more real work (not just chatting)." target="Higher is better — it means you're using the agent for actual coding tasks." action="When delegating, include specific files and paths. Agents perform best when they know exactly where to make changes." />} value={delegation?.totalFileOps ?? 0} sub="agent-created files" />
          <MiniStat label={<MetricHelp label="Rubber-Stamp Rate" definition="How often you approved agent work and then had to correct it — approving without properly reviewing." target="0% is ideal. Over 30% is heavily penalized." action="Read agent output carefully before approving. Check that it actually does what you asked." />} value={`${judgment?.rubberStampRate ?? 0}%`} sub="approvals before fix" />
          <MiniStat label={<MetricHelp label="Turn Efficiency" definition="Percentage of your turns that are productive (not corrections or redirections)." target="90%+ excellent, 75%+ good, below 60% needs work." action="Provide clearer upfront context to reduce back-and-forth corrections." />} value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="productive turns" />
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
        <MiniStat label={<MetricHelp label="Delegation Ratio" definition="Percentage of your turns that hand off work to the agent (delegations + approvals) vs. micro-managing step-by-step." target="Over 60% means good delegation. Under 30% means you're micro-managing." action="Try single-prompt kickoffs — describe the goal, not the steps." />} value={`${data.overallDelegationRatio}%`} sub="autonomous turns" />
        <MiniStat label={<MetricHelp label="Agent Leverage" definition="Ratio of agent output characters to your input characters." target="2x+ good, 3x+ excellent — agent writing much more than you type." action="Delegate bigger tasks to increase the agent's output per your input." />} value={`${data.overallLeverage}x`} sub="output per input char" />
        <MiniStat label={<MetricHelp label="File Operations" definition="Number of files the agent created or edited. More file operations = agent doing more real work." target="Higher is better for coding tasks. Zero means no code was produced." />} value={data.totalFileOps} sub="agent-touched files" />
        <MiniStat label={<MetricHelp label="Input → Output" definition="Total characters you typed (input) vs. total characters the agent produced (output). A higher ratio means the agent is generating more code per keystroke you invest." target="Higher output-to-input ratio = better delegation. You want the agent writing significantly more than you type." action="Delegate bigger tasks with clear specs instead of providing step-by-step instructions." />} value={`${data.userInputKB}KB`} sub={`→ ${data.agentOutputKB}KB output`} />
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
                  <span className="delegation-legend-label" style={{ color: t.color }}>{t.type}</span>
                  <span className="delegation-legend-count">{t.count}</span>
                  <span className="delegation-legend-desc">{t.description}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
            💡 <strong>Goal:</strong> High delegation + low correction. Shift from telling HOW to defining WHAT.
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
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
            💡 Aim for more Delegator sessions. Reserve Hands-on for genuinely new territory.
          </div>
        </div>
      )}

      {/* Most productive sessions */}
      {data.topDelegated?.length > 0 && (
        <CollapsibleSection title="🚀 Most Productive Sessions" id="coaching-top-delegated" defaultOpen={false}>
          <table className="data-table" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr><th style={{ width: 120, textAlign: "left" }}>Productivity</th><th style={{ width: 160, textAlign: "left" }}>Output</th><th style={{ textAlign: "left" }}>Session</th></tr>
            </thead>
            <tbody>
              {data.topDelegated.slice(0, 5).map((s, i) => (
                <tr key={i}>
                  <td><span className="clarity-badge" style={{ background: "#3fb950" }}>{s.productivity}</span> files/turn</td>
                  <td style={{ fontSize: 12 }}>{s.filesCreated + s.filesEdited} files · {s.turnCount} turns</td>
                  <td className="truncate" style={{ maxWidth: 250 }}><Link to={`/sessions/${s.sessionId || s.id}`}>{s.summary || s.repo || "View session"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
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
        <MiniStat label={<MetricHelp label="Judgment Score" definition="How well you evaluate agent output. Based on catching issues early, avoiding rubber-stamps, and not needing costly late-stage rollbacks. Baseline starts at 70." target="70+ is good, 80+ is excellent." action="Review each agent change before approving. Catch issues early — late catches cost 10 points each." />} value={data.avgScore} sub="/100 average" />
        <MiniStat label="Issues Caught" value={data.totalCatches} sub="problems spotted" />
        <MiniStat label={<MetricHelp label="Late Catches" definition="Issues you caught many turns after they were introduced — costly rollbacks that waste work." target="0 is ideal. Each late catch costs -10 points on your judgment score." action="Review agent output at each step, not just at the end." />} value={data.totalLateCatches} sub="costly rollbacks" />
        <MiniStat label={<MetricHelp label="Rubber-Stamp Rate" definition="How often you approved work then immediately corrected it — a sign of not reviewing carefully." target="0% ideal. Over 30% gets a -15 point penalty." action="Actually check agent output matches your request before saying 'looks good'." />} value={`${data.rubberStampRate}%`} sub="approve → correct" />
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
        <CollapsibleSection title="🔄 Most Revised Files" id="coaching-thrashed" defaultOpen={false}>
          <table className="data-table" style={{ tableLayout: "fixed" }}>
            <thead><tr><th style={{ textAlign: "left" }}>File</th><th style={{ width: 80, textAlign: "left" }}>Edits</th></tr></thead>
            <tbody>
              {data.allThrashed.slice(0, 8).map((f, i) => (
                <tr key={i}>
                  <td className="truncate" style={{ maxWidth: 400 }}>{f.path}</td>
                  <td><span className="clarity-badge" style={{ background: "#f85149" }}>{f.editCount}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}

      {/* Sessions to review */}
      {data.worstJudgment?.length > 0 && (
        <CollapsibleSection title="📋 Sessions to Review" id="coaching-worst-judgment" defaultOpen={false}>
          <table className="data-table" style={{ tableLayout: "fixed" }}>
            <thead><tr><th style={{ width: 80, textAlign: "left" }}>Score</th><th style={{ width: 180, textAlign: "left" }}>Issues</th><th style={{ textAlign: "left" }}>Session</th></tr></thead>
            <tbody>
              {data.worstJudgment.slice(0, 5).map((s, i) => (
                <tr key={i}>
                  <td><span className="clarity-badge" style={{ background: s.score < 40 ? "#f85149" : "#d29922" }}>{s.score}</span></td>
                  <td style={{ fontSize: 12 }}>{s.catches} catches · {s.lateCatches} late</td>
                  <td className="truncate" style={{ maxWidth: 300 }}><Link to={`/sessions/${s.sessionId || s.id}`}>{s.summary || s.repo || "View session"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
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
        <MiniStat label={<MetricHelp label="Clarity Score" definition="Quality of your first message in each session. Checks for file paths, constraints, acceptance criteria, context, and examples." target="70+ is clear communication. Under 50 needs work." action="Include specific files, constraints, and what success looks like in your opening prompt." />} value={clarity?.avgScore ?? "—"} sub="/100 avg first-turn" />
        <MiniStat label={<MetricHelp label="Turn Efficiency" definition="Percentage of turns that are productive vs. corrections/redirections." target="90%+ excellent, 75%+ good." action="Front-load requirements to avoid back-and-forth." />} value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="productive turns" />
        <MiniStat label={<MetricHelp label="Recovery Speed" definition="Average number of turns to get back on track after a redirection." target="Under 1.5 turns is good — quick recoveries." action="When correcting the agent, be specific about what went wrong and what you want instead." />} value={efficiency?.aggregate?.avgRecoveryTurns ?? "—"} sub="turns after redirect" />
        <MiniStat label={<MetricHelp label="Context Drips" definition="Times you added context piecemeal after your first message — 'oh and...', 'I forgot to mention...', 'also...'." target="0 is ideal. Each drip-feed costs 5 points on your feedback score." action="Write down everything the agent needs before sending your first message." />} value={efficiency?.aggregate?.totalDripFeeds ?? 0} sub="piecemeal info adds" />
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
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, padding: "6px 10px", background: "rgba(88, 166, 255, 0.05)", borderRadius: 6 }}>
            Each percentage shows how often this element was <strong style={{ color: "var(--text)" }}>missing from your opening prompts</strong>. Higher % = bigger opportunity to improve. Adding these upfront reduces redirections.
          </div>
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
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, padding: "6px 10px" }}>
            How your sessions ended. <strong style={{ color: "var(--text)" }}>Abandoned</strong> = session stopped before reaching a resolution (no final file changes or approvals after the last exchange). Some abandoned sessions are normal — the task may have become irrelevant.
          </div>
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
        <CollapsibleSection title="🔍 Prompts with Room to Grow" id="coaching-weak-prompts" defaultOpen={false}>
          <table className="data-table" style={{ tableLayout: "fixed" }}>
            <thead><tr><th style={{ width: 80, textAlign: "left" }}>Score</th><th style={{ textAlign: "left" }}>Session</th><th style={{ width: 220, textAlign: "left" }}>Missing</th></tr></thead>
            <tbody>
              {clarity.sessions.slice(0, 8).map((s) => (
                <tr key={s.sessionId}>
                  <td><span className="clarity-badge" style={{ background: clarityColor(s.clarity.score) }}>{s.clarity.score}</span></td>
                  <td className="truncate" title={s.firstMessage}><Link to={`/sessions/${s.sessionId}`}>{s.summary || s.firstMessage?.substring(0, 80) || s.sessionId.slice(0, 8)}</Link></td>
                  <td className="tip-cell">{s.clarity.tips[0] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
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
      body: `Only ${data.overallDelegationRatio}% delegation. Try giving high-level goals and letting the agent choose the approach.\n\n💡 Example: Instead of "Open src/auth.ts, find the verifyToken function, add a try/catch around line 42, and return null on error", try "Add error handling to the token verification in the auth module — if verification fails, return null gracefully."`,
    });
  }
  if (data.overallLeverage < 0.5) {
    suggestions.push({
      priority: "medium", emoji: "📈", title: "Low Agent Leverage",
      body: `Agent output is only ${data.overallLeverage}x your input. You may be writing more than the agent — consider delegating larger chunks.\n\n💡 Example: Instead of "Edit line 45 of auth.js to change the timeout from 30 to 60", try "Update the auth timeout to 60 seconds — the agent knows where to find it."`,
    });
  }
  return suggestions;
}
