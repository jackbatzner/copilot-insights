/**
 * Skeleton loading placeholder with shimmer animation.
 * Renders animated gray blocks that roughly match content shapes.
 *
 * Usage:
 *   <SkeletonCard />                  — single card skeleton
 *   <SkeletonCard lines={4} />        — card with 4 text lines
 *   <SkeletonCard variant="stat" />   — compact stat card skeleton
 *   <SkeletonCard variant="row" />    — table row skeleton
 */
export function SkeletonCard({ lines = 3, variant = "card" }) {
  if (variant === "stat") {
    return (
      <div className="skeleton-card skeleton-stat">
        <div className="skeleton-line skeleton-value" />
        <div className="skeleton-line skeleton-label" />
      </div>
    );
  }

  if (variant === "row") {
    return (
      <tr className="skeleton-row">
        <td><div className="skeleton-line skeleton-cell" /></td>
        <td><div className="skeleton-line skeleton-cell-short" /></td>
        <td><div className="skeleton-line skeleton-cell-short" /></td>
        <td><div className="skeleton-line skeleton-cell" /></td>
      </tr>
    );
  }

  return (
    <div className="skeleton-card">
      <div className="skeleton-line skeleton-title" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${85 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 4, variant = "stat" }) {
  return (
    <div className={`stats-grid ${variant === "stat" ? "stats-grid-4" : ""}`}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} variant={variant} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="card">
      <div className="skeleton-line skeleton-title" style={{ marginBottom: 16 }} />
      <table className="session-table" style={{ width: "100%" }}>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <SkeletonCard key={i} variant="row" />
          ))}
        </tbody>
      </table>
    </div>
  );
}
