import type { PriceList } from "./pricing.js";

/**
 * Initial price list, USD per million tokens, as published in October 2026.
 * VERIFY against https://platform.claude.com/docs/en/about-claude/pricing before relying on it.
 * Add a new row with a later effectiveFrom when prices change; never edit old rows.
 */
const effectiveFrom = new Date("2026-10-07T00:00:00Z");
const source = "platform.claude.com/docs/en/about-claude/pricing (Oct 2026)";

export const PRICING_SEED: PriceList[] = [
  {
    model: "claude-haiku-5-5",
    effectiveFrom,
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWrite5mPerMTok: 0.125,
    cacheWrite1hPerMTok: 0.2,
    longContextThreshold: 100_000,
    longContextMultiplier: 5,
    source,
  },
  {
    model: "claude-sonnet-5-5",
    effectiveFrom,
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.1,
    cacheWrite5mPerMTok: 2.5,
    cacheWrite1hPerMTok: 4, // assumed 2x input, the usual 1h cache-write ratio: verify
    source,
  },
  {
    model: "claude-opus-5-5",
    effectiveFrom,
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWrite5mPerMTok: 5,
    cacheWrite1hPerMTok: 8, // assumed 2x input: verify
    source,
  },
  {
    // Fable 5.2 rates not confirmed; seeded with Fable 5.1's published rates. VERIFY.
    model: "claude-fable-5-2",
    effectiveFrom,
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 0.25,
    cacheWrite5mPerMTok: 12.5,
    cacheWrite1hPerMTok: 20,
    source: `${source}; Fable 5.1 rates used as placeholder`,
  },
];
