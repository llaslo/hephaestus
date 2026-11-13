import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { modelPricing, operations, type NewOperation } from "./db/schema.js";
import { priceAt, tokenCostUsd, type PriceList } from "./pricing.js";
import type { AgentRunResult } from "./runtime.js";
import type { GateVerdict } from "./gates.js";

export type StartOperation = Pick<
  NewOperation,
  | "workflowRunId"
  | "storyRef"
  | "repo"
  | "persona"
  | "category"
  | "description"
  | "model"
  | "tier"
  | "runtime"
  | "attempt"
  | "escalationLevel"
  | "parentOperationId"
>;

/** Write the ledger row BEFORE the agent runs, so a crash still leaves a trace. */
export async function startOperation(db: Db, op: StartOperation): Promise<string> {
  const [row] = await db.insert(operations).values({ ...op, status: "running" }).returning({ id: operations.id });
  if (!row) throw new Error("failed to insert operation");
  return row.id;
}

async function loadPrices(db: Db): Promise<(PriceList & { id: string })[]> {
  const rows = await db.select().from(modelPricing);
  return rows.map((r) => ({
    id: r.id,
    model: r.model,
    effectiveFrom: r.effectiveFrom,
    inputPerMTok: Number(r.inputPerMTok),
    outputPerMTok: Number(r.outputPerMTok),
    cacheReadPerMTok: Number(r.cacheReadPerMTok),
    cacheWrite5mPerMTok: Number(r.cacheWrite5mPerMTok),
    cacheWrite1hPerMTok: Number(r.cacheWrite1hPerMTok),
    longContextThreshold: r.longContextThreshold,
    longContextMultiplier: r.longContextMultiplier === null ? null : Number(r.longContextMultiplier),
    source: r.source,
  }));
}

/**
 * Close the ledger row with usage from the provider (never from the agent's own report),
 * cost, and the gate's verdict. Status reflects the gate, not the agent's exit.
 */
export async function finishOperation(
  db: Db,
  args: {
    id: string;
    model: string;
    startedAt: Date;
    result?: AgentRunResult;
    verdict?: GateVerdict;
    status: "succeeded" | "failed_gate" | "failed_error" | "cancelled" | "blocked";
    artifacts?: Record<string, unknown>;
    error?: string;
  },
): Promise<void> {
  const endedAt = new Date();
  const usage = args.result?.usage;
  let computed: number | null = null;
  let pricingId: string | null = null;
  if (usage) {
    const price = priceAt(await loadPrices(db), args.model, args.startedAt);
    if (price) {
      computed = tokenCostUsd(usage, price);
      pricingId = price.id;
    }
  }
  const provider = args.result?.providerCostUsd;
  const cost = provider ?? computed ?? 0;

  await db
    .update(operations)
    .set({
      endedAt,
      durationMs: endedAt.getTime() - args.startedAt.getTime(),
      sessionRuntimeMs: args.result?.sessionRuntimeMs ?? null,
      externalId: args.result?.externalId ?? null,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWrite5mTokens: usage?.cacheWrite5mTokens ?? 0,
      cacheWrite1hTokens: usage?.cacheWrite1hTokens ?? 0,
      costUsd: cost.toFixed(6),
      computedCostUsd: computed === null ? null : computed.toFixed(6),
      costSource: provider !== undefined ? "provider" : computed !== null ? "computed" : null,
      pricingId,
      status: args.status,
      gate: args.verdict?.gate ?? null,
      gateVerdict: args.verdict ? { passed: args.verdict.passed, findings: args.verdict.findings } : null,
      artifacts: args.artifacts ?? {},
      error: args.error ?? null,
    })
    .where(eq(operations.id, args.id));
}

/** Spend since UTC midnight, for the daily budget guard. */
export async function spentTodayUsd(db: Db): Promise<number> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${operations.costUsd}), 0)` })
    .from(operations)
    .where(gte(operations.startedAt, midnight));
  return Number(row?.total ?? 0);
}

export async function recentOperations(db: Db, limit = 100) {
  return db.select().from(operations).orderBy(desc(operations.startedAt)).limit(limit);
}

export async function operationsForStory(db: Db, storyRef: string) {
  return db
    .select()
    .from(operations)
    .where(and(eq(operations.storyRef, storyRef)))
    .orderBy(desc(operations.startedAt));
}
