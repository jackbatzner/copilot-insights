import { Link } from "react-router-dom";

const MIN_SESSIONS_FOR_TRENDS = 5;

/**
 * Friendly empty state shown when user has too few sessions for meaningful data.
 * @param {object} props
 * @param {number} props.sessionCount - Number of sessions available
 * @param {string} [props.feature] - Name of the feature that needs more data
 */
export function EmptyState({ sessionCount = 0, feature = "meaningful insights" }) {
  if (sessionCount >= MIN_SESSIONS_FOR_TRENDS) return null;

  const message = sessionCount === 0
    ? "No sessions found yet — complete your first Copilot CLI session to get started!"
    : `You have ${sessionCount} session${sessionCount > 1 ? "s" : ""} so far. You need ${MIN_SESSIONS_FOR_TRENDS}+ sessions for ${feature}.`;

  return (
    <div className="empty-state-card card" style={{ textAlign: "center", padding: "32px 24px" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🌱</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
        Keep going!
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
        {message}
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <Link
          to="/practice"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8,
            background: "var(--accent)", color: "#fff",
            textDecoration: "none", fontSize: 13, fontWeight: 600,
          }}
        >
          🧪 Try Practice Lab
        </Link>
        {sessionCount > 0 && (
          <Link
            to="/sessions"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8,
              background: "var(--bg-card)", color: "var(--text-secondary)",
              textDecoration: "none", fontSize: 13, border: "1px solid var(--border)",
            }}
          >
            📋 View Sessions
          </Link>
        )}
      </div>
    </div>
  );
}

export { MIN_SESSIONS_FOR_TRENDS };
