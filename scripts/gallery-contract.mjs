export const GALLERY_IMAGES = [
  "overview.png", "overview-daily.png", "sessions.png", "session-detail.png",
  "turn-summary-desktop.png", "turn-summary-mobile.png", "turn-requests-desktop.png",
  "token-usage.png", "token-models.png",
  "comparison-observed.png", "comparison-what-if.png", "comparison-baseline.png",
  "settings.png", "empty-overview.png", "sessions-mobile.png", "overview-light.png", "tool-activity-mobile.png",
];
export const GALLERY_LABEL = "SYNTHETIC DATA / TEXT HIDDEN";

// The capture runner supplies only origins of servers it created from fixtures.
export function captureRequestPolicy(url, method, origins) {
  let parsed;
  try { parsed = new URL(url); } catch { return "external"; }
  if (!origins.has(parsed.origin) || !["http:", "https:"].includes(parsed.protocol)) return "external";
  if (/\/content(?:\/|$)/.test(parsed.pathname)) return "content";
  if (method !== "GET") return "mutation";
  if (parsed.pathname.startsWith("/api/") && !/^\/api\/(?:summary|settings|comparison|tokens\/summary|sessions(?:\/[a-f0-9]{64}(?:\/(?:turns|tools))?)?)$/.test(parsed.pathname)) return "unknown-api";
  return "allow";
}

export function assertCaptureSafe(value, forbidden) {
  if (typeof value !== "string" || forbidden.some((marker) => marker && value.includes(marker))) {
    throw new Error("Synthetic capture privacy check failed; no content was logged.");
  }
}
