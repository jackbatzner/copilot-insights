import { useState, useEffect } from "react";
import {
  fetchPromptLength,
  fetchRepoHealth,
  fetchHotFiles,
  fetchSessionDepth,
  fetchToolUsage,
  fetchCreateEditRatio,
  fetchFileTypes,
  fetchWorkStyle,
} from "../api";
import { TimeframeSelector } from "../components/TimeframeSelector";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from "recharts";
import { useRefresh } from "../App.jsx";
import { PageBanner } from "../components/PageBanner.jsx";
import { MetricHelp } from "../components/MetricHelp";

const TT_STYLE = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  color: "#e6edf3",
};

export default function Analytics() {
  const { key: refreshKey } = useRefresh();
  const [timeframe, setTimeframe] = useState("all");
  const [promptLen, setPromptLen] = useState(null);
  const [workStyle, setWorkStyle] = useState(null);
  const [createEdit, setCreateEdit] = useState(null);
  const [fileTypes, setFileTypes] = useState(null);
  const [repos, setRepos] = useState(null);
  const [files, setFiles] = useState(null);
  const [depth, setDepth] = useState(null);
  const [tools, setTools] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("patterns");

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPromptLength(timeframe),
      fetchRepoHealth(timeframe),
      fetchHotFiles(timeframe),
      fetchSessionDepth(timeframe),
      fetchToolUsage(timeframe),
      fetchWorkStyle(timeframe),
      fetchCreateEditRatio(timeframe),
      fetchFileTypes(timeframe),
    ])
      .then(([p, r, f, d, t, ws, ce, ft]) => {
        setPromptLen(p);
        setRepos(r);
        setFiles(f);
        setDepth(d);
        setTools(t);
        setWorkStyle(ws);
        setCreateEdit(ce);
        setFileTypes(ft);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="loading">Crunching analytics…</div>;
  if (error) return <div className="empty"><div className="empty-icon">❌</div><p>{error}</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>📈 Analytics</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>
      <PageBanner pageId="analytics">
        Patterns in how you interact with AI — understand your working style so you can make deliberate choices about when to plan first vs. dive in.
      </PageBanner>

      {/* Hero stats */}
      <div className="stats-grid stats-grid-4">
        <StatCard
          label="Total Sessions"
          value={depth?.total ?? "—"}
          sub="in timeframe"
        />
        <StatCard
          label={<MetricHelp label="Avg Redirection Rate" definition="Average percentage of turns that are redirections (agent changing direction due to unclear instructions) across all sessions." target="Below 20% is good. High rates suggest prompts need more context or clearer framing." />}
          value={depth?.avgRedirectionRate != null ? `${depth.avgRedirectionRate}%` : "—"}
          sub="redirections / turns"
        />
        <StatCard
          label="Files Touched"
          value={files?.length ?? "—"}
          sub="unique files"
        />
        <StatCard
          label="Tool Actions"
          value={tools?.reduce((s, t) => s + t.cnt, 0) ?? "—"}
          sub="create + edit"
        />
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn${tab === "patterns" ? " active" : ""}`} onClick={() => setTab("patterns")}>🎨 Patterns</button>
        <button className={`tab-btn${tab === "files" ? " active" : ""}`} onClick={() => setTab("files")}>📁 Files & Repos</button>
      </div>

      {tab === "patterns" && (
        <>
          {/* Work Style */}
          <div className="card-row">
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">🎨 Work Style Distribution</div>
              <p className="card-subtitle">How you approach sessions: vibe, structured, iterative, or mixed</p>
              {workStyle && <WorkStyleChart data={workStyle} />}
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ borderLeft: "3px solid #3fb950", paddingLeft: 10 }}>
                    <strong style={{ color: "var(--text)" }}>🏗️ Structured</strong>
                    <div style={{ marginTop: 4 }}>Planned first — defined the problem before writing code. Best for complex tasks.</div>
                  </div>
                  <div style={{ borderLeft: "3px solid #f85149", paddingLeft: 10 }}>
                    <strong style={{ color: "var(--text)" }}>⚡ Vibe Coding</strong>
                    <div style={{ marginTop: 4 }}>Jumped straight to code (first edit on turn 0-1). Great for quick fixes.</div>
                  </div>
                  <div style={{ borderLeft: "3px solid #d29922", paddingLeft: 10 }}>
                    <strong style={{ color: "var(--text)" }}>🔄 Iterative</strong>
                    <div style={{ marginTop: 4 }}>Alternated between planning and coding. Good for evolving requirements.</div>
                  </div>
                  <div style={{ borderLeft: "3px solid #58a6ff", paddingLeft: 10 }}>
                    <strong style={{ color: "var(--text)" }}>🎨 Mixed</strong>
                    <div style={{ marginTop: 4 }}>A blend of styles — natural when task complexity varies mid-session.</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header"><MetricHelp label="📏 Prompt Length vs Redirections" definition="Shows how your prompt length correlates with redirection rate. Redirections occur when the agent needs to change direction due to unclear instructions." target="Aim for medium-length prompts (100-500 chars) with redirection rates below 20%." /></div>
              <p className="card-subtitle">Shorter prompts → more redirections?</p>
              {promptLen && <PromptLengthChart data={promptLen} />}
              <div style={{ background: "rgba(88, 166, 255, 0.05)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: 13 }}>
                <strong style={{ color: "var(--accent)" }}>📊 Reading this chart:</strong>
                <ul style={{ margin: "8px 0 0 0", paddingLeft: 20, color: "var(--text-muted)" }}>
                  <li><strong>Short prompts (&lt;100 chars)</strong> often lack context, leading to more redirections — you'll need follow-up turns to clarify.</li>
                  <li><strong>Medium prompts (100-500 chars)</strong> are the sweet spot — enough context for the agent to act without ambiguity.</li>
                  <li><strong>Long prompts (500-1000 chars)</strong> give detailed context — lower redirection is expected.</li>
                  <li><strong>Very long prompts (1000+ chars)</strong> may include too much information, sometimes causing confusion.</li>
                </ul>
                <div style={{ marginTop: 8, color: "var(--text-muted)" }}>💡 <em>The color indicates redirection rate: green = low (&lt;20%), yellow = moderate (20-40%), red = high (&gt;40%).</em></div>
              </div>
            </div>
          </div>

          {/* Session depth */}
          <div className="card">
            <div className="card-header"><MetricHelp label="📊 Session Depth" definition="Distribution of how many turns (back-and-forth exchanges) your sessions contain." target="No fixed target — focus on redirection rate within sessions rather than raw turn count." /></div>
            <p className="card-subtitle">Turn count distribution</p>
            {depth && <DepthChart data={depth.buckets} />}
            <div style={{ background: "rgba(88, 166, 255, 0.05)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: 13 }}>
              <strong style={{ color: "var(--accent)" }}>📊 Understanding session depth:</strong>
              <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                More turns isn't inherently bad — it depends on what those turns are. A 30-turn session with 0 redirections is a productive deep-dive. A 10-turn session with 5 redirections needs work. Focus on the <strong>redirection rate</strong> (redirections ÷ total turns) rather than raw turn count.
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, fontStyle: "italic" }}>
              Focus on sessions with high redirection rates (red) rather than raw turn count. Long sessions with low redirections are productive deep-dives.
            </div>
          </div>
        </>
      )}

      {tab === "files" && (
        <>
          {/* Create/Edit + File Types */}
          <div className="card-row">
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">📐 Create / Edit Ratio</div>
              <p className="card-subtitle">New files vs modifying existing ones</p>
              {createEdit && <CreateEditChart data={createEdit} />}
            </div>
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">📁 File Type Diversity</div>
              <p className="card-subtitle">Distribution of file types across sessions</p>
              {fileTypes && <FileTypeChart data={fileTypes} />}
            </div>
          </div>

          {/* Tool usage */}
          <div className="card">
            <div className="card-header">🔨 Tool Usage</div>
            <p className="card-subtitle">Create vs Edit file operations</p>
            {tools && <ToolChart data={tools} />}
          </div>

      {/* Repo health */}
      {repos && repos.length > 0 && (
        <div className="card">
          <div className="card-header">📦 Repository Health</div>
          <p className="card-subtitle">Redirection rates per repo</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th style={{ textAlign: "right", minWidth: 60 }}>Sessions</th>
                <th style={{ textAlign: "right", minWidth: 60 }}>Turns</th>
                <th style={{ textAlign: "right", minWidth: 60 }}>Redirections</th>
                <th style={{ textAlign: "center", minWidth: 80 }}><MetricHelp label="Rate" definition="Percentage of turns that resulted in the agent changing direction. Lower is better." target="Below 20% is excellent. Above 40% suggests prompts need more upfront context." /></th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.name}>
                  <td className="truncate" style={{ maxWidth: 300 }}>{r.name}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{r.sessions}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{r.totalTurns}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{r.redirectionTurns}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <span className="clarity-badge" style={{
                      background: r.rate > 20 ? "#f85149" : r.rate > 10 ? "#d29922" : "#3fb950"
                    }}>
                      {r.rate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Row 5: Hot files */}
      {files && files.length > 0 && (
        <div className="card">
          <div className="card-header">🔥 Most Touched Files</div>
          <p className="card-subtitle">Files with the most activity across sessions</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Touches</th>
              </tr>
            </thead>
            <tbody>
              {files.slice(0, 8).map((f, i) => (
                <tr key={i}>
                  <td className="truncate" title={f.file_path} style={{ maxWidth: 400 }}>
                    <code>{f.shortPath}</code>
                    <span style={{ marginLeft: 8, fontSize: 11, color: f.tool_name === "create" ? "#3fb950" : "#58a6ff" }}>
                      {f.tool_name}
                    </span>
                  </td>
                  <td>{f.total_touches} <span style={{ fontSize: 11, color: "#8b949e" }}>in {f.sessions} sessions</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

function heatColor(turns, max) {
  if (turns === 0) return "#161b22";
  const intensity = Math.min(turns / Math.max(max * 0.6, 1), 1);
  const r = Math.round(88 + intensity * (63 - 88));
  const g = Math.round(166 + intensity * (185 - 166));
  const b = Math.round(255 + intensity * (80 - 255));
  return `rgb(${r}, ${g}, ${b})`;
}

function HourlyChart({ data }) {
  const max = Math.max(...data.map((d) => d.totalTurns));
  return (
    <div>
      <div className="heatmap-grid">
        {data.map((d) => (
          <div
            key={d.hour}
            className="heatmap-cell"
            style={{ background: heatColor(d.totalTurns, max) }}
            title={`${d.hour}:00 — ${d.totalTurns} turns, ${d.redirectionRate}% redirections`}
          >
            <span className="heatmap-hour">{d.hour}</span>
            <span className="heatmap-count">{d.totalTurns}</span>
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Less active</span>
        <div className="heatmap-scale">
          {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
            <div key={i} className="heatmap-swatch" style={{ background: heatColor(max * v, max) }} />
          ))}
        </div>
        <span>More active</span>
      </div>
    </div>
  );
}

function PromptLengthChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical">
        <XAxis type="number" domain={[0, 100]} tick={{ fill: "#8b949e", fontSize: 11 }} unit="%" />
        <YAxis type="category" dataKey="label" tick={{ fill: "#e6edf3", fontSize: 12 }} width={60} />
        <Tooltip contentStyle={TT_STYLE} formatter={(v) => [`${v}%`, "Redirect rate"]} />
        <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.rate > 20 ? "#f85149" : entry.rate > 10 ? "#d29922" : "#3fb950"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DepthChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <XAxis dataKey="label" tick={{ fill: "#e6edf3", fontSize: 11 }} />
        <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} />
        <Tooltip contentStyle={TT_STYLE} />
        <Bar dataKey="count" fill="#58a6ff" radius={[4, 4, 0, 0]} name="Sessions" />
      </BarChart>
    </ResponsiveContainer>
  );
}

const TOOL_COLORS = { create: "#3fb950", edit: "#58a6ff" };

function ToolChart({ data }) {
  if (!data || data.length === 0) return <p className="card-subtitle">No file operations recorded.</p>;
  const total = data.reduce((s, d) => s + d.cnt, 0);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, padding: "12px 0", flexWrap: "wrap" }}>
      <PieChart width={160} height={160}>
        <Pie data={data.map(d => ({ name: d.tool_name, value: d.cnt }))}
          cx={80} cy={80} innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
          {data.map((d) => (
            <Cell key={d.tool_name} fill={TOOL_COLORS[d.tool_name] || "#8b949e"} />
          ))}
        </Pie>
        <Tooltip contentStyle={TT_STYLE} />
      </PieChart>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.map((d) => (
          <div key={d.tool_name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: TOOL_COLORS[d.tool_name] || "#8b949e" }} />
            <span style={{ color: "#e6edf3" }}>{d.tool_name}</span>
            <span style={{ color: "#8b949e", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
              {d.cnt} ({total > 0 ? Math.round((d.cnt / total) * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STYLE_COLORS = { vibe: "#58a6ff", structured: "#3fb950", iterative: "#d29922", mixed: "#8b949e" };
const STYLE_EMOJIS = { vibe: "🌊", structured: "🏗️", iterative: "🔄", mixed: "🎲" };

function WorkStyleChart({ data }) {
  const { summary, coachingTip } = data;
  if (!summary || summary.total === 0) return <p className="card-subtitle">No sessions recorded.</p>;
  const styles = ["structured", "iterative", "vibe", "mixed"];
  const counts = summary.styleCounts || {};
  const total = summary.total;
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", height: 28, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
        {styles.map((s) => {
          const pct = total > 0 ? (counts[s] || 0) / total * 100 : 0;
          if (pct === 0) return null;
          return (
            <div key={s} title={`${s}: ${counts[s]} (${Math.round(pct)}%)`}
              style={{ width: `${pct}%`, background: STYLE_COLORS[s], minWidth: pct > 0 ? 4 : 0, transition: "width 0.3s" }} />
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        {styles.map((s) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: STYLE_COLORS[s] }} />
            <span style={{ color: "#e6edf3" }}>{STYLE_EMOJIS[s]} {s}</span>
            <span style={{ color: "#8b949e" }}>{counts[s] || 0}</span>
          </div>
        ))}
      </div>
      {summary.dominantStyle && (
        <p style={{ color: "#e6edf3", fontSize: 13, margin: "0 0 4px" }}>
          Dominant: {summary.dominantEmoji || ""} <strong>{summary.dominantStyle}</strong>
        </p>
      )}
      {coachingTip && (
        <p style={{ color: "#8b949e", fontSize: 12, margin: "8px 0 0", fontStyle: "italic",
          borderLeft: "3px solid #30363d", paddingLeft: 10 }}>
          💡 {coachingTip}
        </p>
      )}
    </div>
  );
}

function CreateEditChart({ data }) {
  const creates = data?.overall?.creates ?? 0;
  const edits = data?.overall?.edits ?? 0;
  const total = creates + edits;
  if (!data || total === 0) return <p className="card-subtitle">No file operations recorded.</p>;
  const { ratio } = data.overall;
  const { insight } = data;
  const createPct = total > 0 ? (creates / total) * 100 : 0;
  const editPct = total > 0 ? (edits / total) * 100 : 0;
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
        <PieChart width={140} height={140}>
          <Pie data={[{ name: "Create", value: creates }, { name: "Edit", value: edits }]}
            cx={70} cy={70} innerRadius={35} outerRadius={60} paddingAngle={3} dataKey="value">
            <Cell fill="#3fb950" />
            <Cell fill="#58a6ff" />
          </Pie>
          <Tooltip contentStyle={TT_STYLE} />
        </PieChart>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3fb950" }} />
            <span style={{ color: "#e6edf3" }}>Create</span>
            <span style={{ color: "#8b949e", fontVariantNumeric: "tabular-nums" }}>{creates} ({Math.round(createPct)}%)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#58a6ff" }} />
            <span style={{ color: "#e6edf3" }}>Edit</span>
            <span style={{ color: "#8b949e", fontVariantNumeric: "tabular-nums" }}>{edits} ({Math.round(editPct)}%)</span>
          </div>
          <div style={{ color: "#8b949e", fontSize: 12, marginTop: 4 }}>
            Ratio: <strong style={{ color: "#e6edf3" }}>{ratio}</strong>
          </div>
        </div>
      </div>
      {insight && (
        <p style={{ color: "#8b949e", fontSize: 12, margin: 0, fontStyle: "italic",
          borderLeft: "3px solid #30363d", paddingLeft: 10 }}>
          💡 {insight}
        </p>
      )}
    </div>
  );
}

const TYPE_COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#f0883e", "#8b949e", "#39d353"];

function FileTypeChart({ data }) {
  if (!data || !data.extensions || data.extensions.length === 0) return <p className="card-subtitle">No file type data.</p>;
  const top = data.extensions.slice(0, 8);
  const maxCount = Math.max(...top.map((t) => t.count));
  return (
    <div style={{ padding: "8px 0", display: "flex", flexDirection: "column", gap: 6 }}>
      {top.map((t, i) => (
        <div key={t.ext} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
          <code style={{ color: "#e6edf3", minWidth: 50, textAlign: "right" }}>{t.ext}</code>
          <div style={{ flex: 1, height: 18, background: "#21262d", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              width: `${maxCount > 0 ? (t.count / maxCount) * 100 : 0}%`,
              height: "100%", background: TYPE_COLORS[i % TYPE_COLORS.length],
              borderRadius: 4, transition: "width 0.3s", minWidth: t.count > 0 ? 4 : 0,
            }} />
          </div>
          <span style={{ color: "#8b949e", minWidth: 60, fontVariantNumeric: "tabular-nums" }}>
            {t.count} ({t.pct}%)
          </span>
        </div>
      ))}
    </div>
  );
}
