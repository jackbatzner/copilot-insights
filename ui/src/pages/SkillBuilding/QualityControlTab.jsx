import { MetricHelp } from "../../components/MetricHelp.jsx";
import { CollapsibleSection } from "../../components/CollapsibleSection.jsx";
import { MiniStat, SuggestionsStack, clarityColor } from "./shared.jsx";

export function QualityControlTab({ judgment }) {
  if (!judgment) return <p className="empty-state">No quality control data available yet. Complete a few sessions to see analysis.</p>;
  return (
    <>
      <p className="page-intro">
        Quality control measures how you evaluate agent output — reviewing, testing, and catching issues before they ship.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label={<MetricHelp label="QC Score" definition="Quality of your review process: checking output before approving." target="70+ is good review practice." action="Read diffs, run tests, verify behavior." />} value={judgment.avgScore ?? "—"} sub="/100 avg" />
        <MiniStat label={<MetricHelp label="Rubber-Stamp" definition="Approved then immediately corrected — sign of not reviewing." target="0% is ideal." action="Review before approving." />} value={`${judgment.rubberStampRate ?? 0}%`} sub="approve-then-fix" />
        <MiniStat label={<MetricHelp label="Correction Rate" definition="How often you had to correct agent output." target="Under 20% is good." />} value={`${judgment.correctionRate ?? 0}%`} sub="sessions corrected" />
        <MiniStat label="Sessions" value={judgment.totalSessions ?? 0} sub="analyzed" />
      </div>

      {judgment.suggestions?.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Quality Control Suggestions</div>
          <SuggestionsStack
            suggestions={judgment.suggestions}
            showAddButton
            defaultPillar="qualityControl"
            defaultSource="coaching-suggestion"
            defaultBaselineScore={judgment.avgScore}
          />
        </div>
      )}

      {judgment.sessions?.length > 0 && (
        <CollapsibleSection title="🔍 Session Quality Breakdown" id="skills-judgment" defaultOpen={false}>
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Session</th><th>Score</th><th>Corrections</th><th>Rubber-Stamps</th></tr></thead>
            <tbody>
              {judgment.sessions.slice(0, 10).map((s) => (
                <tr key={s.sessionId}>
                  <td className="truncate">{s.summary || s.sessionId.slice(0, 12)}</td>
                  <td style={{ textAlign: "center" }}><span className="clarity-badge" style={{ background: clarityColor(s.score) }}>{s.score}</span></td>
                  <td style={{ textAlign: "center" }}>{s.corrections}</td>
                  <td style={{ textAlign: "center" }}>{s.rubberStamps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}
    </>
  );
}
