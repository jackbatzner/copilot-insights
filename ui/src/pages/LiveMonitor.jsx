import { useState, useEffect, useRef, useCallback } from "react";
import { fetchLiveFeed } from "../api";

const POLL_INTERVAL = 5000;

const COACHING_TIPS = {
  explicit_correction:
    "The user is directly correcting the agent. Consider being more specific in your initial prompt, or break the task into smaller steps.",
  course_change:
    "A mid-task pivot was detected. Try defining clear acceptance criteria upfront so the agent stays on track.",
  frustration:
    "Frustration signal detected. If the agent keeps missing the mark, try rephrasing your request or providing an example of the expected output.",
  repetition:
    "The user is repeating an instruction. Make sure your initial request is unambiguous — include file paths, function names, or code snippets.",
  rollback:
    "A rollback was requested. Consider using smaller, incremental changes so it's easier to course-correct.",
};

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function truncateId(id) {
  return id ? id.slice(0, 8) : "";
}

function repoName(repo) {
  if (!repo) return "";
  const parts = repo.split("/");
  return parts.length > 1 ? parts[parts.length - 1] : repo;
}

export default function LiveMonitor() {
  const [turns, setTurns] = useState([]);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [alertCount, setAlertCount] = useState(0);
  const sinceRef = useRef(new Date(Date.now() - 3600_000).toISOString());
  const intervalRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const data = await fetchLiveFeed(sinceRef.current);
      if (data.turns && data.turns.length > 0) {
        setTurns((prev) => {
          const existing = new Set(prev.map((t) => `${t.sessionId}:${t.turnIndex}`));
          const fresh = data.turns.filter((t) => !existing.has(`${t.sessionId}:${t.turnIndex}`));
          const merged = [...fresh, ...prev].slice(0, 500);
          // Only count alerts from truly new turns
          if (fresh.length > 0) {
            const newAlerts = fresh.filter((t) => t.maxWeight >= 3).length;
            if (newAlerts > 0) setAlertCount((c) => c + newAlerts);
          }
          return merged;
        });
      }
      if (data.serverTime) {
        sinceRef.current = data.serverTime;
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
  }, [poll]);

  useEffect(() => {
    if (paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [paused, poll]);

  if (loading && turns.length === 0) {
    return <div className="loading">Connecting to live feed…</div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>📡 Live Monitor</h1>
        <div className="live-controls">
          <div className="live-status">
            <span className={`live-status-dot ${paused ? "paused" : "active"}`} />
            {paused ? "Paused" : "Polling"}
          </div>
          <button className="live-toggle-btn" onClick={() => setPaused((p) => !p)}>
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <span className="live-count">
            {turns.length} turn{turns.length !== 1 ? "s" : ""} · {alertCount} alert{alertCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--red)", marginBottom: 12 }}>
          <p style={{ color: "var(--red)", margin: 0 }}>⚠ {error}</p>
        </div>
      )}

      <div className="live-feed">
        {turns.length === 0 ? (
          <div className="live-empty">
            <div className="live-empty-icon">📡</div>
            <p>No recent turns detected.</p>
            <p style={{ fontSize: 13 }}>
              Start a Copilot session and interact with it — turns will appear here in real time.
            </p>
          </div>
        ) : (
          turns.map((turn) => (
            <div className="live-turn" key={`${turn.sessionId}:${turn.turnIndex}`}>
              <div className="live-turn-header">
                <span className="live-session-id" title={turn.sessionId}>
                  {truncateId(turn.sessionId)}
                </span>
                <span className="live-timestamp">{formatTime(turn.timestamp)}</span>
                {turn.repository && <span className="live-repo">{repoName(turn.repository)}</span>}
              </div>

              {turn.userMessage && (
                <div className="live-message">
                  {turn.userMessage.length > 200
                    ? turn.userMessage.slice(0, 200) + "…"
                    : turn.userMessage}
                </div>
              )}

              {turn.patterns && turn.patterns.length > 0 && (
                <div className="live-badges">
                  {turn.patterns.map((p, i) => (
                    <span key={i} className={`live-badge ${p.category}`} title={p.matchedText}>
                      {p.label} (w{p.weight})
                    </span>
                  ))}
                </div>
              )}

              {turn.maxWeight >= 3 && (
                <div className="live-coaching-card">
                  <div className="live-coaching-header">
                    🚨 Coaching Alert
                  </div>
                  <div className="live-coaching-tip">
                    {COACHING_TIPS[turn.patterns.find((p) => p.weight >= 3)?.category] ||
                      "A strong redirection signal was detected. Review the interaction and consider adjusting your approach."}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
