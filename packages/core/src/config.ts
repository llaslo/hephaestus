import { z } from "zod";
import { RUNTIMES } from "./placement.js";

const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

export const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  MANAGED_ENVIRONMENT_ID: z.string().optional(),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().min(1),
  HEPH_REPOS: csv,
  HEPH_PINNED_REPOS: csv,
  HEPH_APPROVED_LABEL: z.string().default("factory:approved"),
  HEPH_POLL_SECONDS: z.coerce.number().int().positive().default(60),
  HEPH_DEFAULT_RUNTIME: z.enum(RUNTIMES).default("managed"),
  HEPH_MAX_LOCAL_WAIT_SECONDS: z.coerce.number().int().nonnegative().default(300),
  LOCAL_RUNNER_SLOTS: z.coerce.number().int().nonnegative().default(2),
  LOCAL_RUNNER_IMAGE: z.string().default("hephaestus-runner"),
  HEPH_DAILY_BUDGET_USD: z.coerce.number().positive().default(5),
});
export type Config = z.infer<typeof ConfigSchema>;

/** Validate env at startup; fail fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration (.env.local):\n${issues}`);
  }
  return parsed.data;
}
