import { MetricHelp } from "../../components/MetricHelp.jsx";
import { CollapsibleSection } from "../../components/CollapsibleSection.jsx";
import { MiniStat, SuggestionsStack, ResourceCard, clarityColor } from "./shared.jsx";

export function EvaluationTab({ sprawl, tools, tips, resources }) {
  return (
    <>
      <p className="page-intro">
        Evaluation tracks your ability to assess the fitness of agent output — recognizing quality, catching errors, and verifying results.
      </p>

      {sprawl && (
        <div className="card">
          <div className="card-header">📂 Scope Control</div>
          <div className="stats-grid stats-grid-4">
            <MiniStat label={<MetricHelp label="File Sprawl" definition="Sessions where the agent touched many files." target="Under 5 files is focused." action="Scope tasks to specific files." />} value={sprawl.avgFilesPerSession ?? "—"} sub="avg files/session" />
            <MiniStat label="Max Sprawl" value={sprawl.maxFiles ?? "—"} sub="most files touched" />
            <MiniStat label="Sprawl Sessions" value={sprawl.sprawlSessionCount ?? 0} sub={`of ${sprawl.totalSessions ?? 0}`} />
            <MiniStat label="Sprawl Rate" value={`${sprawl.sprawlRate ?? 0}%`} sub="over-scoped" />
          </div>
        </div>
      )}

      {tools && tools.length > 0 && (
        <div className="card">
          <div className="card-header">🔧 Agent Tool Usage</div>
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Tool</th><th>Uses</th><th>Sessions</th></tr></thead>
            <tbody>
              {tools.slice(0, 10).map((t) => (
                <tr key={t.tool}><td>{t.tool}</td><td style={{ textAlign: "center" }}>{t.count}</td><td style={{ textAlign: "center" }}>{t.sessions}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tips?.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Evaluation Tips</div>
          <SuggestionsStack
            suggestions={tips.map((t) => ({
              priority: t.priority || "info",
              emoji: t.emoji || "💡",
              title: t.title || "Tip",
              body: t.body || t.tip || t,
            }))}
            showAddButton
            defaultPillar="evaluation"
            defaultSource="coaching-suggestion"
          />
        </div>
      )}

      {resources?.length > 0 && (
        <CollapsibleSection title="📚 Recommended Resources" id="skills-resources" defaultOpen={false}>
          <div className="resource-grid">
            {resources.map((r, i) => <ResourceCard key={i} resource={r} priority={i === 0} />)}
          </div>
        </CollapsibleSection>
      )}
    </>
  );
}
