import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const tierEnum = pgEnum("tier", ["haiku", "sonnet", "opus", "fable"]);

export const categoryEnum = pgEnum("operation_category", [
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
]);

export const runtimeEnum = pgEnum("runtime", ["managed", "managed_self_hosted", "local", "actions"]);

export const operationStatusEnum = pgEnum("operation_status", [
  "running",
  "succeeded",
  "failed_gate",
  "failed_error",
  "cancelled",
  "blocked",
]);

export const runStatusEnum = pgEnum("workflow_run_status", [
  "queued",
  "running",
  "blocked",
  "succeeded",
  "failed",
  "cancelled",
]);

export const decisionStatusEnum = pgEnum("decision_status", ["open", "decided", "withdrawn"]);

/** Mirror of a work item (GitHub issue today) the factory knows about. */
export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull(), // e.g. github:owner/repo#12
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    state: text("state").notNull().default("open"),
    approved: boolean("approved").notNull().default(false),
    storyPoints: integer("story_points"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stories_ref_uq").on(t.ref)],
);

/** One attempt to take a story through the workflow. */
export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyId: uuid("story_id").notNull().references(() => stories.id),
  workflow: text("workflow").notNull(), // e.g. "hello"
  stage: text("stage").notNull(),
  status: runStatusEnum("status").notNull().default("queued"),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

/** Effective-dated price list, USD per million tokens. */
export const modelPricing = pgTable(
  "model_pricing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    model: text("model").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    inputPerMTok: numeric("input_per_mtok", { precision: 12, scale: 6 }).notNull(),
    outputPerMTok: numeric("output_per_mtok", { precision: 12, scale: 6 }).notNull(),
    cacheReadPerMTok: numeric("cache_read_per_mtok", { precision: 12, scale: 6 }).notNull(),
    cacheWrite5mPerMTok: numeric("cache_write_5m_per_mtok", { precision: 12, scale: 6 }).notNull(),
    cacheWrite1hPerMTok: numeric("cache_write_1h_per_mtok", { precision: 12, scale: 6 }).notNull(),
    /** Prompt length above which `longContextMultiplier` applies (Haiku 5.5: 100K). Null = flat. */
    longContextThreshold: integer("long_context_threshold"),
    longContextMultiplier: numeric("long_context_multiplier", { precision: 6, scale: 3 }),
    source: text("source").notNull(),
  },
  (t) => [index("model_pricing_model_idx").on(t.model, t.effectiveFrom)],
);

/** The ledger: one row per agent invocation. */
export const operations = pgTable(
  "operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentOperationId: uuid("parent_operation_id"),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id),
    storyRef: text("story_ref"),
    repo: text("repo"),
    persona: text("persona").notNull(),
    category: categoryEnum("category").notNull(),
    description: text("description").notNull(),
    model: text("model").notNull(),
    tier: tierEnum("tier").notNull(),
    runtime: runtimeEnum("runtime").notNull(),
    attempt: integer("attempt").notNull().default(1),
    escalationLevel: integer("escalation_level").notNull().default(0),
    externalId: text("external_id"), // Managed Agents session id, container id, Actions run id
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    sessionRuntimeMs: integer("session_runtime_ms"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWrite5mTokens: integer("cache_write_5m_tokens").notNull().default(0),
    cacheWrite1hTokens: integer("cache_write_1h_tokens").notNull().default(0),
    /** Authoritative cost: provider-reported where available, else computed. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    /** Our own computation from tokens x pricing, kept for cross-checking. */
    computedCostUsd: numeric("computed_cost_usd", { precision: 12, scale: 6 }),
    costSource: text("cost_source"), // "provider" | "computed"
    pricingId: uuid("pricing_id").references(() => modelPricing.id),
    status: operationStatusEnum("status").notNull().default("running"),
    gate: text("gate"),
    gateVerdict: jsonb("gate_verdict").$type<Record<string, unknown>>(),
    artifacts: jsonb("artifacts").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
  },
  (t) => [
    index("operations_story_idx").on(t.storyRef),
    index("operations_started_idx").on(t.startedAt),
    index("operations_run_idx").on(t.workflowRunId),
  ],
);

export const decisionRequests = pgTable("decision_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyRef: text("story_ref").notNull(),
  workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id),
  raisedByOperationId: uuid("raised_by_operation_id").references(() => operations.id),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("blocking"),
  question: text("question").notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  options: jsonb("options").$type<{ key: string; label: string; impact?: string }[]>().notNull(),
  recommendation: text("recommendation"),
  status: decisionStatusEnum("status").notNull().default("open"),
  decision: text("decision"),
  decidedBy: text("decided_by"),
  slaHours: integer("sla_hours").notNull().default(24),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(), // "daily" | "repo:<owner/name>" | "story:<ref>"
  limitUsd: numeric("limit_usd", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type ModelPricing = typeof modelPricing.$inferSelect;
