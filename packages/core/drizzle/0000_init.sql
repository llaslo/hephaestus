CREATE TYPE "public"."operation_category" AS ENUM('strategic_planning', 'requirements', 'story_writing', 'architecture', 'ui_ux_design', 'test_generation', 'code_generation', 'verification', 'pr_review', 'refactor', 'release', 'triage');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('open', 'decided', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('running', 'succeeded', 'failed_gate', 'failed_error', 'cancelled', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('queued', 'running', 'blocked', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."runtime" AS ENUM('managed', 'managed_self_hosted', 'local', 'actions');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('haiku', 'sonnet', 'opus', 'fable');--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"limit_usd" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_ref" text NOT NULL,
	"workflow_run_id" uuid,
	"raised_by_operation_id" uuid,
	"type" text NOT NULL,
	"severity" text DEFAULT 'blocking' NOT NULL,
	"question" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"recommendation" text,
	"status" "decision_status" DEFAULT 'open' NOT NULL,
	"decision" text,
	"decided_by" text,
	"sla_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "model_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"input_per_mtok" numeric(12, 6) NOT NULL,
	"output_per_mtok" numeric(12, 6) NOT NULL,
	"cache_read_per_mtok" numeric(12, 6) NOT NULL,
	"cache_write_5m_per_mtok" numeric(12, 6) NOT NULL,
	"cache_write_1h_per_mtok" numeric(12, 6) NOT NULL,
	"long_context_threshold" integer,
	"long_context_multiplier" numeric(6, 3),
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_operation_id" uuid,
	"workflow_run_id" uuid,
	"story_ref" text,
	"repo" text,
	"persona" text NOT NULL,
	"category" "operation_category" NOT NULL,
	"description" text NOT NULL,
	"model" text NOT NULL,
	"tier" "tier" NOT NULL,
	"runtime" "runtime" NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"external_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"session_runtime_ms" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_5m_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_1h_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"computed_cost_usd" numeric(12, 6),
	"cost_source" text,
	"pricing_id" uuid,
	"status" "operation_status" DEFAULT 'running' NOT NULL,
	"gate" text,
	"gate_verdict" jsonb,
	"artifacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"story_points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"workflow" text NOT NULL,
	"stage" text NOT NULL,
	"status" "workflow_run_status" DEFAULT 'queued' NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "decision_requests" ADD CONSTRAINT "decision_requests_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_requests" ADD CONSTRAINT "decision_requests_raised_by_operation_id_operations_id_fk" FOREIGN KEY ("raised_by_operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_pricing_id_model_pricing_id_fk" FOREIGN KEY ("pricing_id") REFERENCES "public"."model_pricing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_pricing_model_idx" ON "model_pricing" USING btree ("model","effective_from");--> statement-breakpoint
CREATE INDEX "operations_story_idx" ON "operations" USING btree ("story_ref");--> statement-breakpoint
CREATE INDEX "operations_started_idx" ON "operations" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "operations_run_idx" ON "operations" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stories_ref_uq" ON "stories" USING btree ("ref");