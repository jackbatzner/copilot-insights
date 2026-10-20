import { useEffect, useState } from "react";

function Lines({ count = 3 }) {
  return <div className="skeleton-lines">{Array.from({ length: count }, (_, index) =>
    <span className="skeleton-line" key={index} />)}</div>;
}

function Metrics() {
  return <div className="skeleton-metrics">{Array.from({ length: 4 }, (_, index) =>
    <div key={index}><span className="skeleton-line skeleton-label" />
      <span className="skeleton-line skeleton-value" /><span className="skeleton-line" /></div>)}</div>;
}

function Rows({ title }) {
  return <div className="skeleton-panel"><h2>{title}</h2>
    {Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index}><Lines count={2} />
      <span className="skeleton-line skeleton-cell" /><span className="skeleton-line skeleton-cell" /></div>)}
  </div>;
}

export default function UsageLoading({ variant = "rows", label = "Loading recorded usage...", view = false }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, []);
  return <div className={`usage-loading usage-loading-${variant}`}>
    <div className="loading-message" role="status" aria-live="polite" aria-atomic="true">
      <strong>{label}</strong>
      <p>{slow
        ? view ? "The view is taking longer to load. You can still use navigation."
          : "Still loading local usage. Large histories can take a minute or more on the first scan. You can still use navigation."
        : view ? "Preparing this view."
          : "Reading local usage metadata, not conversation text. Totals appear when the read completes."}</p>
    </div>
    <div className="usage-skeleton" aria-hidden="true">
      {["overview", "tokens", "detail", "metrics", "comparison"].includes(variant) && <Metrics />}
      {variant === "overview" ? <>
        <div className="skeleton-shares">{["Model share", "Scope share"].map((title) =>
          <div className="skeleton-panel" key={title}><h2>{title}</h2><Lines /></div>)}</div>
        <div className="skeleton-panel"><h2>Daily usage</h2><div className="skeleton-chart">
          <span>Waiting for recorded usage</span>
        </div></div>
      </> : variant === "metrics" ? null
        : <Rows title={{ sessions: "Recorded sessions", detail: "Usage attribution", tokens: "Agent & Skill Performance",
          comparison: "Observed model comparison" }[variant] || "Recorded activity"} />}
    </div>
  </div>;
}
