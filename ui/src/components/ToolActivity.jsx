import { useState } from "react";
import { knownNumber, MetricValue } from "./Usage.jsx";
import "./ResponsiveTables.css";

const labels = {
  "file-read": "File reads", "file-edit": "File edits", search: "Search",
  shell: "Shell", delegation: "Delegation", web: "Web", mcp: "MCP", other: "Other",
};

export function ToolCategories({ group, category = "" }) {
  const categories = group?.categories?.filter((row) => !category || row.category === category);
  if (!categories?.length) return null;
  return <div className="tool-breakdown">
    <div className="table-scroll" role="region" aria-label={`${group.agentLabel} tool categories`} tabIndex={0}>
      <table className="session-table responsive-card-table" role="table" aria-label={`${group.agentLabel} tool categories`}>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Tool category</th><th role="columnheader" scope="col">Calls</th><th role="columnheader" scope="col">Outcomes</th>
          <th role="columnheader" scope="col">Timed duration</th><th role="columnheader" scope="col">Recorded models</th></tr></thead>
        <tbody role="rowgroup">{categories.map((row) => <tr role="row" key={row.category}>
          <th role="rowheader" scope="row" data-primary>{labels[row.category] || "Other"}</th>
          <td role="cell" data-label="Calls"><MetricValue value={row.count} /></td>
          <td role="cell" data-label="Outcomes">{[
            [row.succeededCount, "succeeded"], [row.failedCount, "failed"], [row.unknownOutcomeCount, "no outcome"],
          ].filter(([count]) => count > 0).map(([count, label]) => <span className="tool-outcome" key={label}>
            <MetricValue value={count} /> {label}
          </span>)}</td>
          <td role="cell" data-label="Timed duration">{knownNumber(row.durationMs) ? <><MetricValue value={row.durationMs} name="durationMs" />
            <span className="scope-note"><MetricValue value={row.timedCount} /> of <MetricValue value={row.count} /> timed</span></>
            : <span aria-label="Duration not recorded">-</span>}</td>
          <td role="cell" data-label="Recorded models">{row.models.length ? row.models.join(" / ") : <span aria-label="Model not recorded">-</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export function AgentToolActivity({ group }) {
  if (!group) return null;
  return <section aria-label={`${group.agentLabel} tool activity`}>
    <h3>Tool activity</h3>
    <p className="scope-note"><MetricValue value={group.count} /> calls across this child invocation, not allocated to individual turns or model calls.</p>
    <ToolCategories group={group} />
  </section>;
}

export default function ToolActivity({ value, attribution, onInspect }) {
  const [category, setCategory] = useState("");
  const groups = (value?.groups ?? []).filter((group) => !category || group.categories.some((row) => row.category === category));
  const count = (group) => category ? group.categories.find((row) => row.category === category).count : group.count;
  const available = new Set(value?.groups?.flatMap((group) => group.categories.map((row) => row.category)));
  return <section className="tool-activity" aria-labelledby="tool-activity-heading">
    <div className="section-heading"><h2 id="tool-activity-heading">Tool activity</h2>
      {value?.source === "jsonl" && <span className="pill">JSONL{value.status === "partial" ? " / partial" : ""}</span>}</div>
    {!knownNumber(value?.count) ? <p className="notice">Tool activity is not recorded in the available local execution metadata.</p>
      : <>
        <p><strong><MetricValue value={value.count} /> observed calls</strong> / <MetricValue value={value.linkedCount} /> linked to child agents
          {" / "}<MetricValue value={value.unlinkedCount} /> session or unlinked</p>
        <p className="scope-note">Linked by recorded parent calls, never by timing. Counts and durations cover invocations,
          not individual turns or token costs. Durations may overlap; models are execution metadata.</p>
        <p className="scope-note">MCP calls are grouped by category. Server names, tool names, arguments and results are not exposed.</p>
        <div className="filter-bar"><label>Tool category<select aria-label="Tool category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {category && !available.has(category) && <option value={category}>{labels[category]} (not recorded)</option>}
          {Object.entries(labels).filter(([key]) => available.has(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label></div>
        {category && <p className="scope-note" role="status">{groups.reduce((total, group) => total + count(group), 0)} {labels[category]} calls in this view.
          {" "}Session totals stay unchanged. Agent links open the whole invocation.</p>}
        <div className="tool-groups">{groups.map((group, index) => {
          const targetIndex = attribution.findIndex((entry) => entry.key === group.attributionKey);
          return targetIndex >= 0 ? <a key={group.attributionKey} href={`#attribution-${targetIndex}`} onClick={(event) => {
            event.preventDefault();
            onInspect(group.attributionKey);
          }}>{group.agentLabel}: <MetricValue value={count(group)} interactive={false} /> calls - inspect agent activity</a>
            : <details key={index}><summary>{group.agentLabel}: <MetricValue value={count(group)} interactive={false} /> calls</summary>
              <ToolCategories group={group} category={category} /></details>;
        })}</div>
        {category && !groups.length && <p className="notice">No calls match this category. Choose All categories to see the available observations.</p>}
      </>}
  </section>;
}
