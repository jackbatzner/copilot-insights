import { listSessionJsonlFiles, parseJsonlFile } from "./session-state.mjs";

function sortCounts(counter) {
  return Object.entries(counter)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function formatModelMetrics(modelMetrics) {
  if (!modelMetrics || typeof modelMetrics !== "object") return [];

  return Object.entries(modelMetrics).map(([model, metrics]) => ({
    model,
    requests: metrics?.requests?.count || 0,
    premiumCost: metrics?.requests?.cost || 0,
    inputTokens: metrics?.usage?.inputTokens || 0,
    outputTokens: metrics?.usage?.outputTokens || 0,
    cacheReadTokens: metrics?.usage?.cacheReadTokens || 0,
    cacheWriteTokens: metrics?.usage?.cacheWriteTokens || 0,
  }));
}

export function analyzeSessionEvents(sessionId) {
  const files = listSessionJsonlFiles(sessionId);
  if (files.length === 0) return null;

  const toolUsage = {};
  const hookUsage = {};
  const skillUsage = {};
  const subagentUsage = {};
  const modelChanges = [];
  const modeChanges = [];

  let start = null;
  let shutdown = null;
  let currentModel = null;

  for (const file of files) {
    for (const event of parseJsonlFile(file)) {
      const data = event?.data && typeof event.data === "object" ? event.data : {};
      switch (event?.type) {
        case "session.start":
          start = {
            selectedModel: data.selectedModel || null,
            copilotVersion: data.copilotVersion || null,
            producer: data.producer || null,
            startTime: data.startTime || null,
            cwd: data.context?.cwd || null,
          };
          currentModel = currentModel || data.selectedModel || null;
          break;
        case "session.model_change":
          if (data.newModel) {
            currentModel = data.newModel;
            modelChanges.push({
              timestamp: event.timestamp || null,
              newModel: data.newModel,
              reasoningEffort: data.reasoningEffort || null,
            });
          }
          break;
        case "session.mode_changed":
          modeChanges.push({
            timestamp: event.timestamp || null,
            previousMode: data.previousMode || null,
            newMode: data.newMode || null,
          });
          break;
        case "tool.execution_start":
          if (data.toolName) toolUsage[data.toolName] = (toolUsage[data.toolName] || 0) + 1;
          break;
        case "hook.start":
          if (data.hookType) hookUsage[data.hookType] = (hookUsage[data.hookType] || 0) + 1;
          break;
        case "skill.invoked": {
          const skillName = data.skillName || data.skill || data.name;
          if (skillName) skillUsage[skillName] = (skillUsage[skillName] || 0) + 1;
          break;
        }
        case "subagent.started": {
          const subagentName = data.agentName || data.name || data.agentType;
          if (subagentName) subagentUsage[subagentName] = (subagentUsage[subagentName] || 0) + 1;
          break;
        }
        case "session.shutdown":
          currentModel = data.currentModel || currentModel;
          shutdown = {
            shutdownType: data.shutdownType || null,
            totalPremiumRequests: data.totalPremiumRequests || 0,
            totalApiDurationMs: data.totalApiDurationMs || 0,
            currentModel: data.currentModel || currentModel || null,
            currentTokens: data.currentTokens || 0,
            systemTokens: data.systemTokens || 0,
            conversationTokens: data.conversationTokens || 0,
            toolDefinitionsTokens: data.toolDefinitionsTokens || 0,
            codeChanges: {
              linesAdded: data.codeChanges?.linesAdded || 0,
              linesRemoved: data.codeChanges?.linesRemoved || 0,
              filesModified: Array.isArray(data.codeChanges?.filesModified) ? data.codeChanges.filesModified : [],
            },
            modelMetrics: formatModelMetrics(data.modelMetrics),
          };
          break;
        default:
          break;
      }
    }
  }

  const toolSummary = sortCounts(toolUsage);
  const hookSummary = sortCounts(hookUsage);
  const skillSummary = sortCounts(skillUsage);
  const subagentSummary = sortCounts(subagentUsage);

  if (!start && !shutdown && toolSummary.length === 0 && hookSummary.length === 0 && skillSummary.length === 0 && subagentSummary.length === 0 && modelChanges.length === 0 && modeChanges.length === 0) {
    return null;
  }

  return {
    start,
    currentModel: shutdown?.currentModel || currentModel || start?.selectedModel || null,
    modelChanges,
    modeChanges,
    toolUsage: toolSummary,
    hookUsage: hookSummary,
    skillUsage: skillSummary,
    subagentUsage: subagentSummary,
    shutdown,
  };
}
