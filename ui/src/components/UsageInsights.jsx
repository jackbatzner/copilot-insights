import { Link } from "react-router-dom";
import { MetricValue, knownNumber } from "./Usage.jsx";
import { compareKnownDescending, sortSessions } from "../usage-data.js";

export function UsageInsights({ snapshot, link }) {
  const insights = [];
  const models = snapshot.models.filter((row) => knownNumber(row.metrics.totalTokens));
  const modelTotal = models.reduce((sum, row) => sum + row.metrics.totalTokens, 0);
  const topModel = [...models].sort((a, b) => compareKnownDescending(a.metrics.totalTokens, b.metrics.totalTokens))[0];
  if (topModel && modelTotal > 0) insights.push({
    title: "Understand the largest model share",
    text: <>{topModel.model} accounts for {(topModel.metrics.totalTokens / modelTotal * 100).toFixed(1)}% of model tokens with available totals
      {" "}(<MetricValue value={topModel.metrics.totalTokens} /> tokens). This does not measure model quality.</>,
    href: link("/sessions", { model: topModel.model }), action: `Inspect ${topModel.model} sessions`,
  });
  const duration = snapshot.insights?.duration ?? sortSessions(snapshot.sessions, "duration")[0];
  if (knownNumber(duration?.metrics.durationMs) && duration.metrics.durationMs > 0) insights.push({
    title: "Compare long request durations",
    text: <>{duration.label} has the largest recorded request-duration sum: <MetricValue value={duration.metrics.durationMs} name="durationMs" />.
      Concurrent requests can overlap; this is not elapsed session time.</>,
    href: link("/sessions", { sort: "duration" }), action: "Inspect request durations",
  });
  const delegated = snapshot.insights?.delegation ?? sortSessions(snapshot.sessions, "delegation")[0];
  if (knownNumber(delegated?.performance?.childTokens) && delegated.performance.childTokens > 0) insights.push({
    title: "Inspect delegated usage",
    text: <>{delegated.label} has <MetricValue value={delegated.performance.childTokens} /> tokens with recorded child attribution.
      Inspect the linked usage before changing delegation; no skill impact or quality is inferred.</>,
    href: link("/sessions", { sort: "delegation" }), action: "Inspect child usage",
  });
  if (insights.length < 3) {
    const cache = snapshot.insights?.cache ?? sortSessions(snapshot.sessions, "cache")[0];
    if (knownNumber(cache?.metrics.cacheReadTokens) && cache.metrics.cacheReadTokens > 0) insights.push({
      title: "Explore recorded cache reads",
      text: <>{cache.label} records <MetricValue value={cache.metrics.cacheReadTokens} /> cache-read tokens.
        These observations are not a savings estimate or a billing conversion.</>,
      href: link("/sessions", { sort: "cache" }), action: "Inspect cache usage",
    });
  }
  return <section aria-labelledby="usage-insights-heading" className="usage-insights">
    <div className="section-heading"><h2 id="usage-insights-heading">Usage insights</h2><span className="scope-note">Evidence first. Decisions stay with you.</span></div>
    {insights.length ? <><article className="card insight primary-insight">
      <h3>{insights[0].title}</h3><p>{insights[0].text}</p><Link className="button-link" to={insights[0].href}>{insights[0].action} <span aria-hidden="true">→</span></Link>
    </article>{insights.length > 1 && <details className="secondary-insights"><summary>Other usage signals ({Math.min(insights.length - 1, 2)})</summary>
      <div className="insight-grid">{insights.slice(1, 3).map((insight) => <article className="card insight" key={insight.title}>
      <h3>{insight.title}</h3><p>{insight.text}</p><Link to={insight.href}>{insight.action} <span aria-hidden="true">→</span></Link>
    </article>)}</div></details>}</> : <div className="card insight-empty"><p>More recorded measurements are needed to compare usage. No optimization or quality claim is inferred from missing data.</p>
      <Link to="/settings">Check data sources</Link></div>}
  </section>;
}
