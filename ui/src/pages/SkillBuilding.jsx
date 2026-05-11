import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  fetchClarity, fetchEfficiency, fetchDelegation, fetchJudgment,
  fetchDevPlan, fetchChronicleTips, fetchVSCodeSummary,
  fetchProgressCheck, fetchRetro, fetchInstructionGaps,
  fetchTokenEfficiency, fetchDevPlanGoals, addDevPlanGoal, updateDevPlanGoalStatus, deleteDevPlanGoal,
  addGoalNote, fetchJournal,
} from "../api";
import { TimeframeSelector } from "../components/TimeframeSelector";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { useRefresh } from "../App.jsx";
import { useTimeframe } from "../TimeframeContext.jsx";
import { PageBanner } from "../components/PageBanner.jsx";
import { MetricHelp } from "../components/MetricHelp.jsx";
import { CollapsibleSection } from "../components/CollapsibleSection.jsx";
import { EmptyState, MIN_SESSIONS_FOR_TRENDS } from "../components/EmptyState.jsx";
import {
  PILLARS, PILLAR_ORDER, BACKEND_KEY_MAP, getPillarStatus,
  getPillarLabel, getPillarEmoji, getPillarBadgeKey,
} from "../pillar-config.js";

export default function SkillBuilding() {
  const { key: refreshKey } = useRefresh();
  const { timeframe, setTimeframe } = useTimeframe();

  const [clarity, setClarity] = useState(null);
  const [efficiency, setEfficiency] = useState(null);
  const [delegation, setDelegation] = useState(null);
  const [judgment, setJudgment] = useState(null);
  const [plan, setPlan] = useState(null);
  const [tips, setTips] = useState(null);
  const [vscodeSummary, setVSCodeSummary] = useState(null);
  const [progress, setProgress] = useState(null);
  const [retro, setRetro] = useState(null);
  const [gaps, setGaps] = useState(null);
  const [tokenEff, setTokenEff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [addedGoals, setAddedGoals] = useState(new Set());
  const [addingGoal, setAddingGoal] = useState(null);

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
      fetchProgressCheck(timeframe),
      fetchRetro(timeframe),
      fetchInstructionGaps(timeframe).catch(() => null),
      fetchTokenEfficiency(timeframe).catch(() => null),
      fetchDevPlanGoals().catch(() => ({ goals: [] })),
    ])
      .then(([c, e, d, j, p, chronicleTips, vscode, prog, ret, g, te, devplanData]) => {
        setClarity(c);
        setEfficiency(e);
        setDelegation(d);
        setJudgment(j);
        setPlan(p);
        setTips(Array.isArray(chronicleTips) ? { tips: chronicleTips } : chronicleTips);
        setVSCodeSummary(vscode);
        setProgress(prog);
        setRetro(ret);
        setGaps(g);
        setTokenEff(te);
        const existingGoals = devplanData?.goals?.filter((goal) => goal.status === "active").map((goal) => goal.title) || [];
        setAddedGoals(new Set(existingGoals));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="loading">Building your skill profile…</div>;
  if (error) return (
    <div className="empty">
      <div className="empty-icon">⚠️</div>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {error.includes("HTTP 500")
          ? "Couldn't load skill data. Make sure the Copilot Insights server is running and your session database exists."
          : error}
      </p>
    </div>
  );

  const pillarScores = plan?.pillarScores || {};
  const sessionCount = delegation?.sessionsAnalyzed ?? clarity?.sessions?.length ?? 0;
  const pillarScoresByKey = Object.fromEntries(
    Object.entries(pillarScores).map(([backendKey, value]) => [BACKEND_KEY_MAP[backendKey] || backendKey, value])
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

  // Pillar tab keys use backend keys for consistency
  const tabToPillarKey = { specification: "intent", delegation: "workDesign", judgment: "qualityControl", efficiency: "evaluation" };
  const pillarTabs = [
    { id: "overview", label: "📊 Overview" },
    { id: "specification", label: "🎯 Intent" },
    { id: "delegation", label: "🤝 Work Design" },
    { id: "judgment", label: "🧠 Quality Control" },
    { id: "efficiency", label: "⚡ Evaluation" },
    { id: "retro", label: "🔄 Retro" },
    { id: "plan", label: "📋 Dev Plan" },
  ];

  // Build Quick Wins — combine Chronicle Tips + dev-plan quick wins
  const quickWinItems = [];
  const tipItems = tips?.tips || [];
  if (tipItems.length > 0) {
    quickWinItems.push(...tipItems.slice(0, 2).map((tip) => ({
      source: "chronicle",
      emoji: getPillarEmoji(tip.pillar),
      pillar: tip.pillar,
      title: tip.title,
      description: tip.suggestion || tip.description,
      metric: tip.evidence || "",
    })));
  }
  if (plan?.quickWins?.length > 0) {
    for (const w of plan.quickWins) {
      if (quickWinItems.length >= 3) break;
      quickWinItems.push({ source: "devplan", ...w });
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>🎯 Skill Building</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>
      <PageBanner pageId="skills">
        Build your AI leadership skills: Intent, Work Design, Quality Control, and Evaluation.{" "}
        <a href="https://www.microsoft.com/en-us/worklab/work-trend-index/agents-human-agency-and-the-opportunity-for-every-organization" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
          Grounded in Microsoft's 2026 Work Trends Index →
        </a>
      </PageBanner>

      {vscodeSummary?.totalSessions > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--purple)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            VS Code Copilot chats detected in {vscodeSummary.totalSessions} workspace{vscodeSummary.totalSessions === 1 ? "" : "s"}.
            {vscodeSummary.pillarScores ? " VS Code turn-level analysis is included in scoring." : " Scoring currently reflects CLI sessions."}
            {" "}
            <Link to="/vscode" style={{ color: "var(--accent)" }}>View VS Code sessions →</Link>
          </div>
        </div>
      )}

      {sessionCount < MIN_SESSIONS_FOR_TRENDS && (
        <EmptyState sessionCount={sessionCount} feature="skill insights" />
      )}

      {/* Pillar score hero cards */}
      <div className="stats-grid stats-grid-4">
        {PILLAR_ORDER.map((pillarKey) => {
          const config = PILLARS[pillarKey];
          const score = pillarScoresByKey[pillarKey] ?? pillarFallbacks[pillarKey];
          const status = getPillarStatus(score, pillarKey);
          const tabKey = Object.entries(tabToPillarKey).find(([, v]) => v === pillarKey)?.[0];

          return (
            <div
              key={pillarKey}
              className={`stat-card pillar-card ${tab === tabKey ? "pillar-active" : ""}`}
              onClick={() => tabKey && setTab(tabKey)}
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
              <div style={{ fontSize: 10, color: "var(--accent)", fontStyle: "italic" }} title={config.wtiAnchor}>
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

      {/* Quick Wins */}
      {quickWinItems.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--green)" }}>
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚡ Quick Wins — Start Here</span>
            <button
              onClick={() => setTab("plan")}
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}
            >
              View full plan →
            </button>
          </div>
          {quickWinItems.map((w, i) => (
            <div key={i} className="opportunity-item quick-win">
              <div className="opp-header">
                <span className="pillar-pill" data-pillar={getPillarBadgeKey(w.pillar)}>{getPillarLabel(w.pillar)}</span>
                <strong>{w.title}</strong>
                {w.source === "chronicle" && <span style={{ fontSize: 10, color: "var(--purple)", marginLeft: 6 }}>💡 Chronicle</span>}
                <span style={{ marginLeft: "auto" }}>
                  <AddToDevPlanButton
                    pillar={w.pillar}
                    title={w.title}
                    description={w.description}
                    source={w.source === "chronicle" ? "chronicle-tip" : "quick-win"}
                    baselineScore={pillarScoresByKey[w.pillar] ?? pillarFallbacks[w.pillar]}
                    addedGoals={addedGoals}
                    setAddedGoals={setAddedGoals}
                    addingGoal={addingGoal}
                    setAddingGoal={setAddingGoal}
                  />
                </span>
              </div>
              <p className="opp-desc">{w.description}</p>
              {w.metric && <div className="opp-metric">{w.metric}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="tab-bar">
        {pillarTabs.map((t) => (
          <button key={t.id} className={`tab-btn${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab clarity={clarity} efficiency={efficiency} delegation={delegation} judgment={judgment} tips={tips} addedGoals={addedGoals} setAddedGoals={setAddedGoals} addingGoal={addingGoal} setAddingGoal={setAddingGoal} />}
      {tab === "specification" && <IntentTab clarity={clarity} efficiency={efficiency} addedGoals={addedGoals} setAddedGoals={setAddedGoals} addingGoal={addingGoal} setAddingGoal={setAddingGoal} />}
      {tab === "delegation" && <WorkDesignTab data={delegation} />}
      {tab === "judgment" && <QualityControlTab data={judgment} addedGoals={addedGoals} setAddedGoals={setAddedGoals} addingGoal={addingGoal} setAddingGoal={setAddingGoal} />}
      {tab === "efficiency" && <EvaluationTab efficiency={efficiency} tokenEff={tokenEff} delegation={delegation} />}
      {tab === "retro" && retro && <RetroTab retro={retro} addedGoals={addedGoals} setAddedGoals={setAddedGoals} addingGoal={addingGoal} setAddingGoal={setAddingGoal} />}
      {tab === "plan" && plan && <DevPlanTab plan={plan} gaps={gaps} addedGoals={addedGoals} setAddedGoals={setAddedGoals} addingGoal={addingGoal} setAddingGoal={setAddingGoal} />}
    </div>
  );
}

/* ── Overview Tab ──────────────────────────────────────────── */

function OverviewTab({ clarity, efficiency, delegation, judgment, tips, addedGoals, setAddedGoals, addingGoal, setAddingGoal }) {
  const allSuggestions = [
    ...((judgment?.suggestions || []).map((suggestion) => ({
      ...suggestion,
      pillar: suggestion.pillar || "qualityControl",
      source: suggestion.source || "coaching-suggestion",
      baselineScore: suggestion.baselineScore ?? judgment?.avgScore,
    }))),
    ...(delegation ? buildDelegationSuggestions(delegation).map((suggestion) => ({
      ...suggestion,
      pillar: suggestion.pillar || "workDesign",
      source: suggestion.source || "coaching-suggestion",
      baselineScore: suggestion.baselineScore ?? delegation?.overallDelegationRatio,
    })) : []),
    ...(efficiency?.aggregate?.totalDripFeeds > 5 ? [{
      priority: "medium", emoji: "💧", title: "Reduce Drip-Feeding",
      body: `${efficiency.aggregate.totalDripFeeds} times you added context piecemeal. Front-load all requirements in your first message.`,
      pillar: "intent",
      source: "coaching-suggestion",
      baselineScore: clarity?.avgScore,
    }] : []),
    ...(clarity?.avgScore < 50 ? [{
      priority: "high", emoji: "📝", title: "Improve Opening Prompts",
      body: `Average Intent score of ${clarity.avgScore}/100. Include file paths, constraints, and expected behavior upfront.`,
      pillar: "intent",
      source: "coaching-suggestion",
      baselineScore: clarity?.avgScore,
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
          <MiniStat label={<MetricHelp label="Agent Leverage" definition="Ratio of agent output to your input. Higher means the agent does more work." target="2x+ good, 3x+ excellent." action="Delegate higher-level tasks." />} value={`${delegation?.overallLeverage ?? 0}x`} sub="output/input ratio" />
          <MiniStat label={<MetricHelp label="File Operations" definition="Files the agent created or edited." target="Higher = agent doing real coding work." />} value={delegation?.totalFileOps ?? 0} sub="agent-created files" />
          <MiniStat label={<MetricHelp label="Rubber-Stamp Rate" definition="How often you approved then corrected — approving without reviewing." target="0% ideal, over 30% penalized." action="Review agent output before approving." />} value={`${judgment?.rubberStampRate ?? 0}%`} sub="approvals before fix" />
          <MiniStat label={<MetricHelp label="Turn Efficiency" definition="Percentage of productive turns (not corrections)." target="90%+ excellent, 75%+ good." action="Provide clearer upfront context." />} value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="productive turns" />
        </div>
      </div>

      {allSuggestions.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Top Coaching Tips</div>
          <SuggestionsStack
            suggestions={allSuggestions.slice(0, 5)}
            showAddButton
            addedGoals={addedGoals}
            setAddedGoals={setAddedGoals}
            addingGoal={addingGoal}
            setAddingGoal={setAddingGoal}
          />
        </div>
      )}
    </>
  );
}

/* ── Intent Tab (was FeedbackTab / Specification) ──────────── */

function IntentTab({ clarity, efficiency, addedGoals, setAddedGoals, addingGoal, setAddingGoal }) {
  return (
    <>
      <p className="page-intro">
        How effectively you set clear intent — defining the desired outcome and quality bar.
        Clear intent = fewer iterations, faster results.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label={<MetricHelp label="Intent Score" definition="Quality of your first message. Checks for file paths, constraints, acceptance criteria, context." target="70+ is clear. Under 50 needs work." action="Include specific files, constraints, and what success looks like." />} value={clarity?.avgScore ?? "—"} sub="/100 avg first-turn" />
        <MiniStat label={<MetricHelp label="Turn Efficiency" definition="Percentage of productive turns vs. corrections." target="90%+ excellent, 75%+ good." action="Front-load requirements." />} value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="productive turns" />
        <MiniStat label={<MetricHelp label="Recovery Speed" definition="Turns to get back on track after a redirection." target="Under 1.5 turns is good." action="Be specific about what went wrong." />} value={efficiency?.aggregate?.avgRecoveryTurns ?? "—"} sub="turns after redirect" />
        <MiniStat label={<MetricHelp label="Context Drips" definition="Times you added context piecemeal after your first message." target="0 is ideal." action="Write everything the agent needs before sending." />} value={efficiency?.aggregate?.totalDripFeeds ?? 0} sub="piecemeal info adds" />
      </div>

      {clarity && (
        <div className="card">
          <div className="card-header">📏 First-Turn Intent Distribution</div>
          <ClarityBar distribution={clarity.distribution} />
        </div>
      )}

      {clarity?.topTips?.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Most Common Intent Gaps</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, padding: "6px 10px", background: "rgba(88, 166, 255, 0.05)", borderRadius: 6 }}>
            Each percentage shows how often this element was <strong style={{ color: "var(--text)" }}>missing from your opening prompts</strong>.
          </div>
          <div className="tips-list">
            {clarity.topTips.map((t, i) => (
              <div key={i} className="tip-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="tip-bar-track"><div className="tip-bar-fill" style={{ width: `${t.pct}%` }} /></div>
                <span className="tip-pct">{t.pct}%</span>
                <span className="tip-text">{t.tip}</span>
                <span style={{ marginLeft: "auto", flexShrink: 0 }}>
                  <AddToDevPlanButton
                    pillar="intent"
                    title={`Improve: ${t.tip}`}
                    description={`${t.pct}% of prompts are missing this element.`}
                    source="coaching-suggestion"
                    baselineScore={clarity?.avgScore}
                    addedGoals={addedGoals}
                    setAddedGoals={setAddedGoals}
                    addingGoal={addingGoal}
                    setAddingGoal={setAddingGoal}
                  />
                </span>
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
            <p className="coaching-tip"><strong>Fix:</strong> Write everything the agent needs in your first message.</p>
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
        <CollapsibleSection title="🔍 Prompts with Room to Grow" id="skills-weak-prompts" defaultOpen={false}>
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

/* ── Work Design Tab (was DelegationTab) ───────────────────── */

function WorkDesignTab({ data }) {
  if (!data) return null;

  return (
    <>
      <p className="page-intro">
        How you divide work between yourself and the agent. Good work design means you give goals
        and let the agent figure out the approach.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label={<MetricHelp label="Work Design Ratio" definition="Percentage of turns that hand off work to the agent vs. micro-managing." target="Over 60% means good delegation." action="Try single-prompt kickoffs." />} value={`${data.overallDelegationRatio}%`} sub="autonomous turns" />
        <MiniStat label={<MetricHelp label="Agent Leverage" definition="Ratio of agent output to your input." target="2x+ good, 3x+ excellent." action="Delegate bigger tasks." />} value={`${data.overallLeverage}x`} sub="output per input char" />
        <MiniStat label={<MetricHelp label="File Operations" definition="Files the agent created or edited." target="Higher is better for coding tasks." />} value={data.totalFileOps} sub="agent-touched files" />
        <MiniStat label={<MetricHelp label="Input → Output" definition="Total input vs output characters." target="Higher output ratio = better work design." action="Delegate bigger tasks with clear specs." />} value={`${data.userInputKB}KB`} sub={`→ ${data.agentOutputKB}KB output`} />
      </div>

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

      {data.topDelegated?.length > 0 && (
        <CollapsibleSection title="🚀 Most Productive Sessions" id="skills-top-delegated" defaultOpen={false}>
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

/* ── Quality Control Tab (was JudgmentTab) ─────────────────── */

function QualityControlTab({ data, addedGoals, setAddedGoals, addingGoal, setAddingGoal }) {
  if (!data) return null;

  return (
    <>
      <p className="page-intro">
        How well you evaluate AI output. Good quality control means catching issues early,
        not rubber-stamping work, and treating AI output as a starting point.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label={<MetricHelp label="Quality Control Score" definition="How well you evaluate agent output. Based on catching issues early, avoiding rubber-stamps." target="70+ good, 80+ excellent." action="Review each agent change before approving." />} value={data.avgScore} sub="/100 average" />
        <MiniStat label="Issues Caught" value={data.totalCatches} sub="problems spotted" />
        <MiniStat label={<MetricHelp label="Late Catches" definition="Issues caught many turns after introduction — costly rollbacks." target="0 ideal. Each costs -10 points." action="Review at each step." />} value={data.totalLateCatches} sub="costly rollbacks" />
        <MiniStat label={<MetricHelp label="Rubber-Stamp Rate" definition="How often you approved then corrected." target="0% ideal. Over 30% penalized." action="Check agent output before saying 'looks good'." />} value={`${data.rubberStampRate}%`} sub="approve → correct" />
      </div>

      {data.scoreBuckets?.length > 0 && (
        <div className="card">
          <div className="card-header">📊 Score Distribution</div>
          <div style={{ padding: 8 }}>
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
          <SuggestionsStack
            suggestions={data.suggestions}
            showAddButton
            defaultPillar="qualityControl"
            defaultSource="coaching-suggestion"
            defaultBaselineScore={data.avgScore}
            addedGoals={addedGoals}
            setAddedGoals={setAddedGoals}
            addingGoal={addingGoal}
            setAddingGoal={setAddingGoal}
          />
        </div>
      )}

      {data.allThrashed?.length > 0 && (
        <CollapsibleSection title="🔄 Most Revised Files" id="skills-thrashed" defaultOpen={false}>
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

      {data.worstJudgment?.length > 0 && (
        <CollapsibleSection title="📋 Sessions to Review" id="skills-worst-judgment" defaultOpen={false}>
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

/* ── Evaluation Tab (NEW — was missing) ────────────────────── */

function EvaluationTab({ efficiency, tokenEff, delegation }) {
  const completionRate = delegation?.sessionsAnalyzed > 0
    ? Math.round((Math.max((delegation?.sessionsWithCommits || 0) + (delegation?.sessionsWithPRs || 0), delegation?.sessionsWithFiles || 0) / delegation.sessionsAnalyzed) * 100)
    : 0;

  return (
    <>
      <p className="page-intro">
        Building evaluation discipline — tracking signals to optimize how you and AI collaborate.
        Includes productive turn management, session hygiene, and resource efficiency for future token budgets.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label={<MetricHelp label="Productive Turns" definition="Percentage of turns that are productive (not corrections)." target="90%+ excellent, 75%+ good." action="Provide clearer upfront context." />} value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="non-redirect turns" />
        <MiniStat label={<MetricHelp label="Session Completion" definition="Sessions that produce file changes, commits, or PRs." target="Higher = more productive sessions." />} value={`${completionRate}%`} sub="sessions with outcomes" />
        <MiniStat label={<MetricHelp label="Token Efficiency" definition="How efficiently you use tokens — based on output/input ratio and tokens per productive turn." target="Higher score = less waste." />} value={tokenEff ? `${tokenEff.productiveTokenRatio}%` : "—"} sub="productive token use" />
        <MiniStat label={<MetricHelp label="Token ROI" definition="File operations per 1K tokens — how much real work per token spent." target="Higher = better return on token investment." />} value={tokenEff ? tokenEff.tokenROI : "—"} sub="file ops per 1K tokens" />
      </div>

      {tokenEff && (
        <div className="card">
          <div className="card-header">💰 Resource Efficiency</div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            Understanding your token usage builds evaluation infrastructure — a key skill as AI budgets emerge.
          </p>
          <div className="stats-grid stats-grid-3">
            <MiniStat label="Tokens/Productive Turn" value={tokenEff.tokensPerProductiveTurn?.toLocaleString() ?? "—"} sub="lower is better" />
            <MiniStat label="Total Tokens" value={`${Math.round((tokenEff.totalTokens || 0) / 1000)}K`} sub={`across ${tokenEff.sessionsAnalyzed ?? 0} sessions`} />
            <MiniStat label="Productive Ratio" value={`${tokenEff.productiveTokenRatio ?? 0}%`} sub={`${tokenEff.totalProductiveTurns ?? 0} productive / ${tokenEff.totalRedirectionTurns ?? 0} redirect`} />
          </div>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 12 }}>
        <Link to="/tokens" style={{ color: "var(--accent)" }}>View full token analysis & cost breakdown →</Link>
      </div>

      {efficiency?.aggregate?.completionBreakdown && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">🏁 Session Outcomes</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, padding: "6px 10px" }}>
            How your sessions ended. <strong style={{ color: "var(--text)" }}>Abandoned</strong> = session stopped before resolution.
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
            <p className="coaching-tip"><strong>Fix:</strong> Front-load all requirements in your first message.</p>
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
    </>
  );
}

/* ── Retro Tab ─────────────────────────────────────────────── */

function RetroTab({ retro, addedGoals, setAddedGoals, addingGoal, setAddingGoal }) {
  if (retro.empty) return <div className="empty"><div className="empty-icon">📭</div><p>{retro.message}</p></div>;

  return (
    <>
      <div className="card retro-header" style={{ marginBottom: 16 }}>
        <div className="retro-grade">{retro.grade}</div>
        <div className="retro-summary">
          <h3>Period Retro</h3>
          {retro.period.startDate && retro.period.endDate ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {new Date(retro.period.startDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} – {new Date(retro.period.endDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Weekly review</div>
          )}
          <p>{retro.period.sessions} sessions · {retro.period.totalTurns} turns · Overall {retro.pillarScores.overall}/100</p>
        </div>
      </div>

      <div className="stats-grid stats-grid-2" style={{ gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ borderLeft: "3px solid var(--green)" }}>
          <div className="card-header">✅ Wins</div>
          {retro.wins.length === 0 ? <p className="empty-text">Keep working — wins are coming!</p> : retro.wins.map((w, i) => (
            <div key={i} className="retro-item win"><span>{w.emoji}</span> <span>{w.text}</span></div>
          ))}
        </div>
        <div className="card" style={{ borderLeft: "3px solid var(--red)" }}>
          <div className="card-header">⚠️ Areas to Improve</div>
          {retro.misses.length === 0 ? <p className="empty-text">No major misses — solid work!</p> : retro.misses.map((m, i) => (
            <div key={i} className="retro-item miss"><span>{m.emoji}</span> <span>{m.text}</span></div>
          ))}
        </div>
      </div>

      {retro.trends.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">📊 Trends</div>
          {retro.trends.map((t, i) => (
            <div key={i} className="retro-item trend"><span>{t.direction === "up" ? "📈" : "📉"}</span> <span>{t.text}</span></div>
          ))}
        </div>
      )}

      <div className="card" style={{ borderLeft: "3px solid var(--purple)" }}>
        <div className="card-header">🎯 Next Focus: {getPillarLabel(retro.nextFocus.pillar)}</div>
        <p style={{ margin: "8px 0" }}>{retro.nextFocus.recommendation}</p>
        {retro.nextFocus.resources.length > 0 && (
          <div className="retro-resources">
            {retro.nextFocus.resources.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="resource-link" style={{ flex: 1 }}>
                  📖 {r.title} <span className="resource-provider">{r.provider} · {r.time}</span>
                </a>
                <AddToDevPlanButton
                  pillar={retro.nextFocus.pillar}
                  title={`Read: ${r.title}`}
                  description={`${r.description || r.title} (${r.provider}, ${r.time})`}
                  source="learning-resource"
                  addedGoals={addedGoals}
                  setAddedGoals={setAddedGoals}
                  addingGoal={addingGoal}
                  setAddingGoal={setAddingGoal}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Dev Plan Tab ──────────────────────────────────────────── */

function GoalNotes({ goal, onNoteAdded }) {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      await addGoalNote(goal.id, noteText);
      setNoteText("");
      onNoteAdded();
    } catch (err) {
      console.error("Failed to add note:", err);
    }
    setSaving(false);
  };

  const notes = goal.notes || [];

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, cursor: "pointer", padding: 0 }}
      >
        {expanded ? "▼" : "▶"} Notes & Insights ({notes.length})
      </button>
      {expanded && (
        <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
          {notes.map((n, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{new Date(n.createdAt).toLocaleDateString()}</span>
              <div style={{ marginTop: 2 }}>{n.text}</div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
              placeholder="Any insights or reminders for yourself?"
              style={{
                flex: 1, fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)",
                borderRadius: 6, background: "var(--bg)", color: "var(--text)",
              }}
            />
            <button
              onClick={handleAddNote}
              disabled={saving || !noteText.trim()}
              style={{
                background: "var(--accent)", color: "white", border: "none", borderRadius: 6,
                fontSize: 11, padding: "6px 12px", cursor: saving ? "wait" : "pointer",
                opacity: saving || !noteText.trim() ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DevPlanTab({ plan, gaps, addedGoals, setAddedGoals, addingGoal, setAddingGoal }) {
  const [goals, setGoals] = useState(null);
  const [goalsLoading, setGoalsLoading] = useState(true);

  const loadGoals = useCallback(() => {
    setGoalsLoading(true);
    fetchDevPlanGoals(true)
      .then(data => setGoals(data?.goals || []))
      .catch(() => setGoals([]))
      .finally(() => setGoalsLoading(false));
  }, []);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const handleMarkSufficient = async (id) => {
    await updateDevPlanGoalStatus(id, "sufficient");
    loadGoals();
  };

  const handleRemove = async (id) => {
    await deleteDevPlanGoal(id);
    loadGoals();
  };

  const handleReactivate = async (id) => {
    await updateDevPlanGoalStatus(id, "active");
    loadGoals();
  };

  const activeGoals = (goals || []).filter(g => g.status === "active");
  const completedGoals = (goals || []).filter(g => g.status === "sufficient");

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">🎯 Your Development Goals</div>
        {goalsLoading ? (
          <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>Loading goals…</div>
        ) : activeGoals.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
            <p style={{ fontSize: 13, marginBottom: 4 }}>No development goals yet.</p>
            <p style={{ fontSize: 12 }}>Add tips from the skill tabs or Quick Wins using the <strong>➕ Add to Dev Plan</strong> button.</p>
          </div>
        ) : (
          <div>
            {activeGoals.map((goal) => {
              const improved = goal.baselineScore != null && goal.latestScore != null && goal.latestScore > goal.baselineScore;
              const declined = goal.baselineScore != null && goal.latestScore != null && goal.latestScore < goal.baselineScore;
              return (
                <div key={goal.id} style={{ padding: "12px 12px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span className="pillar-pill" data-pillar={getPillarBadgeKey(goal.pillar)}>{getPillarLabel(goal.pillar)}</span>
                        <strong style={{ fontSize: 13 }}>{goal.title}</strong>
                      </div>
                      {goal.description && (
                        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>{goal.description}</p>
                      )}
                      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                        <span>Added {new Date(goal.addedAt).toLocaleDateString()}</span>
                        {goal.baselineScore != null && goal.latestScore != null && (
                          <span style={{ color: improved ? "var(--green)" : declined ? "var(--red)" : "var(--text-muted)" }}>
                            {improved ? "📈" : declined ? "📉" : "➡️"} Score: {goal.baselineScore} → {goal.latestScore}
                          </span>
                        )}
                        {goal.baselineScore != null && goal.latestScore == null && (
                          <span>Baseline: {goal.baselineScore}</span>
                        )}
                      </div>
                      <GoalNotes goal={goal} onNoteAdded={loadGoals} />
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => handleMarkSufficient(goal.id)}
                        style={{ background: "none", border: "1px solid var(--green)", borderRadius: 6, color: "var(--green)", fontSize: 11, padding: "4px 8px", cursor: "pointer" }}
                        title="Mark as development sufficient"
                      >
                        ✅ Sufficient
                      </button>
                      <button
                        onClick={() => handleRemove(goal.id)}
                        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 11, padding: "4px 8px", cursor: "pointer" }}
                        title="Remove from dev plan"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {completedGoals.length > 0 && (
        <CollapsibleSection title={`✅ Development Sufficient (${completedGoals.length})`} id="skills-completed-goals" defaultOpen={false}>
          <div className="card">
            {completedGoals.map((goal) => (
              <div key={goal.id} style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", opacity: 0.7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span className="pillar-pill" data-pillar={getPillarBadgeKey(goal.pillar)}>{getPillarLabel(goal.pillar)}</span>
                    <span style={{ fontSize: 13, marginLeft: 8 }}>{goal.title}</span>
                    {goal.baselineScore != null && goal.latestScore != null && (
                      <span style={{ fontSize: 11, color: "var(--green)", marginLeft: 8 }}>
                        {goal.baselineScore} → {goal.latestScore}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleReactivate(goal.id)}
                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}
                  >
                    Reactivate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

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
            <Link to="/instructions" style={{ color: "var(--accent)" }}>View all {gaps.totalGaps} gaps →</Link>
          </div>
        </div>
      )}

      {/* Learning resources */}
      {plan.learningPath && (
        <>
          <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--purple)" }}>
            <div className="card-header">📚 Suggested Resources: {getPillarLabel(plan.learningPath.focus)}</div>
            <p style={{ margin: "8px 0", color: "var(--text-muted)", fontSize: 12 }}>
              Explore these resources to strengthen your {getPillarLabel(plan.learningPath.focus)} skills. Add any that interest you to your Dev Plan.
            </p>
          </div>
          {plan.learningPath.primary?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">📖 Priority Reading</div>
              {plan.learningPath.primary.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}><ResourceCard resource={r} priority /></div>
                  <AddToDevPlanButton
                    pillar={plan.learningPath.focus}
                    title={`Read: ${r.title}`}
                    description={`${r.description} (${r.provider}, ${r.time})`}
                    source="learning-resource"
                    addedGoals={addedGoals}
                    setAddedGoals={setAddedGoals}
                    addingGoal={addingGoal}
                    setAddingGoal={setAddingGoal}
                  />
                </div>
              ))}
            </div>
          )}
          {plan.learningPath.secondary?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">📚 Also Recommended</div>
              {plan.learningPath.secondary.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}><ResourceCard resource={r} /></div>
                  <AddToDevPlanButton
                    pillar={plan.learningPath.focus}
                    title={`Read: ${r.title}`}
                    description={`${r.description} (${r.provider}, ${r.time})`}
                    source="learning-resource"
                    addedGoals={addedGoals}
                    setAddedGoals={setAddedGoals}
                    addingGoal={addingGoal}
                    setAddingGoal={setAddingGoal}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="card" style={{ marginTop: 16, textAlign: "center", padding: 12 }}>
        <a
          href="/api/devplan/journal"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", fontSize: 13 }}
        >
          📄 View Development Journal (Markdown)
        </a>
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          Your goals, progress, and notes are also saved to <code>~/.copilot/copilot-insights-journal.md</code>
        </p>
      </div>
    </>
  );
}

/* ── Shared Components ─────────────────────────────────────── */

function AddToDevPlanButton({ pillar, title, description, source, baselineScore, addedGoals, setAddedGoals, addingGoal, setAddingGoal }) {
  const goalKey = `${pillar}:${title}`;
  const isAdded = addedGoals.has(goalKey);
  const isAdding = addingGoal === goalKey;

  const handleAdd = async () => {
    setAddingGoal(goalKey);
    try {
      await addDevPlanGoal({ pillar, title, description, source, baselineScore });
      setAddedGoals((prev) => new Set([...prev, goalKey]));
    } catch (err) {
      if (String(err?.message || err).includes("409")) {
        setAddedGoals((prev) => new Set([...prev, goalKey]));
      }
    } finally {
      setAddingGoal(null);
    }
  };

  if (isAdded) {
    return <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 500 }}>✓ In Dev Plan</span>;
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleAdd();
      }}
      disabled={isAdding}
      style={{
        background: "none",
        border: "1px solid var(--accent)",
        borderRadius: 6,
        color: "var(--accent)",
        fontSize: 11,
        padding: "3px 8px",
        cursor: isAdding ? "wait" : "pointer",
        opacity: isAdding ? 0.6 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {isAdding ? "Adding…" : "➕ Add to Dev Plan"}
    </button>
  );
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="stat-card" style={{ padding: "12px 16px" }}>
      <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

function SuggestionsStack({
  suggestions,
  addedGoals,
  setAddedGoals,
  addingGoal,
  setAddingGoal,
  showAddButton = false,
  defaultPillar,
  defaultSource,
  defaultBaselineScore,
}) {
  const PRIORITY_COLORS = { high: "#f85149", medium: "#d29922", low: "#58a6ff", info: "#3fb950" };
  return (
    <div className="suggestions-stack">
      {suggestions.map((s, i) => (
        <div key={i} className="suggestion-block" style={{ borderLeftColor: PRIORITY_COLORS[s.priority] || "#8b949e" }}>
          <div className="suggestion-header">
            <span className="suggestion-emoji">{s.emoji}</span>
            <span className="suggestion-title">{s.title}</span>
            <span className="priority-tag" style={{ background: PRIORITY_COLORS[s.priority] }}>{s.priority}</span>
            {showAddButton && (
              <span style={{ marginLeft: 8 }}>
                <AddToDevPlanButton
                  pillar={s.pillar || defaultPillar || "intent"}
                  title={s.title}
                  description={s.body}
                  source={s.source || defaultSource || "coaching-suggestion"}
                  baselineScore={s.baselineScore ?? defaultBaselineScore}
                  addedGoals={addedGoals}
                  setAddedGoals={setAddedGoals}
                  addingGoal={addingGoal}
                  setAddingGoal={setAddingGoal}
                />
              </span>
            )}
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
      body: `Only ${data.overallDelegationRatio}% work design ratio. Try giving high-level goals and letting the agent choose the approach.`,
    });
  }
  if (data.overallLeverage < 0.5) {
    suggestions.push({
      priority: "medium", emoji: "📈", title: "Low Agent Leverage",
      body: `Agent output is only ${data.overallLeverage}x your input. Consider delegating larger chunks.`,
    });
  }
  return suggestions;
}
