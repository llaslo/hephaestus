import { z } from "zod";
import { OPERATION_CATEGORIES } from "./router.js";
import { TIERS } from "./models.js";
import { RUNTIMES } from "./placement.js";

/** A persona definition, stored as factory/agents/<name>.yaml. */
export const PersonaSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  category: z.enum(OPERATION_CATEGORIES),
  defaultTier: z.enum(TIERS).optional(),
  runtime: z.enum(RUNTIMES).optional(),
  maxTurns: z.number().int().positive().default(20),
  budgetUsd: z.number().positive().default(0.5),
  timeoutSeconds: z.number().int().positive().default(900),
  tools: z.array(z.string()).default([]),
  system: z.string().min(1),
  /** Name of the output schema in OUTPUT_SCHEMAS. */
  output: z.string().min(1),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** Output of the Phase 0 "hello" persona: a small change proposal. */
export const ChangeProposalSchema = z.object({
  summary: z.string().min(1).max(2000),
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), "path must be relative and inside the repo"),
        content: z.string(),
      }),
    )
    .min(1)
    .max(20),
  claims: z.object({
    filesChanged: z.array(z.string()),
    acceptanceCriteriaMet: z.array(z.string()).default([]),
  }),
});
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;

export const OUTPUT_SCHEMAS = {
  change_proposal: ChangeProposalSchema,
} as const;
export type OutputSchemaName = keyof typeof OUTPUT_SCHEMAS;

/**
 * Agents return their structured result as the LAST ```json fenced block in their final message.
 * Returns null when no block is found or the JSON does not parse.
 */
export function extractJsonBlock(text: string): unknown | null {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const last = blocks.at(-1)?.[1];
  if (last === undefined) return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}
