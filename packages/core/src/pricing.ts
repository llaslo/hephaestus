/**
 * Cost computation from token usage. Prices are USD per million tokens.
 * Managed Agents sessions report their own `list_cost`, which is authoritative;
 * this computation is used for local/Actions runtimes and as a cross-check.
 */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
}

export interface PriceList {
  model: string;
  effectiveFrom: Date;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  /** Prompt size (input incl. cache) above which the multiplier applies. */
  longContextThreshold?: number | null;
  longContextMultiplier?: number | null;
  source: string;
}

/** Managed Agents session runtime, USD per session-hour. */
export const MANAGED_SESSION_HOURLY_USD = 0.08;

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
});

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
  };
}

/**
 * Token cost for ONE request. Long-context tiers are decided per request, so callers that
 * aggregate many requests should pass `promptTokens` of the largest request or compute per turn.
 */
export function tokenCostUsd(usage: Usage, price: PriceList, promptTokens?: number): number {
  const prompt =
    promptTokens ??
    usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
  const multiplier =
    price.longContextThreshold && price.longContextMultiplier && prompt > price.longContextThreshold
      ? price.longContextMultiplier
      : 1;
  const perToken = (perMTok: number) => (perMTok * multiplier) / 1_000_000;
  const cost =
    usage.inputTokens * perToken(price.inputPerMTok) +
    usage.outputTokens * perToken(price.outputPerMTok) +
    usage.cacheReadTokens * perToken(price.cacheReadPerMTok) +
    usage.cacheWrite5mTokens * perToken(price.cacheWrite5mPerMTok) +
    usage.cacheWrite1hTokens * perToken(price.cacheWrite1hPerMTok);
  return round6(cost);
}

export function sessionRuntimeCostUsd(activeSeconds: number): number {
  return round6((activeSeconds / 3600) * MANAGED_SESSION_HOURLY_USD);
}

/** Pick the price list in effect at `at` for `model`. */
export function priceAt<P extends PriceList>(prices: P[], model: string, at: Date): P | undefined {
  return prices
    .filter((p) => p.model === model && p.effectiveFrom.getTime() <= at.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}

/** Managed Agents reports list_cost as whole US cents in a string, e.g. "187" = $1.87. */
export function centsStringToUsd(cents: string): number {
  const n = Number(cents);
  if (!Number.isFinite(n)) throw new Error(`Bad cents value: ${cents}`);
  return round6(n / 100);
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
