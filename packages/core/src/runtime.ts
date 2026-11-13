import type { Usage } from "./pricing.js";
import type { RuntimeKind } from "./placement.js";

/** Everything a runtime needs to run one operation. */
export interface AgentTask {
  operationId: string;
  persona: string;
  model: string;
  systemPrompt: string;
  /** The task prompt. Must never contain credentials: transcripts persist. */
  prompt: string;
  maxTurns: number;
  /** Hard cap on spend for this one operation, in USD. */
  budgetUsd: number;
  /** Tools the persona may use (names from the runtime's built-in toolset). */
  allowedTools: string[];
  timeoutMs: number;
}

export interface AgentRunResult {
  /** Final assistant text. Structured output is extracted from it by the caller. */
  finalText: string;
  usage: Usage;
  /** Provider-reported cost in USD, when the runtime reports one (Managed Agents list_cost). */
  providerCostUsd?: number;
  /** Billable runtime, for runtimes that charge by time. */
  sessionRuntimeMs?: number;
  /** Session id, container id or Actions run id. */
  externalId: string;
  stopReason: string;
}

export interface AgentRuntime {
  readonly kind: RuntimeKind;
  /** Is this runtime able to take work right now? */
  available(): Promise<boolean>;
  run(task: AgentTask): Promise<AgentRunResult>;
}
