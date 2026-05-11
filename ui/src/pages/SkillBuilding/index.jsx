import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchClarity, fetchEfficiency, fetchDelegation, fetchJudgment,
  fetchDevPlan, fetchChronicleTips, fetchVSCodeSummary,
  fetchRetro, fetchInstructionGaps,
} from "../../api";
import { TimeframeSelector } from "../../components/TimeframeSelector";
import { useRefresh } from "../../App.jsx";
import { useTimeframe } from "../../TimeframeContext.jsx";
import { PageBanner } from "../../components/PageBanner.jsx";
import { MetricHelp } from "../../components/MetricHelp.jsx";
import { EmptyState, MIN_SESSIONS_FOR_TRENDS } from "../../components/EmptyState.jsx";
import { TabBar, TabPanel } from "../../components/TabBar.jsx";
import {
  PILLARS, PILLAR_ORDER, BACKEND_KEY_MAP, getPillarStatus,
  getPillarLabel, getPillarEmoji, getPillarBadgeKey,
} from "../../pillar-config.js";
import { DevPlanProvider } from "./DevPlanContext.jsx";
import { AddToDevPlanButton } from "./shared.jsx";
import { OverviewTab } from "./OverviewTab.jsx";
import { IntentTab } from "./IntentTab.jsx";
import { WorkDesignTab } from "./WorkDesignTab.jsx";
import { QualityControlTab } from "./QualityControlTab.jsx";
import { EvaluationTab } from "./EvaluationTab.jsx";
import { RetroTab } from "./RetroTab.jsx";
import { DevPlanTab } from "./DevPlanTab.jsx";
import { useProgressivePageData } from "../../hooks/useProgressivePageData.js";

const PILLAR_TABS = [
  { id: "overview", label: "📊 Overview" },
  { id: "specification", label: "🎯 Intent" },
  { id: "delegation", label: "🤝 Work Design" },
  { id: "judgment", label: "🧠 Quality Control" },
  { id: "efficiency", label: "⚡ Evaluation" },
  { id: "retro", label: "🔄 Retro" },
  { id: "plan", label: "📋 Dev Plan" },
];

export default function SkillBuilding() {
  const { key: refreshKey } = useRefresh();
  const { timeframe, setTimeframe } = useTimeframe();

  const [tab, setTab] = useState("overview");

  const [retryCount, setRetryCount] = useState(0);

  const initialEntries = useMemo(() => ({
    clarity: () => fetchClarity(timeframe),
    efficiency: () => fetchEfficiency(timeframe),
    delegation: () => fetchDelegation(timeframe),
    judgment: () => fetchJudgment(timeframe),
    plan: () => fetchDevPlan(timeframe),
    tips: () => fetchChronicleTips(timeframe).then((value) => Array.isArray(value) ? { tips: value } : value),
    vscodeSummary: () => fetchVSCodeSummary(),
  }), [timeframe]);
  const deferredByTab = useMemo(() => ({
    efficiency: { retro: () => fetchRetro(timeframe) },
    retro: { retro: () => fetchRetro(timeframe) },
    plan: { gaps: () => fetchInstructionGaps(timeframe) },
  }), [timeframe]);
  const { data, loading, error } = useProgressivePageData({
    deps: [timeframe, refreshKey, retryCount],
    initialEntries,
    deferredByTab,
    activeTab: tab,
    validateInitial: (next, results) => {
      if (next.clarity || next.efficiency || next.delegation || next.judgment || next.plan) return null;
      const firstRejected = results.find((result) => result.status === "rejected");
      return firstRejected?.reason?.message || "Failed to load skill data. Check that the server is running.";
    },
  });
  const {
    clarity,
    efficiency,
    delegation,
    judgment,
    plan,
    tips,
    vscodeSummary,
    retro,
    gaps,
  } = data;

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
  };

  if (loading) return <div className="loading">Building your skill profile…</div>;
  if (error) return (
    <div className="empty">
      <div className="empty-icon">⚠️</div>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {error.includes("HTTP 500")
          ? "Couldn't load skill data. Make sure the Copilot Insights server is running and your session database exists."
          : error}
      </p>
      <button
        onClick={handleRetry}
        style={{
          marginTop: 12, background: "var(--accent)", color: "white", border: "none",
          borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13,
        }}
      >
        🔄 Retry
      </button>
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

  // Quick Wins — combine Chronicle Tips + dev-plan quick wins
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
    <DevPlanProvider>
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

        {/* Pillar score hero cards — use buttons instead of div onClick */}
        <div className="stats-grid stats-grid-4">
          {PILLAR_ORDER.map((pillarKey) => {
            const config = PILLARS[pillarKey];
            const score = pillarScoresByKey[pillarKey] ?? pillarFallbacks[pillarKey];
            const status = getPillarStatus(score, pillarKey);
            const tabKey = Object.entries(BACKEND_KEY_MAP).find(([, v]) => v === pillarKey)?.[0];

            return (
              <button
                key={pillarKey}
                className={`stat-card pillar-card ${tab === tabKey ? "pillar-active" : ""}`}
                onClick={() => tabKey && setTab(tabKey)}
                style={{ cursor: "pointer", textAlign: "left", background: "none", border: "1px solid var(--border)", width: "100%" }}
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
              </button>
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
                    />
                  </span>
                </div>
                <p className="opp-desc">{w.description}</p>
                {w.metric && <div className="opp-metric">{w.metric}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Chronicle fallback messaging */}
        {!tips && !loading && (
          <div className="card" style={{ marginBottom: 16, padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>📖</div>
            <p style={{ fontSize: 13 }}>Chronicle data is not available yet.</p>
            <p style={{ fontSize: 12 }}>Complete more sessions to unlock personalized coaching tips and Quick Wins.</p>
          </div>
        )}

        {/* Accessible tab bar with keyboard navigation */}
        <TabBar tabs={PILLAR_TABS} activeTab={tab} onTabChange={setTab} />

        {/* Tab content panels */}
        <TabPanel id="overview" activeTab={tab}>
          <OverviewTab clarity={clarity} efficiency={efficiency} delegation={delegation} judgment={judgment} tips={tips} />
        </TabPanel>
        <TabPanel id="specification" activeTab={tab}>
          <IntentTab clarity={clarity} efficiency={efficiency} />
        </TabPanel>
        <TabPanel id="delegation" activeTab={tab}>
          <WorkDesignTab delegation={delegation} />
        </TabPanel>
        <TabPanel id="judgment" activeTab={tab}>
          <QualityControlTab judgment={judgment} />
        </TabPanel>
        <TabPanel id="efficiency" activeTab={tab}>
          <EvaluationTab sprawl={retro?.sprawl} tools={retro?.tools} tips={retro?.tips} resources={retro?.resources} />
        </TabPanel>
        <TabPanel id="retro" activeTab={tab}>
          <RetroTab trends={retro?.trends} improve={retro?.improve} chronicle={retro?.chronicle} />
        </TabPanel>
        <TabPanel id="plan" activeTab={tab}>
          {plan && <DevPlanTab plan={plan} gaps={gaps} />}
        </TabPanel>
      </div>
    </DevPlanProvider>
  );
}
