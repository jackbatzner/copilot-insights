import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSessionCatalog, fetchSessions, fetchHiddenSessions, hideSession, unhideSession } from "../api.js";
import { ScoreBadge, CATEGORY_META } from "../components/ScoreBadge.jsx";
import { TimeframeSelector } from "../components/TimeframeSelector.jsx";
import { SkeletonTable } from "../components/SkeletonCard.jsx";
import { useRefresh } from "../App.jsx";
import { useTimeframe } from "../TimeframeContext.jsx";
import { PageBanner } from "../components/PageBanner.jsx";
import { SuggestedNext } from "../components/SuggestedNext.jsx";
import { EmptyState, MIN_SESSIONS_FOR_TRENDS } from "../components/EmptyState.jsx";

export default function Sessions() {
  const { key: refreshKey } = useRefresh();
  const { timeframe, setTimeframe } = useTimeframe();
  const [data, setData] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [repoFilter, setRepoFilter] = useState("");
  const [sortField, setSortField] = useState("totalWeight");
  const [sortDir, setSortDir] = useState("desc");
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchSessions(timeframe, repoFilter || undefined),
      fetchSessionCatalog(timeframe, repoFilter || undefined),
      fetchHiddenSessions(),
    ])
      .then(([sessions, catalogData, hidden]) => {
        setData(sessions);
        setCatalog(catalogData);
        setHiddenIds(new Set(hidden.sessionIds));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [repoFilter, timeframe, refreshKey]);

  const toggleHide = useCallback(async (id, e) => {
    e.stopPropagation();
    try {
      if (hiddenIds.has(id)) {
        await unhideSession(id);
        setHiddenIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      } else {
        await hideSession(id);
        setHiddenIds((prev) => new Set(prev).add(id));
      }
    } catch (err) {
      console.warn("Failed to toggle session visibility:", err.message);
    }
  }, [hiddenIds]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  if (loading) return (
    <>
      <div className="page-header"><h1>📋 Sessions</h1><TimeframeSelector value={timeframe} onChange={setTimeframe} /></div>
      <SkeletonTable rows={6} />
    </>
  );
  if (error) return (
    <div className="empty">
      <div className="empty-icon">⚠️</div>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {error.includes("HTTP 500")
          ? "Couldn't load session data. Make sure the Copilot Insights server is running and your session database exists."
          : error}
      </p>
    </div>
  );
  if (!data) return null;

  const metricsById = new Map((data.sessions || []).map((session) => [session.id, session]));
  const allSessions = (catalog?.sessions || []).map((session) => ({
    ...session,
    ...(metricsById.get(session.id) || {
      redirectionCount: 0,
      redirectionRate: 0,
      totalWeight: 0,
      categoryBreakdown: {},
    }),
    metricsReady: metricsById.has(session.id),
  }));
  const sessionCount = allSessions.length;

  const sorted = [...allSessions].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortField === "createdAt") {
      return String(a.createdAt || "").localeCompare(String(b.createdAt || "")) * mul;
    }
    return ((a[sortField] || 0) - (b[sortField] || 0)) * mul;
  });

  const arrow = (field) =>
    sortField === field ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <>
      <div className="page-header">
        <h1>📋 Sessions</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>
      <PageBanner pageId="sessions">
        Every session is listed here. Analysis columns fill in when scoring is available.
      </PageBanner>

      <div className="filter-bar">
        <label htmlFor="repo-filter" className="sr-only">Filter by repository</label>
        <input
          id="repo-filter"
          type="text"
          placeholder="Filter by repository…"
          aria-label="Filter by repository"
          value={repoFilter}
          onChange={(e) => {
            setLoading(true);
            setRepoFilter(e.target.value);
          }}
        />
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {sorted.length} session(s)
          {hiddenIds.size > 0 && (
            <>
              {" · "}
              <button
                onClick={() => setShowHidden(!showHidden)}
                style={{
                  background: "none", border: "none", color: "#58a6ff",
                  cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline",
                }}
              >
                {showHidden ? "hide" : "show"} {hiddenIds.size} hidden
              </button>
            </>
          )}
        </span>
      </div>

      {sessionCount === 0 && (
        <EmptyState sessionCount={0} feature="session analysis" />
      )}

      <div className="card">
        {sorted.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">✅</div>
            <p>No sessions found for the current filters.</p>
          </div>
        ) : (
          <div className="session-table-wrapper">
          <table className="session-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th onClick={() => handleSort("createdAt")} style={{ cursor: "pointer", textAlign: "left", minWidth: 140 }} scope="col">
                  Session{arrow("createdAt")}
                </th>
                <th onClick={() => handleSort("turnCount")} style={{ cursor: "pointer", textAlign: "right", width: 60 }} scope="col">
                  Turns{arrow("turnCount")}
                </th>
                <th onClick={() => handleSort("redirectionCount")} style={{ cursor: "pointer", textAlign: "right", width: 50 }} scope="col">
                  Redir{arrow("redirectionCount")}
                </th>
                <th onClick={() => handleSort("redirectionRate")} style={{ cursor: "pointer", textAlign: "center", width: 90 }} scope="col">
                  Rate{arrow("redirectionRate")}
                </th>
                <th style={{ width: 100 }} scope="col">Top Issue</th>
                <th style={{ width: 32 }} scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.filter((s) => showHidden || !hiddenIds.has(s.id)).map((s) => {
                const isHidden = hiddenIds.has(s.id);
                const topCat = Object.entries(s.categoryBreakdown || {}).sort(
                  (a, b) => b[1].count - a[1].count
                )[0];
                const topMeta = topCat
                  ? CATEGORY_META[topCat[0]] || { emoji: "❓", label: topCat[0] }
                  : null;

                return (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    onClick={() => navigate(`/sessions/${s.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/sessions/${s.id}`); } }}
                    style={isHidden ? { opacity: 0.4 } : undefined}
                    aria-label={`Session ${s.summary?.substring(0, 50) || s.id.substring(0, 8)}, ${s.turnCount} turns, ${s.redirectionCount} redirections`}
                  >                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>
                        {s.summary?.substring(0, 50) || s.branch?.substring(0, 30) || s.id.substring(0, 8)}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {s.createdAt ? new Date(s.createdAt).toLocaleString() : "Unknown time"}
                      </div>
                      {s.repository && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {s.repository}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{s.turnCount}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{s.redirectionCount}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {s.metricsReady ? <ScoreBadge rate={s.redirectionRate} /> : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {topMeta && s.metricsReady ? (
                        <span style={{ fontSize: 12 }}>
                          {topMeta.emoji} {topMeta.label}
                        </span>
                      ) : s.metricsReady ? (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Clean</span>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Not scored</span>
                      )}
                    </td>
                    <td>
                      <button
                        title={isHidden ? "Unhide session" : "Hide session from analysis"}
                        onClick={(e) => toggleHide(s.id, e)}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          fontSize: 16, padding: "2px 6px", borderRadius: 4,
                          opacity: isHidden ? 1 : 0.4,
                        }}
                      >
                        {isHidden ? "👁️" : "🙈"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <SuggestedNext to="/skills" icon="🎓" label="Skill Building" description="See coaching, retro prompts, and your current WTI focus areas" />
    </>
  );
}
