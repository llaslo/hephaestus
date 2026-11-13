export const RUNTIMES = ["managed", "managed_self_hosted", "local", "actions"] as const;
export type RuntimeKind = (typeof RUNTIMES)[number];

export interface PlacementPolicy {
  defaultRuntime: RuntimeKind;
  byPersona: Record<string, RuntimeKind>;
  byRepo: Record<string, RuntimeKind>;
  /** Repos whose code must not run in Anthropic's sandbox (data residency). */
  pinnedRepos: string[];
}

export interface PlacementInput {
  persona: string;
  repo: string;
  /** Per-operation override from the UI. */
  override?: RuntimeKind;
}

export interface RunnerState {
  localAvailable: boolean;
  /** Seconds the operation has already waited for a local slot. */
  waitedSeconds: number;
  maxLocalWaitSeconds: number;
}

export type Placement =
  | { kind: "place"; runtime: RuntimeKind; reason: string }
  | { kind: "wait"; reason: string };

const STAYS_LOCAL: RuntimeKind[] = ["local", "managed_self_hosted"];

/**
 * First match wins: operation override, persona, repo, global default.
 * Pinned repos are the exception: their code only ever runs locally or in a
 * self-hosted sandbox, whatever the persona or default says.
 */
export function choosePlacement(
  policy: PlacementPolicy,
  input: PlacementInput,
  runner: RunnerState,
): Placement {
  if (policy.pinnedRepos.includes(input.repo)) {
    const pinned: RuntimeKind =
      input.override && STAYS_LOCAL.includes(input.override)
        ? input.override
        : policy.byRepo[input.repo] && STAYS_LOCAL.includes(policy.byRepo[input.repo]!)
          ? policy.byRepo[input.repo]!
          : "managed_self_hosted";
    if (pinned === "local" && !runner.localAvailable) {
      return { kind: "wait", reason: `repo ${input.repo} is pinned; never falls back to the cloud` };
    }
    return { kind: "place", runtime: pinned, reason: `repo ${input.repo} is pinned` };
  }

  const [runtime, reason] = input.override
    ? [input.override, "operation override"]
    : policy.byPersona[input.persona]
      ? [policy.byPersona[input.persona]!, `persona ${input.persona}`]
      : policy.byRepo[input.repo]
        ? [policy.byRepo[input.repo]!, `repo ${input.repo}`]
        : [policy.defaultRuntime, "global default"];

  if (runtime !== "local") return { kind: "place", runtime, reason };

  if (runner.localAvailable) return { kind: "place", runtime: "local", reason };

  // Local runner unavailable: fall back to the cloud after the configured wait.
  if (runner.waitedSeconds >= runner.maxLocalWaitSeconds) {
    return { kind: "place", runtime: "managed", reason: `${reason}; local unavailable, fell back to managed` };
  }
  return { kind: "wait", reason: "waiting for a local runner slot" };
}
