const knownNumber = (value) => typeof value === "number" && Number.isFinite(value);

export function compareKnownDescending(a, b) {
  if (!knownNumber(a)) return knownNumber(b) ? 1 : 0;
  if (!knownNumber(b)) return -1;
  return b - a;
}

export function sessionSortValue(session, sort, filtered = false) {
  const metrics = filtered ? session.selectedUsage : session.metrics;
  if (sort === "recent") {
    const timestamp = session.updatedAt ? Date.parse(session.updatedAt) : NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (sort === "delegation") return session.performance?.childTokens;
  return metrics?.[{ tokens: "totalTokens", duration: "durationMs", cache: "cacheReadTokens" }[sort] || "totalTokens"];
}

export function sortSessions(sessions, sort, filtered = false) {
  return [...sessions].sort((a, b) => compareKnownDescending(sessionSortValue(a, sort, filtered), sessionSortValue(b, sort, filtered))
    || a.label.localeCompare(b.label, undefined, { numeric: true }) || a.handle.localeCompare(b.handle));
}

export function sessionPage(rows, { page = 1, pageSize = 25, sort = "tokens", after = null, exclude = null } = {}, filtered = false) {
  let selected = rows;
  if (after) {
    const now = new Date().toISOString();
    selected = rows.filter((row) => row.handle !== exclude && !row.hidden
      && (row.updatedAt ?? row.createdAt) > after && (row.updatedAt ?? row.createdAt) <= now
      && ["totalTokens", "inputTokens", "outputTokens", "cacheReadTokens", "requests"].some((key) => knownNumber(row.metrics[key])));
  }
  selected = sort === "later"
    ? [...selected].sort((a, b) => Number(b.createdAt > after) - Number(a.createdAt > after)
      || (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) || a.handle.localeCompare(b.handle))
    : sortSessions(selected, sort, filtered);
  const total = selected.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(page, pages);
  return { sessions: selected.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, pages, total, sort } };
}
