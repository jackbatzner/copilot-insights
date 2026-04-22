import { useState, useEffect } from "react";
import { fetchInstructionGaps, fetchInstructionFailures } from "../api";
import { TimeframeSelector } from "../components/TimeframeSelector";
import { useRefresh } from "../App.jsx";
import { PageBanner } from "../components/PageBanner.jsx";
import { Link } from "react-router-dom";
import { CollapsibleSection } from "../components/CollapsibleSection.jsx";
import { SuggestedNext } from "../components/SuggestedNext.jsx";
import { TabBar, TabPanel } from "../components/TabBar.jsx";

const CATEGORY_LABELS = {
  convention: { label: "Style & Conventions", emoji: "🎨", color: "#bc8cff" },
  structure: { label: "Architecture", emoji: "🏗️", color: "#58a6ff" },
  naming: { label: "Naming", emoji: "🏷️", color: "#3fb950" },
  testing: { label: "Testing", emoji: "🧪", color: "#d29922" },
  error_handling: { label: "Error Handling", emoji: "⚠️", color: "#f85149" },
  imports: { label: "Imports", emoji: "📦", color: "#db6d28" },
};

const PRIORITY_COLORS = {
  high: "#f85149",
  medium: "#d29922",
  low: "#58a6ff",
  info: "#3fb950",
};

const SEVERITY_COLORS = {
  high: "#f85149",
  medium: "#d29922",
};

export default function Instructions() {
  const { key: refreshKey } = useRefresh();
  const [timeframe, setTimeframe] = useState("all");
  const [tab, setTab] = useState("gaps");
  const [gaps, setGaps] = useState(null);
  const [failures, setFailures] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchInstructionGaps(timeframe),
      fetchInstructionFailures(timeframe),
    ])
      .then(([g, f]) => { setGaps(g); setFailures(f); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="loading">Analyzing instruction effectiveness…</div>;
  if (error) return <div className="empty"><div className="empty-icon">❌</div><p>{error}</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>⚙️ Instructions</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>
      <PageBanner pageId="instructions">
        Conventions you keep teaching by hand — add them to your instruction file.
      </PageBanner>

      {/* Tab switcher */}
      <TabBar
        tabs={[
          { id: "gaps", label: `📝 Missing Rules${gaps ? ` (${gaps.totalGaps})` : ""}` },
          { id: "failures", label: `❌ Rule Failures${failures ? ` (${failures.totalFailures})` : ""}` },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      <TabPanel id="gaps" activeTab={tab}>
        <GapsTab data={gaps} />
      </TabPanel>
      <TabPanel id="failures" activeTab={tab}>
        <FailuresTab data={failures} />
      </TabPanel>
    </div>
  );
}

/* ── Missing Rules (Gaps) Tab ──────────────────────────────── */

function GapsTab({ data }) {
  if (!data) return null;

  return (
    <>
      <p className="page-intro">
        Conventions you've taught the agent by hand. Add them to your instruction file to stop repeating yourself.
      </p>

      <div className="stats-grid stats-grid-3">
        <div className="stat-card">
          <div className="stat-value" style={{ color: data.totalGaps > 5 ? "#f85149" : "#3fb950" }}>
            {data.totalGaps}
          </div>
          <div className="stat-label">Unique Gaps</div>
          <div className="stat-sub">convention types detected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.totalSignals}</div>
          <div className="stat-label">Total Signals</div>
          <div className="stat-sub">times you manually corrected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.repoBreakdown?.length || 0}</div>
          <div className="stat-label">Repos Affected</div>
          <div className="stat-sub">across your projects</div>
        </div>
      </div>

      {data.categorySummary && Object.keys(data.categorySummary).length > 0 && (
        <div className="card">
          <div className="card-header">📊 Gap Categories</div>
          <div className="category-pills">
            {Object.entries(data.categorySummary)
              .sort(([, a], [, b]) => b.count - a.count)
              .map(([cat, info]) => {
                const meta = CATEGORY_LABELS[cat] || { label: cat, emoji: "📌", color: "#8b949e" };
                return (
                  <div key={cat} className="category-pill" style={{ borderColor: meta.color }}>
                    <span>{meta.emoji}</span>
                    <span style={{ color: "var(--text)" }}>{meta.label}</span>
                    <span className="pill-count" style={{ background: meta.color }}>{info.count}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {data.suggestions?.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Recommendations</div>
          <SuggestionsStack suggestions={data.suggestions} />
        </div>
      )}

      {data.gaps?.length > 0 && (
        <CollapsibleSection title="🔍 Detected Convention Gaps" id="instructions-gaps-table" defaultOpen={false}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Pattern</th>
                <th>Count</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {data.gaps.slice(0, 10).map((g, i) => {
                const meta = CATEGORY_LABELS[g.category] || { emoji: "📌", color: "#8b949e" };
                return (
                  <tr key={i}>
                    <td><span style={{ color: meta.color }}>{meta.emoji} {g.category}</span></td>
                    <td>{g.label}</td>
                    <td>{g.count}</td>
                    <td className="truncate" style={{ maxWidth: 300 }} title={g.examples?.[0]?.text}>
                      <code>{g.examples?.[0]?.text || "—"}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CollapsibleSection>
      )}

      {data.repoBreakdown?.length > 0 && (
        <CollapsibleSection title="📦 Per-Repo Convention Signals" id="instructions-repo-signals" defaultOpen={false}>
          <table className="data-table">
            <thead>
              <tr><th>Repository</th><th>Signals</th><th>Categories</th></tr>
            </thead>
            <tbody>
              {data.repoBreakdown.map((r, i) => (
                <tr key={i}>
                  <td className="truncate" style={{ maxWidth: 300 }}>{r.repo}</td>
                  <td>
                    <span className="clarity-badge" style={{
                      background: r.conventionSignals > 5 ? "#f85149" : r.conventionSignals > 2 ? "#d29922" : "#3fb950"
                    }}>{r.conventionSignals}</span>
                  </td>
                  <td>
                    {r.topCategories.map((c) => (
                      <span key={c} style={{ marginRight: 6, fontSize: 12, color: CATEGORY_LABELS[c]?.color || "#8b949e" }}>
                        {CATEGORY_LABELS[c]?.emoji || "📌"} {c}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}
    </>
  );
}

/* ── Rule Failures Tab ─────────────────────────────────────── */

function FailuresTab({ data }) {
  if (!data) return null;

  return (
    <>
      <p className="page-intro">
        Rules the agent knows but ignores. Fix by rewriting vague rules or adding examples.
      </p>

      <div className="stats-grid stats-grid-4">
        <div className="stat-card">
          <div className="stat-value" style={{ color: data.totalFailures > 10 ? "#f85149" : "#3fb950" }}>
            {data.totalFailures}
          </div>
          <div className="stat-label">Total Failures</div>
          <div className="stat-sub">across all sessions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#bc8cff" }}>{data.totalFailureSignals}</div>
          <div className="stat-label">Explicit Signals</div>
          <div className="stat-sub">"I already told you…"</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#d29922" }}>{data.totalIntraRepetitions}</div>
          <div className="stat-label">In-Session Repeats</div>
          <div className="stat-sub">same instruction restated</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#58a6ff" }}>{data.totalImmediateCorrections}</div>
          <div className="stat-label">Immediate Corrections</div>
          <div className="stat-sub">"no" / "wrong" responses</div>
        </div>
      </div>

      {/* Failure rate */}
      {data.sessionsAnalyzed > 0 && (
        <div className="card">
          <div className="card-header">📊 Failure Rate</div>
          <div className="failure-rate-bar">
            <div className="failure-rate-fill" style={{
              width: `${Math.round((data.sessionsWithFailures / data.sessionsAnalyzed) * 100)}%`,
              background: (data.sessionsWithFailures / data.sessionsAnalyzed) > 0.5 ? "#f85149" : "#d29922",
            }} />
          </div>
          <div className="failure-rate-label">
            {data.sessionsWithFailures} of {data.sessionsAnalyzed} sessions ({Math.round((data.sessionsWithFailures / data.sessionsAnalyzed) * 100)}%) have instruction failures
          </div>
        </div>
      )}

      {data.suggestions?.length > 0 && (
        <div className="card">
          <div className="card-header">💡 How to Fix</div>
          <SuggestionsStack suggestions={data.suggestions} />
        </div>
      )}

      {/* Top failure types */}
      {data.topSignals?.length > 0 && (
        <div className="card">
          <div className="card-header">🔥 Top Failure Types</div>
          <div className="failure-types">
            {data.topSignals.slice(0, 10).map((s, i) => (
              <div key={i} className="failure-type-row">
                <span className="failure-type-label">{s.label}</span>
                <div className="failure-type-bar-bg">
                  <div className="failure-type-bar" style={{
                    width: `${Math.min(100, (s.count / data.topSignals[0].count) * 100)}%`,
                  }} />
                </div>
                <span className="failure-type-count">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Worst sessions */}
      {data.worstSessions?.length > 0 && (
        <CollapsibleSection title="💥 Sessions With Most Failures" id="instructions-worst-sessions" defaultOpen={false}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Issues</th>
                <th>Turns</th>
              </tr>
            </thead>
            <tbody>
              {data.worstSessions.slice(0, 5).map((s, i) => (
                <tr key={i}>
                  <td className="truncate" style={{ maxWidth: 300 }} title={s.summary}>
                    <Link to={`/sessions/${s.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                      {s.summary || s.branch || s.id.substring(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <span className="clarity-badge" style={{ background: s.signalCount > 3 ? "#f85149" : "#d29922" }}>
                      {s.signalCount}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>
                      {s.repetitionCount} repeats · {s.correctionCount} corrections
                    </span>
                  </td>
                  <td>{s.turnCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}

      {/* Example signals with actionable context */}
      {data.examples?.length > 0 && (
        <CollapsibleSection title="📋 Example Failure Signals" id="instructions-examples" defaultOpen={false}>
          <div className="failure-examples">
            {data.examples.slice(0, 3).map((ex, i) => (
              <div key={i} className="failure-example">
                <div className="failure-example-header">
                  <span className="severity-dot" style={{ background: SEVERITY_COLORS[ex.severity] || "#8b949e" }} />
                  <span className="failure-example-label">{ex.label}</span>
                  <span className="failure-example-repo">{ex.repo}</span>
                </div>
                <code className="failure-example-text">{ex.context}</code>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Per-repo breakdown */}
      {data.repoBreakdown?.length > 0 && (
        <CollapsibleSection title="📦 Failures by Repository" id="instructions-failures-repo" defaultOpen={false}>
          <table className="data-table">
            <thead>
              <tr><th>Repository</th><th>Failures</th></tr>
            </thead>
            <tbody>
              {data.repoBreakdown.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  <td className="truncate" style={{ maxWidth: 300 }}>{r.repo}</td>
                  <td>
                    <span className="clarity-badge" style={{
                      background: r.total > 20 ? "#f85149" : r.total > 5 ? "#d29922" : "#3fb950"
                    }}>{r.total}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>
                      {r.signals} signals · {r.repetitions} repeats
                    </span>
                  </td>
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

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Clipboard API unavailable (e.g. HTTP context) — ignore gracefully
    });
  };

  return (
    <button
      className="snippet-copy-btn"
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? "✅ Copied!" : "📋 Copy"}
    </button>
  );
}

function SuggestionsStack({ suggestions }) {
  return (
    <div className="suggestions-stack">
      {suggestions.map((s, i) => (
        <div key={i} className="suggestion-block" style={{ borderLeftColor: PRIORITY_COLORS[s.priority] || "#8b949e" }}>
          <div className="suggestion-header">
            <span className="suggestion-emoji">{s.emoji}</span>
            <span className="suggestion-title">{s.title}</span>
            <span className="priority-tag" style={{ background: PRIORITY_COLORS[s.priority] }}>
              {s.priority}
            </span>
          </div>
          <p className="suggestion-body">{s.body}</p>
          {s.items?.length > 0 && (
            <div className="suggestion-items">
              {s.items.map((item, j) => (
                <div key={j} className="suggestion-item">
                  <span className="item-label">{item.label}</span>
                  {item.example && <code className="item-example">{item.example}</code>}
                  {item.repos && <span className="item-repos">repos: {item.repos}</span>}
                </div>
              ))}
            </div>
          )}
          {s.snippet && (
            <div className="snippet-block">
              <div className="snippet-header">
                <span className="snippet-label">Add this to your instruction file:</span>
                <CopyButton text={s.snippet} />
              </div>
              <pre className="snippet-code">{s.snippet}</pre>
            </div>
          )}
        </div>
      ))}
      <SuggestedNext to="/practice" icon="🧪" label="Practice" description="Strengthen these conventions with prompt drills" />
    </div>
  );
}
