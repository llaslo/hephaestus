#!/usr/bin/env node
/**
 * Runs ONE Hephaestus operation with the Claude Agent SDK and prints a single JSON line:
 *   { finalText, stopReason, sdkCostUsd, usage }
 * Input: the AgentTask as JSON on stdin. Used by the local Docker runtime and by the
 * GitHub Actions runtime. Never run this directly on a developer machine outside a container.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

interface AgentTask {
  operationId: string;
  persona: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  maxTurns: number;
  budgetUsd: number;
  allowedTools: string[];
  timeoutMs: number;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const task = JSON.parse(await readStdin()) as AgentTask;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), task.timeoutMs);

  let finalText = "";
  let stopReason = "unknown";
  let sdkCostUsd = 0;
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

  try {
    for await (const message of query({
      prompt: task.prompt,
      options: {
        model: task.model,
        systemPrompt: task.systemPrompt,
        maxTurns: task.maxTurns,
        maxBudgetUsd: task.budgetUsd,
        // Least privilege: only the persona's tools; nothing prompts, nothing else is allowed.
        allowedTools: task.allowedTools,
        tools: task.allowedTools,
        permissionMode: "dontAsk",
        cwd: "/work",
        abortController: abort,
        // Do not load user/project settings from the container filesystem.
        settingSources: [],
      },
    })) {
      if (message.type === "result") {
        stopReason = message.subtype;
        sdkCostUsd = message.total_cost_usd;
        if (message.subtype === "success") finalText = message.result;
        // modelUsage covers every model call (main loop and subagents): use it for accounting.
        for (const m of Object.values(message.modelUsage)) {
          usage.inputTokens += m.inputTokens;
          usage.outputTokens += m.outputTokens;
          usage.cacheReadTokens += m.cacheReadInputTokens;
          usage.cacheWrite5mTokens += m.cacheCreationEphemeral5mInputTokens ?? m.cacheCreationInputTokens;
          usage.cacheWrite1hTokens += m.cacheCreationEphemeral1hInputTokens ?? 0;
        }
      }
    }
  } catch (err) {
    stopReason = abort.signal.aborted ? "timeout" : `error: ${(err as Error).message}`;
  } finally {
    clearTimeout(timer);
  }

  process.stdout.write(`${JSON.stringify({ finalText, stopReason, sdkCostUsd, usage })}\n`);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
