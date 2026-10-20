import { compareKnownDescending, knownNumber } from "./usage-data.js";

const callEndings = {
  tool_calls: {
    label: "Tools requested",
    description: "The model ended this call by requesting tools. Another model call can process tool results, but the specific tools and next call are not linked by this marker.",
  },
  stop: {
    label: "Normal stop",
    description: "The model stopped normally. This does not establish that the user's turn was finished or explain why another call started.",
  },
  length: {
    label: "Output limit reached",
    description: "The model reached its output limit. This does not prove that a later call continued the response.",
  },
  error: {
    label: "Error",
    description: "An error was recorded for this call. A later call is not necessarily a retry; no retry linkage is recorded here.",
  },
  cancelled: {
    label: "Cancelled",
    description: "Cancellation was recorded. The initiator and any subsequent restart are not recorded here.",
  },
  content_filter: {
    label: "Content filter",
    description: "A content-filter ending was recorded. No filtered content is read or displayed.",
  },
  "not-recorded": {
    label: "Ending unknown",
    description: "No recognized call-ending marker is available. Token totals and nearby activity cannot explain why this call ended or another began.",
  },
};

export function callEnding(reason) {
  return Object.hasOwn(callEndings, reason) ? callEndings[reason] : callEndings["not-recorded"];
}

export function matchingUsage(requests) {
  const metrics = {};
  const evidence = {};
  for (const name of ["totalTokens", "inputTokens", "outputTokens", "cacheReadTokens", "requests"]) {
    const present = requests.filter((request) => knownNumber(request.metrics?.[name]));
    metrics[name] = present.length ? present.reduce((sum, request) => sum + request.metrics[name], 0) : null;
    const sources = new Set(present.map((request) => request.evidence?.[name]?.source));
    evidence[name] = {
      status: !present.length ? "not-recorded" : present.length < requests.length || present.some((request) => request.evidence?.[name]?.status === "partial") ? "partial" : "derived",
      source: sources.size === 1 ? [...sources][0] : "mixed",
      recorded: present.length, total: requests.length,
    };
  }
  return { metrics, evidence };
}

export const TURN_PAGE_SIZE = 20;
export const REQUEST_PAGE_SIZE = 25;

export function selectTurns(turns, { model = "", scope = "", day = "", assignment = "", sort = "turn" } = {}) {
  return turns.filter((turn) => assignment !== "unassigned" || turn.turnIndex === null)
    .filter((turn) => assignment !== "assigned" || turn.turnIndex !== null)
    .map((turn) => ({
      ...turn,
      matchingRequests: turn.requests.filter((request) =>
        (!model || request.model === model)
        && (!scope || request.scope === scope)
        && (!day || request.createdAt?.slice(0, 10) === day)),
    }))
    .filter((turn) => turn.matchingRequests.length)
    .sort((a, b) => (sort === "tokens" ? compareKnownDescending(a.metrics.totalTokens, b.metrics.totalTokens) : 0)
      || (a.turnIndex === null ? 1 : b.turnIndex === null ? -1 : a.turnIndex - b.turnIndex));
}

export function pageItems(items, requestedPage, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(1, Math.min(pages, requestedPage));
  return { items: items.slice((page - 1) * size, page * size), page, pages };
}
