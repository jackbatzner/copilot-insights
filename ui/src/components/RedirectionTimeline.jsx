import { CATEGORY_META } from "./ScoreBadge.jsx";

function cleanMessage(msg) {
  return msg
    .replace(/<[^>]+>/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function RedirectionTimeline({ redirections }) {
  if (!redirections || redirections.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">✅</div>
        <p>No redirections detected in this session.</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {redirections.map((r, i) => {
        const maxWeight = Math.max(...r.matches.map((m) => m.weight));
        return (
          <div key={i} className="timeline-item">
            <div className={`timeline-dot weight-${maxWeight}`} />
            <div className="timeline-turn">Turn {r.turnIndex}</div>
            <div className="timeline-tags">
              {r.matches.map((m, j) => {
                const meta = CATEGORY_META[m.category] || {
                  emoji: "❓",
                  label: m.category,
                };
                return (
                  <span key={j} className="timeline-tag">
                    {meta.emoji} {m.label}
                  </span>
                );
              })}
            </div>
            <div className="timeline-message">
              {cleanMessage(r.message)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
