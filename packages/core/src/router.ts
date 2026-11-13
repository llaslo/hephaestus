import { MODEL_BY_TIER, nextTier, type Tier } from "./models.js";

export const OPERATION_CATEGORIES = [
  "strategic_planning",
  "requirements",
  "story_writing",
  "architecture",
  "ui_ux_design",
  "test_generation",
  "code_generation",
  "verification",
  "pr_review",
  "refactor",
  "release",
  "triage",
] as const;
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];

/** Default tier per category: cheapest model that can usually do the job. */
export const DEFAULT_TIER: Record<OperationCategory, Tier> = {
  strategic_planning: "sonnet",
  requirements: "sonnet",
  story_writing: "haiku",
  architecture: "sonnet",
  ui_ux_design: "sonnet",
  test_generation: "haiku",
  code_generation: "haiku",
  verification: "haiku",
  pr_review: "sonnet",
  refactor: "haiku",
  release: "haiku",
  triage: "haiku",
};

/** Highest tier reachable by automatic escalation. Fable is never automatic. */
export const MAX_AUTO_TIER: Tier = "opus";

export interface RouteInput {
  category: OperationCategory;
  /** 1-based attempt number for this operation. */
  attempt: number;
  /** Optional per-persona override of the default tier. */
  defaultTierOverride?: Tier;
  /** Set only by an approved Decision Request. */
  fableApproved?: boolean;
}

export type RouteDecision =
  | { kind: "run"; tier: Tier; model: string; escalationLevel: number }
  | { kind: "needs_decision"; reason: string; lastTier: Tier };

/**
 * Escalation ladder:
 *   attempt 1 -> default tier
 *   attempt 2 -> same tier, with verifier feedback injected by the caller
 *   attempt 3 -> one tier up; attempt 4 -> same; and so on up to MAX_AUTO_TIER
 *   after two failures at MAX_AUTO_TIER -> needs a human decision (Fable, re-scope, or hand off)
 */
export function route(input: RouteInput): RouteDecision {
  const base = input.defaultTierOverride ?? DEFAULT_TIER[input.category];
  if (input.attempt < 1) throw new Error("attempt is 1-based");

  if (input.fableApproved) {
    return { kind: "run", tier: "fable", model: MODEL_BY_TIER.fable, escalationLevel: -1 };
  }

  let tier: Tier = base;
  let level = 0;
  // Two attempts per tier.
  let remaining = input.attempt - 1;
  while (remaining >= 2) {
    const up = nextTier(tier);
    if (!up || tier === MAX_AUTO_TIER) {
      return {
        kind: "needs_decision",
        reason: `Failed twice at ${tier}; automatic escalation stops at ${MAX_AUTO_TIER}.`,
        lastTier: tier,
      };
    }
    tier = up;
    level += 1;
    remaining -= 2;
  }
  return { kind: "run", tier, model: MODEL_BY_TIER[tier], escalationLevel: level };
}
