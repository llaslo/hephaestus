import Anthropic from "@anthropic-ai/sdk";
import type { AgentRunResult, AgentRuntime, AgentTask } from "@hephaestus/core";
import { centsStringToUsd } from "@hephaestus/core";

/**
 * Claude Managed Agents runtime: Anthropic runs the agent loop and the sandbox.
 * One session per operation. The persona's model, system prompt and tools are applied
 * as overrides on a single base agent created by `pnpm setup:managed`.
 */
export class ManagedAgentsRuntime implements AgentRuntime {
  readonly kind = "managed" as const;

  constructor(
    private readonly client: Anthropic,
    private readonly baseAgentId: string,
    private readonly environmentId: string,
  ) {}

  async available(): Promise<boolean> {
    return true;
  }

  async run(task: AgentTask): Promise<AgentRunResult> {
    const session = await this.client.beta.sessions.create({
      agent: {
        type: "agent_with_overrides",
        id: this.baseAgentId,
        model: task.model,
        system: task.systemPrompt,
        tools: [
          {
            type: "agent_toolset_20260401",
            // Least privilege: everything off, then enable only the persona's tools.
            default_config: { enabled: false },
            configs: task.allowedTools.map((name) => ({ name, enabled: true })) as never,
          },
        ],
      },
      environment_id: this.environmentId,
      title: `${task.persona} ${task.operationId}`,
      metadata: { operation_id: task.operationId, persona: task.persona },
      budget: {
        type: "limit",
        max_list_cost: { amount: String(Math.max(1, Math.round(task.budgetUsd * 100))), currency: "USD" },
      },
    });

    const texts: string[] = [];
    let stopReason = "unknown";
    const deadline = Date.now() + task.timeoutMs;

    const stream = await this.client.beta.sessions.events.stream(session.id);
    await this.client.beta.sessions.events.send(session.id, {
      events: [{ type: "user.message", content: [{ type: "text", text: task.prompt }] }],
    });

    try {
      for await (const event of stream) {
        if (Date.now() > deadline) {
          stopReason = "timeout";
          break;
        }
        if (event.type === "agent.message") {
          for (const block of event.content) if (block.type === "text") texts.push(block.text);
        } else if (event.type === "session.status_idle") {
          stopReason = event.stop_reason.type;
          break;
        } else if (event.type === "session.status_terminated") {
          stopReason = "terminated";
          break;
        }
      }
    } finally {
      stream.controller.abort();
    }

    if (stopReason === "timeout") {
      await this.client.beta.sessions.events
        .send(session.id, { events: [{ type: "user.interrupt" }] } as never)
        .catch(() => undefined);
    }

    // Usage comes from the provider, never from the agent's own report.
    const final = await this.client.beta.sessions.retrieve(session.id);
    const u = final.usage;
    return {
      finalText: texts.join("\n"),
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWrite5mTokens: u.cache_creation?.ephemeral_5m_input_tokens ?? 0,
        cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      },
      providerCostUsd: u.list_cost ? centsStringToUsd(u.list_cost.amount) : undefined,
      sessionRuntimeMs: u.active_seconds === undefined ? undefined : Math.round(u.active_seconds * 1000),
      externalId: session.id,
      stopReason,
    };
  }
}
