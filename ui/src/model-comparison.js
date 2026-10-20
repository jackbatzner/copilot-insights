export const CACHE_MODES = {
  uncached: "Input/output only (no cache adjustment)",
  "cache-included": "Assume input includes cache reads",
  "cache-excluded": "Assume input excludes cache reads",
};

const valid = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function combineBasis(models, mode) {
  const result = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, included: 0, total: 0 };
  for (const model of models) {
    const basis = model.pricingBasis?.[mode];
    if (!basis) continue;
    result.total += basis.total;
    if (!basis.included) continue;
    if (![basis.inputTokens, basis.outputTokens, basis.cacheReadTokens].every(valid)) {
      return { ...result, inputTokens: null, outputTokens: null, cacheReadTokens: null };
    }
    for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "included"]) result[field] += basis[field];
  }
  if (!result.included) result.inputTokens = result.outputTokens = result.cacheReadTokens = null;
  return result;
}

export function estimateCost(basis, price) {
  if (!price) return { usd: null, reason: "Pricing unavailable" };
  if (!basis?.included || ![basis.inputTokens, basis.outputTokens, basis.cacheReadTokens].every(valid)) {
    return { usd: null, reason: "No complete eligible usage" };
  }
  if (![price.input, price.output].every(valid) || (basis.cacheReadTokens > 0 && !valid(price.cacheRead))) {
    return { usd: null, reason: "Rate unavailable for this cache assumption" };
  }
  const components = {
    input: basis.inputTokens / 1_000_000 * price.input,
    output: basis.outputTokens / 1_000_000 * price.output,
    cacheRead: basis.cacheReadTokens ? basis.cacheReadTokens / 1_000_000 * price.cacheRead : 0,
  };
  const usd = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (!valid(usd)) return { usd: null, reason: "Usage exceeds the supported numeric range" };
  return { usd, components, coverage: { included: basis.included, total: basis.total }, partial: basis.included < basis.total };
}

export function costDifference(value, baseline) {
  if (!valid(value) || !valid(baseline)) return null;
  const usd = value - baseline;
  const percent = baseline > 0 ? usd / baseline * 100 : null;
  return { usd, percent: Number.isFinite(percent) ? percent : null };
}

export function exactUsd(value) {
  return valid(value) ? value.toLocaleString("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 10,
  }) : "Unavailable";
}
