import { useState, useEffect } from "react";
import { fetchSessions, fetchInsights } from "../api.js";

/**
 * "Since last visit" summary card shown at the top of Overview
 * for returning users. Shows new sessions count, key changes,
 * and one coaching tip since the user's last visit.
 */
export function SinceLastVisit({ refreshKey }) {
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const lastVisit = localStorage.getItem("last-visit-timestamp");
    const now = new Date().toISOString();

    // No last visit stored = first time or just completed onboarding, skip
    if (!lastVisit) {
      localStorage.setItem("last-visit-timestamp", now);
      return;
    }

    // Fetch sessions to compute delta
    Promise.all([fetchSessions("all"), fetchInsights("7d")])
      .then(([sessionsData, insightsData]) => {
        const sessions = sessionsData.sessions || [];
        const lastVisitDate = new Date(lastVisit);

        // Count sessions created since last visit
        const newSessions = sessions.filter((s) => {
          const sessionDate = new Date(s.updatedAt || s.createdAt || 0);
          return sessionDate > lastVisitDate;
        });

        const tip = insightsData.insights?.[0]?.message || null;

        if (newSessions.length > 0 || tip) {
          setData({
            newCount: newSessions.length,
            newRedirections: newSessions.reduce((sum, s) => sum + (s.redirectionCount || 0), 0),
            tip,
          });
        }

        // Update timestamp for next visit
        localStorage.setItem("last-visit-timestamp", now);
      })
      .catch(() => {
        // Silently fail — this is non-critical UI
        localStorage.setItem("last-visit-timestamp", now);
      });
  }, [refreshKey]);

  if (!data || dismissed) return null;

  return (
    <div className="since-last-visit-card">
      <div className="since-last-visit-content">
        <div className="since-last-visit-header">
          <span className="since-last-visit-icon">👋</span>
          <strong>Since your last visit</strong>
        </div>
        <div className="since-last-visit-stats">
          {data.newCount > 0 && (
            <span className="since-last-visit-stat">
              <span className="since-last-visit-number">{data.newCount}</span> new session{data.newCount !== 1 ? "s" : ""}
            </span>
          )}
          {data.newRedirections > 0 && (
            <span className="since-last-visit-stat">
              <span className="since-last-visit-number">{data.newRedirections}</span> redirection{data.newRedirections !== 1 ? "s" : ""} detected
            </span>
          )}
        </div>
        {data.tip && (
          <div className="since-last-visit-tip">
            💡 <span>{data.tip}</span>
          </div>
        )}
      </div>
      <button
        className="since-last-visit-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
