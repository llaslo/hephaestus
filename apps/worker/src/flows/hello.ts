import {
  ChangeProposalSchema,
  eq,
  OUTPUT_SCHEMAS,
  choosePlacement,
  claimVsEvidenceGate,
  extractJsonBlock,
  finishOperation,
  route,
  schema,
  spentTodayUsd,
  startOperation,
  type AgentRunResult,
  type AgentRuntime,
  type Config,
  type Db,
  type GateVerdict,
  type Persona,
  type PlacementPolicy,
  type RuntimeKind,
} from "@hephaestus/core";
import { LABELS, type GitHubAdapter, type Issue } from "../github.js";

export interface HelloDeps {
  db: Db;
  github: GitHubAdapter;
  runtimes: Partial<Record<RuntimeKind, AgentRuntime>>;
  persona: Persona;
  policy: PlacementPolicy;
  config: Config;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface HelloJob {
  repo: string;
  issue: Issue;
}

/** Max attempts before the router hands the story to a human (two per tier, Haiku..Opus). */
const MAX_ATTEMPTS = 6;

export async function runHello(deps: HelloDeps, job: HelloJob): Promise<void> {
  const { db, github, persona, config, log } = deps;
  const { repo, issue } = job;
  const storyRef = `github:${repo}#${issue.number}`;

  // Budget guard runs in code, before any spend.
  const spent = await spentTodayUsd(db);
  if (spent >= config.HEPH_DAILY_BUDGET_USD) {
    log("daily budget reached; leaving story queued", { storyRef, spent });
    return;
  }

  const story = await upsertStory(db, repo, issue);
  const [run] = await db
    .insert(schema.workflowRuns)
    .values({ storyId: story.id, workflow: "hello", stage: "build", status: "running" })
    .returning();
  if (!run) throw new Error("failed to create workflow run");

  await github.setLabels(repo, issue.number, [LABELS.inProgress]);
  const ctx = await github.repoContext(repo);

  let feedback: string[] = [];
  let parentOperationId: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const decision = route({ category: persona.category, attempt, defaultTierOverride: persona.defaultTier });
    if (decision.kind === "needs_decision") break;

    const placement = await placeOperation(deps, repo);
    if (placement.kind === "wait") {
      log("operation waiting for placement", { storyRef, reason: placement.reason });
      await github.setLabels(repo, issue.number, [], [LABELS.inProgress]);
      await db.update(schema.workflowRuns).set({ status: "queued" }).where(eq(schema.workflowRuns.id, run.id));
      return;
    }
    const runtime = deps.runtimes[placement.runtime];
    if (!runtime) throw new Error(`runtime ${placement.runtime} is not configured`);

    const startedAt = new Date();
    const operationId = await startOperation(db, {
      workflowRunId: run.id,
      storyRef,
      repo,
      persona: persona.name,
      category: persona.category,
      description: `hello: propose change for #${issue.number} "${issue.title.slice(0, 80)}"`,
      model: decision.model,
      tier: decision.tier,
      runtime: placement.runtime,
      attempt,
      escalationLevel: decision.escalationLevel,
      parentOperationId,
    });
    parentOperationId = operationId;
    log("operation started", { operationId, model: decision.model, runtime: placement.runtime, attempt });

    let result: AgentRunResult | undefined;
    try {
      result = await runtime.run({
        operationId,
        persona: persona.name,
        model: decision.model,
        systemPrompt: persona.system,
        prompt: buildPrompt(issue, ctx, feedback),
        maxTurns: persona.maxTurns,
        budgetUsd: persona.budgetUsd,
        allowedTools: persona.tools,
        timeoutMs: persona.timeoutSeconds * 1000,
      });
    } catch (err) {
      await finishOperation(db, { id: operationId, model: decision.model, startedAt, status: "failed_error", error: String(err) });
      feedback = [`The previous attempt crashed: ${String(err).slice(0, 500)}`];
      continue;
    }

    // Gate: structured output parses, then claims match evidence.
    const verdict = evaluate(persona, result);
    const passed = verdict.passed;
    await finishOperation(db, {
      id: operationId,
      model: decision.model,
      startedAt,
      result,
      verdict,
      status: passed ? "succeeded" : "failed_gate",
    });
    log("operation finished", { operationId, passed, findings: verdict.findings });

    if (!passed) {
      feedback = verdict.findings;
      continue;
    }

    const proposal = ChangeProposalSchema.parse(extractJsonBlock(result.finalText));
    const branch = `factory/issue-${issue.number}`;
    const sha = await github.commitToBranch(
      repo,
      branch,
      proposal.files,
      `hello: ${issue.title}\n\nCloses #${issue.number}\nOperation: ${operationId}`,
    );
    const ops = await db.select().from(schema.operations).where(eq(schema.operations.workflowRunId, run.id));
    const totalCost = ops.reduce((s, o) => s + Number(o.costUsd), 0);
    const pr = await github.openDraftPr(
      repo,
      branch,
      `[factory] ${issue.title}`,
      [
        proposal.summary,
        "",
        `Closes #${issue.number}`,
        "",
        "| Operations | Final model | Total cost |",
        "| --- | --- | --- |",
        `| ${ops.length} | ${decision.model} | $${totalCost.toFixed(4)} |`,
        "",
        "_Opened by Hephaestus (Phase 0 hello persona). Draft: a human merges._",
      ].join("\n"),
    );
    await db
      .update(schema.operations)
      .set({ artifacts: { commit: sha, branch, pr: pr.number } })
      .where(eq(schema.operations.id, operationId));
    await db
      .update(schema.workflowRuns)
      .set({ status: "succeeded", stage: "pr_open", endedAt: new Date(), checkpoint: { pr: pr.number, sha } })
      .where(eq(schema.workflowRuns.id, run.id));
    await github.setLabels(repo, issue.number, [LABELS.done], [LABELS.inProgress]);
    await github.comment(repo, issue.number, `Draft PR opened: ${pr.url} (${ops.length} operation(s), $${totalCost.toFixed(4)}).`);
    return;
  }

  // Out of attempts: raise a Decision Request instead of spending more.
  const [dr] = await db
    .insert(schema.decisionRequests)
    .values({
      storyRef,
      workflowRunId: run.id,
      raisedByOperationId: parentOperationId,
      type: "escalation_cap",
      question: `Hello persona failed ${MAX_ATTEMPTS} attempts on #${issue.number}. How should we proceed?`,
      context: { lastFindings: feedback },
      options: [
        { key: "A", label: "Approve one Fable attempt" },
        { key: "B", label: "Re-scope or split the issue" },
        { key: "C", label: "Hand to a human engineer" },
      ],
      recommendation: "B",
    })
    .returning();
  await db.update(schema.workflowRuns).set({ status: "blocked" }).where(eq(schema.workflowRuns.id, run.id));
  await github.setLabels(repo, issue.number, [LABELS.blocked], [LABELS.inProgress]);
  await github.comment(
    repo,
    issue.number,
    `Hephaestus is blocked on this issue and needs a decision (${dr?.id}). Last findings:\n${feedback.map((f) => `- ${f}`).join("\n")}`,
  );
}

function evaluate(persona: Persona, result: AgentRunResult): GateVerdict {
  const schemaForPersona = OUTPUT_SCHEMAS[persona.output as keyof typeof OUTPUT_SCHEMAS];
  if (!schemaForPersona) return { gate: "G0-schema", passed: false, findings: [`unknown output schema ${persona.output}`] };
  const raw = extractJsonBlock(result.finalText);
  if (raw === null) {
    return { gate: "G0-schema", passed: false, findings: [`no parseable json block in final message (stop: ${result.stopReason})`] };
  }
  const parsed = schemaForPersona.safeParse(raw);
  if (!parsed.success) {
    return { gate: "G0-schema", passed: false, findings: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  return claimVsEvidenceGate(parsed.data, { protectedPaths: [".github"] });
}

async function placeOperation(deps: HelloDeps, repo: string) {
  const local = deps.runtimes.local;
  return choosePlacement(
    deps.policy,
    { persona: deps.persona.name, repo },
    {
      localAvailable: local ? await local.available() : false,
      // Phase 0 does not re-queue; a full fallback wait is configured but treated as elapsed.
      waitedSeconds: deps.config.HEPH_MAX_LOCAL_WAIT_SECONDS,
      maxLocalWaitSeconds: deps.config.HEPH_MAX_LOCAL_WAIT_SECONDS,
    },
  );
}

function buildPrompt(issue: Issue, ctx: { readme: string; files: string[] }, feedback: string[]): string {
  return [
    "## Issue",
    `#${issue.number}: ${issue.title}`,
    "",
    "<issue_body>",
    issue.body || "(no description)",
    "</issue_body>",
    "",
    "## Repository files (top 300)",
    ctx.files.join("\n"),
    "",
    "## README (truncated)",
    "<readme>",
    ctx.readme || "(none)",
    "</readme>",
    ...(feedback.length
      ? ["", "## Your previous attempt was rejected. Fix these findings:", ...feedback.map((f) => `- ${f}`)]
      : []),
  ].join("\n");
}

async function upsertStory(db: Db, repo: string, issue: Issue) {
  const ref = `github:${repo}#${issue.number}`;
  const [row] = await db
    .insert(schema.stories)
    .values({ ref, repo, number: issue.number, title: issue.title, body: issue.body, labels: issue.labels, approved: true })
    .onConflictDoUpdate({
      target: schema.stories.ref,
      set: { title: issue.title, body: issue.body, labels: issue.labels, approved: true, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("failed to upsert story");
  return row;
}
