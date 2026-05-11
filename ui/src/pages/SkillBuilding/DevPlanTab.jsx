import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { fetchDevPlanGoals, updateDevPlanGoalStatus, deleteDevPlanGoal, addGoalNote } from "../../api";
import { CollapsibleSection } from "../../components/CollapsibleSection.jsx";
import { getPillarLabel, getPillarBadgeKey } from "../../pillar-config.js";
import { ResourceCard, AddToDevPlanButton } from "./shared.jsx";

function GoalNotes({ goal, onNoteAdded }) {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const notesId = `goal-notes-${goal.id}`;

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      await addGoalNote(goal.id, noteText);
      setNoteText("");
      onNoteAdded();
    } catch (err) {
      console.error("Failed to add note:", err);
    }
    setSaving(false);
  };

  const notes = goal.notes || [];

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={notesId}
        style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, cursor: "pointer", padding: 0 }}
      >
        {expanded ? "▼" : "▶"} Notes & Insights ({notes.length})
      </button>
      {expanded && (
        <div id={notesId} style={{ marginTop: 6, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
          {notes.map((n, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{new Date(n.createdAt).toLocaleDateString()}</span>
              <div style={{ marginTop: 2 }}>{n.text}</div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
              placeholder="Any insights or reminders for yourself?"
              style={{
                flex: 1, fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)",
                borderRadius: 6, background: "var(--bg)", color: "var(--text)",
              }}
            />
            <button
              onClick={handleAddNote}
              disabled={saving || !noteText.trim()}
              style={{
                background: "var(--accent)", color: "white", border: "none", borderRadius: 6,
                fontSize: 11, padding: "6px 12px", cursor: saving ? "wait" : "pointer",
                opacity: saving || !noteText.trim() ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DevPlanTab({ plan, gaps }) {
  const [goals, setGoals] = useState(null);
  const [goalsLoading, setGoalsLoading] = useState(true);

  const loadGoals = useCallback(() => {
    setGoalsLoading(true);
    fetchDevPlanGoals(true)
      .then(data => setGoals(data?.goals || []))
      .catch(() => setGoals([]))
      .finally(() => setGoalsLoading(false));
  }, []);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const handleMarkSufficient = async (id) => {
    await updateDevPlanGoalStatus(id, "sufficient");
    loadGoals();
  };

  const handleRemove = async (id) => {
    await deleteDevPlanGoal(id);
    loadGoals();
  };

  const handleReactivate = async (id) => {
    await updateDevPlanGoalStatus(id, "active");
    loadGoals();
  };

  const activeGoals = (goals || []).filter(g => g.status === "active");
  const completedGoals = (goals || []).filter(g => g.status === "sufficient");

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">🎯 Your Development Goals</div>
        {goalsLoading ? (
          <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>Loading goals…</div>
        ) : activeGoals.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
            <p style={{ fontSize: 13, marginBottom: 4 }}>No development goals yet.</p>
            <p style={{ fontSize: 12 }}>Add tips from the skill tabs or Quick Wins using the <strong>➕ Add to Dev Plan</strong> button.</p>
          </div>
        ) : (
          <div>
            {activeGoals.map((goal) => {
              const improved = goal.baselineScore != null && goal.latestScore != null && goal.latestScore > goal.baselineScore;
              const declined = goal.baselineScore != null && goal.latestScore != null && goal.latestScore < goal.baselineScore;
              return (
                <div key={goal.id} style={{ padding: "12px 12px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span className="pillar-pill" data-pillar={getPillarBadgeKey(goal.pillar)}>{getPillarLabel(goal.pillar)}</span>
                        <strong style={{ fontSize: 13 }}>{goal.title}</strong>
                      </div>
                      {goal.description && (
                        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>{goal.description}</p>
                      )}
                      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                        <span>Added {new Date(goal.addedAt).toLocaleDateString()}</span>
                        {goal.baselineScore != null && goal.latestScore != null && (
                          <span style={{ color: improved ? "var(--green)" : declined ? "var(--red)" : "var(--text-muted)" }}>
                            {improved ? "📈" : declined ? "📉" : "➡️"} Score: {goal.baselineScore} → {goal.latestScore}
                          </span>
                        )}
                        {goal.baselineScore != null && goal.latestScore == null && (
                          <span>Baseline: {goal.baselineScore}</span>
                        )}
                      </div>
                      <GoalNotes goal={goal} onNoteAdded={loadGoals} />
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => handleMarkSufficient(goal.id)}
                        style={{ background: "none", border: "1px solid var(--green)", borderRadius: 6, color: "var(--green)", fontSize: 11, padding: "4px 8px", cursor: "pointer" }}
                        title="Mark as development sufficient"
                      >
                        ✅ Sufficient
                      </button>
                      <button
                        onClick={() => handleRemove(goal.id)}
                        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 11, padding: "4px 8px", cursor: "pointer" }}
                        title="Remove from dev plan"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {completedGoals.length > 0 && (
        <CollapsibleSection title={`✅ Development Sufficient (${completedGoals.length})`} id="skills-completed-goals" defaultOpen={false}>
          <div className="card">
            {completedGoals.map((goal) => (
              <div key={goal.id} style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", opacity: 0.7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span className="pillar-pill" data-pillar={getPillarBadgeKey(goal.pillar)}>{getPillarLabel(goal.pillar)}</span>
                    <span style={{ fontSize: 13, marginLeft: 8 }}>{goal.title}</span>
                    {goal.baselineScore != null && goal.latestScore != null && (
                      <span style={{ fontSize: 11, color: "var(--green)", marginLeft: 8 }}>
                        {goal.baselineScore} → {goal.latestScore}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleReactivate(goal.id)}
                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}
                  >
                    Reactivate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {gaps && gaps.totalGaps > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--purple)" }}>
          <div className="card-header">🔁 Stop Repeating Yourself</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 4px 8px" }}>
            {gaps.totalSignals} manual corrections across {gaps.totalGaps} patterns. Add them to <code>.copilot-instructions.md</code>.
          </div>
          {gaps.gaps?.slice(0, 3).map((g, i) => (
            <div key={i} style={{ padding: "8px 8px", borderTop: "1px solid var(--border)", fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text)" }}>{g.label}</span>
                <span style={{ color: "var(--text-muted)" }}>{g.count}× corrected</span>
              </div>
              <div style={{ marginTop: 6, padding: "6px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", userSelect: "all", cursor: "text" }}>
                {g.suggestedRule || `Add to .copilot-instructions.md: "${g.label}"`}
              </div>
            </div>
          ))}
          <div style={{ padding: "8px 8px 4px", fontSize: 11 }}>
            <Link to="/instructions" style={{ color: "var(--accent)" }}>View all {gaps.totalGaps} gaps →</Link>
          </div>
        </div>
      )}

      {plan.learningPath && (
        <>
          <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--purple)" }}>
            <div className="card-header">📚 Suggested Resources: {getPillarLabel(plan.learningPath.focus)}</div>
            <p style={{ margin: "8px 0", color: "var(--text-muted)", fontSize: 12 }}>
              Explore these resources to strengthen your {getPillarLabel(plan.learningPath.focus)} skills. Add any that interest you to your Dev Plan.
            </p>
          </div>
          {plan.learningPath.primary?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">📖 Priority Reading</div>
              {plan.learningPath.primary.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}><ResourceCard resource={r} priority /></div>
                  <AddToDevPlanButton
                    pillar={plan.learningPath.focus}
                    title={`Read: ${r.title}`}
                    description={`${r.description} (${r.provider}, ${r.time})`}
                    source="learning-resource"
                  />
                </div>
              ))}
            </div>
          )}
          {plan.learningPath.secondary?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">📚 Also Recommended</div>
              {plan.learningPath.secondary.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}><ResourceCard resource={r} /></div>
                  <AddToDevPlanButton
                    pillar={plan.learningPath.focus}
                    title={`Read: ${r.title}`}
                    description={`${r.description} (${r.provider}, ${r.time})`}
                    source="learning-resource"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="card" style={{ marginTop: 16, textAlign: "center", padding: 12 }}>
        <a
          href="/api/devplan/journal"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", fontSize: 13 }}
        >
          📄 View Development Journal (Markdown)
        </a>
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          Your goals, progress, and notes are also saved to <code>~/.copilot/copilot-insights-journal.md</code>
        </p>
      </div>
    </>
  );
}
