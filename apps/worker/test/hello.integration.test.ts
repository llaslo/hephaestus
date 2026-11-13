/**
 * End-to-end test of the hello flow against a real PostgreSQL, with a scripted agent runtime
 * and an in-memory GitHub. Skipped unless DATABASE_URL points at a migrated, seeded database.
 */
import { describe, expect, it } from "vitest";
import {
  createDb,
  eq,
  schema,
  type AgentRunResult,
  type AgentRuntime,
  type AgentTask,
  type Config,
  type Persona,
} from "@hephaestus/core";
import { runHello } from "../src/flows/hello.js";
import type { GitHubAdapter, Issue } from "../src/github.js";

const url = process.env.DATABASE_URL;

class ScriptedRuntime implements AgentRuntime {
  readonly kind = "managed" as const;
  calls: AgentTask[] = [];
  constructor(private readonly replies: string[]) {}
  async available() {
    return true;
  }
  async run(task: AgentTask): Promise<AgentRunResult> {
    this.calls.push(task);
    const text = this.replies[this.calls.length - 1] ?? "no json";
    return {
      finalText: text,
      usage: { inputTokens: 2000, outputTokens: 500, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
      providerCostUsd: 0.01,
      sessionRuntimeMs: 3000,
      externalId: `sesn_test_${this.calls.length}`,
      stopReason: "end_turn",
    };
  }
}

function fakeGitHub() {
  const events: string[] = [];
  const gh = {
    async repoContext() {
      return { defaultBranch: "main", readme: "# Sandbox", files: ["README.md"] };
    },
    async setLabels(_r: string, n: number, add: string[], remove: string[] = []) {
      events.push(`labels #${n} +${add.join(",")} -${remove.join(",")}`);
    },
    async comment(_r: string, n: number, body: string) {
      events.push(`comment #${n}: ${body.slice(0, 40)}`);
    },
    async commitToBranch(_r: string, branch: string, files: { path: string }[]) {
      events.push(`commit ${branch} ${files.map((f) => f.path).join(",")}`);
      return "abc123";
    },
    async openDraftPr() {
      events.push("pr");
      return { number: 7, url: "https://github.com/x/y/pull/7" };
    },
  };
  return { gh: gh as unknown as GitHubAdapter, events };
}

const persona: Persona = {
  name: "hello",
  version: 1,
  category: "code_generation",
  maxTurns: 4,
  budgetUsd: 0.25,
  timeoutSeconds: 60,
  tools: [],
  system: "test",
  output: "change_proposal",
};

const config = { HEPH_DAILY_BUDGET_USD: 1000, HEPH_MAX_LOCAL_WAIT_SECONDS: 0 } as Config;
const good =
  'ok\n```json\n{"summary":"Added greeting","files":[{"path":"HELLO.md","content":"hi"}],"claims":{"filesChanged":["HELLO.md"]}}\n```';
const lying =
  'ok\n```json\n{"summary":"x","files":[{"path":"HELLO.md","content":"hi"}],"claims":{"filesChanged":["HELLO.md","src/app.ts"]}}\n```';

describe.skipIf(!url)("hello flow (integration)", () => {
  const db = createDb(url!);

  it("retries with gate feedback, then opens a PR and writes the ledger", async () => {
    const issue: Issue = { number: Math.floor(Math.random() * 1e9), title: "Say hello", body: "Add HELLO.md", labels: [], htmlUrl: "" };
    const runtime = new ScriptedRuntime([lying, good]);
    const { gh, events } = fakeGitHub();

    await runHello(
      {
        db,
        github: gh,
        runtimes: { managed: runtime },
        persona,
        policy: { defaultRuntime: "managed", byPersona: {}, byRepo: {}, pinnedRepos: [] },
        config,
        log: () => undefined,
      },
      { repo: "test/sandbox", issue },
    );

    const ref = `github:test/sandbox#${issue.number}`;
    const ops = await db.select().from(schema.operations).where(eq(schema.operations.storyRef, ref));
    ops.sort((a, b) => a.attempt - b.attempt);

    expect(ops.map((o) => [o.attempt, o.status, o.model])).toEqual([
      [1, "failed_gate", "claude-haiku-5-5"],
      [2, "succeeded", "claude-haiku-5-5"],
    ]);
    // Second attempt saw the first attempt's findings.
    expect(runtime.calls[1]?.prompt).toContain("claimed but not produced: src/app.ts");
    // Provider cost is authoritative; our computed cost is kept alongside it.
    expect(Number(ops[1]!.costUsd)).toBeCloseTo(0.01, 6);
    expect(Number(ops[1]!.computedCostUsd)).toBeCloseTo((2000 * 0.1 + 500 * 0.5) / 1e6, 6);
    expect(ops[1]!.costSource).toBe("provider");
    expect(ops[1]!.parentOperationId).toBe(ops[0]!.id);
    expect(ops[1]!.artifacts).toMatchObject({ pr: 7, branch: `factory/issue-${issue.number}` });
    expect(events).toContain(`commit factory/issue-${issue.number} HELLO.md`);
  });

  it("escalates Haiku -> Sonnet -> Opus, then raises a Decision Request", async () => {
    const issue: Issue = { number: Math.floor(Math.random() * 1e9), title: "Impossible", body: "", labels: [], htmlUrl: "" };
    const runtime = new ScriptedRuntime([]);
    const { gh, events } = fakeGitHub();
    await runHello(
      {
        db,
        github: gh,
        runtimes: { managed: runtime },
        persona,
        policy: { defaultRuntime: "managed", byPersona: {}, byRepo: {}, pinnedRepos: [] },
        config,
        log: () => undefined,
      },
      { repo: "test/sandbox", issue },
    );
    expect(runtime.calls.map((c) => c.model)).toEqual([
      "claude-haiku-5-5",
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-opus-5-5",
    ]);
    const ref = `github:test/sandbox#${issue.number}`;
    const drs = await db.select().from(schema.decisionRequests).where(eq(schema.decisionRequests.storyRef, ref));
    expect(drs).toHaveLength(1);
    expect(events.some((e) => e.includes("factory:blocked"))).toBe(true);
    expect(events).not.toContain("pr");
  });
});
