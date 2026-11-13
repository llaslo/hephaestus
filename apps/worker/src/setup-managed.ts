/**
 * One-time setup for the Managed Agents runtime. Creates the base agent and a sandbox
 * environment, then prints the IDs to add to .env.local.
 *   pnpm --filter @hephaestus/worker setup:managed
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "../../../.env.local") });

const client = new Anthropic();

const agent = await client.beta.agents.create({
  name: "hephaestus-base",
  description: "Base agent for Hephaestus personas. Model, system prompt and tools are overridden per session.",
  model: "claude-haiku-5-5",
  system: "You are a Hephaestus agent. Follow the persona instructions you are given.",
  tools: [{ type: "agent_toolset_20260401", default_config: { enabled: false } }],
});

const environment = await client.beta.environments.create({
  name: "hephaestus-sandbox",
  config: {
    type: "cloud",
    // Package registries only; no general internet.
    networking: { type: "limited", allow_package_managers: true },
  },
});

console.log("\nAdd these to .env.local:\n");
console.log(`MANAGED_AGENT_ID=${agent.id}`);
console.log(`MANAGED_ENVIRONMENT_ID=${environment.id}\n`);
