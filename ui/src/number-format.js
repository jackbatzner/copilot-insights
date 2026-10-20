export function compactNumber(value, metric, locale) {
  if (!Number.isFinite(value)) return null;
  if (metric === "estimatedUsd") {
    if (value > 0 && value < 0.01) return "<$0.01";
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  }
  const options = { notation: "compact", maximumFractionDigits: 1 };
  if (metric?.endsWith("Ms")) {
    if (Math.abs(value) >= 3_600_000) return `${(value / 3_600_000).toLocaleString(locale, { maximumFractionDigits: 1 })} h`;
    if (value > 0 && value < 0.1) return "<0.1 ms";
    if (Math.abs(value) >= 60_000) return `${(value / 60_000).toLocaleString(locale, { maximumFractionDigits: 1 })} min`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`;
    return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ms`;
  }
  if (["requestMultiplier", "localCredits", "requestCost"].includes(metric)) return null;
  return Math.abs(value) >= 1000 ? value.toLocaleString(locale, options) : null;
}
