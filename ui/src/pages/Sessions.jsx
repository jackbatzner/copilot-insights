import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSessions } from "../api.js";
import { ScoreBadge, CATEGORY_META } from "../components/ScoreBadge.jsx";
import { TimeframeSelector } from "../components/TimeframeSelector.jsx";
import { useRefresh } from "../App.jsx";

export default function Sessions() {
  const { key: refreshKey } = useRefresh();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [repoFilter, setRepoFilter] = useState("");
  const [timeframe, setTimeframe] = useState("all");
  const [sortField, setSortField] = useState("totalWeight");
  const [sortDir, setSortDir] = useState("desc");
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    fetchSessions(timeframe, repoFilter || undefined)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [repoFilter, timeframe, refreshKey]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  if (loading) return <div className="loading">Loading sessions…</div>;
  if (error) return <div className="empty"><div className="empty-icon">❌</div><p>{error}</p></div>;
  if (!data) return null;

  const sorted = [...data.sessions].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    return (a[sortField] - b[sortField]) * mul;
  });

  const arrow = (field) =>
    sortField === field ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <>
      <div className="page-header">
        <h1>📋 Sessions</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Filter by repository…"
          value={repoFilter}
          onChange={(e) => {
            setLoading(true);
            setRepoFilter(e.target.value);
          }}
        />
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {sorted.length} session(s)
        </span>
      </div>

      <div className="card">
        {sorted.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">✅</div>
            <p>No redirections found. Your prompting is on point!</p>
          </div>
        ) : (
          <table className="session-table">
            <thead>
              <tr>
                <th>Session</th>
                <th onClick={() => handleSort("turnCount")} style={{ cursor: "pointer" }}>
                  Turns{arrow("turnCount")}
                </th>
                <th onClick={() => handleSort("redirectionCount")} style={{ cursor: "pointer" }}>
                  Redirections{arrow("redirectionCount")}
                </th>
                <th onClick={() => handleSort("redirectionRate")} style={{ cursor: "pointer" }}>
                  Rate{arrow("redirectionRate")}
                </th>
                <th>Top Issue</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 30).map((s) => {
                const topCat = Object.entries(s.categoryBreakdown || {}).sort(
                  (a, b) => b[1].count - a[1].count
                )[0];
                const topMeta = topCat
                  ? CATEGORY_META[topCat[0]] || { emoji: "❓", label: topCat[0] }
                  : null;

                return (
                  <tr key={s.id} onClick={() => navigate(`/sessions/${s.id}`)}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>
                        {s.summary?.substring(0, 50) || s.branch?.substring(0, 30) || s.id.substring(0, 8)}
                      </div>
                      {s.repository && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {s.repository}
                        </div>
                      )}
                    </td>
                    <td>{s.turnCount}</td>
                    <td>{s.redirectionCount}</td>
                    <td>
                      <ScoreBadge rate={s.redirectionRate} />
                    </td>
                    <td>
                      {topMeta && (
                        <span style={{ fontSize: 13 }}>
                          {topMeta.emoji} {topMeta.label}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
