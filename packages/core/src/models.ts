export const TIERS = ["haiku", "sonnet", "opus", "fable"] as const;
export type Tier = (typeof TIERS)[number];

/** Current model id per tier. Change here when Anthropic ships a new generation. */
export const MODEL_BY_TIER: Record<Tier, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-2",
};

export function tierOfModel(model: string): Tier {
  for (const tier of TIERS) {
    if (model.includes(tier)) return tier;
  }
  throw new Error(`Unknown model tier for "${model}"`);
}

/** Next tier up the escalation ladder, or null at the top. */
export function nextTier(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier);
  return TIERS[i + 1] ?? null;
}
