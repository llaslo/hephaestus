import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { PgBoss } from "pg-boss";
import {
  createDb,
  loadConfig,
  loadPersonas,
  type AgentRuntime,
  type PlacementPolicy,
  type RuntimeKind,
} from "@hephaestus/core";
import { GitHubAdapter } from "./github.js";
import { ManagedAgentsRuntime } from "./runtimes/managed.js";
import { LocalDockerRuntime } from "./runtimes/local-docker.js";
import { runHello, type HelloJob } from "./flows/hello.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: join(root, ".env.local") });

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

async function main() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  const github = await GitHubAdapter.create(config.GITHUB_APP_ID, config.GITHUB_APP_PRIVATE_KEY_PATH);
  const personas = await loadPersonas(join(root, "factory/agents"));
  const hello = personas.get("hello");
  if (!hello) throw new Error("factory/agents/hello.yaml is missing");

  const runtimes: Partial<Record<RuntimeKind, AgentRuntime>> = {};
  const baseAgentId = process.env.MANAGED_AGENT_ID;
  if (config.MANAGED_ENVIRONMENT_ID && baseAgentId) {
    runtimes.managed = new ManagedAgentsRuntime(
      new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }),
      baseAgentId,
      config.MANAGED_ENVIRONMENT_ID,
    );
  } else {
    log("Managed Agents not configured: run `pnpm --filter @hephaestus/worker setup:managed`");
  }
  if (config.LOCAL_RUNNER_SLOTS > 0) {
    runtimes.local = new LocalDockerRuntime({
      image: config.LOCAL_RUNNER_IMAGE,
      slots: config.LOCAL_RUNNER_SLOTS,
      apiKey: config.ANTHROPIC_API_KEY,
    });
  }

  const policy: PlacementPolicy = {
    defaultRuntime: config.HEPH_DEFAULT_RUNTIME,
    byPersona: hello.runtime ? { [hello.name]: hello.runtime } : {},
    byRepo: {},
    pinnedRepos: config.HEPH_PINNED_REPOS,
  };

  const boss = new PgBoss(config.DATABASE_URL);
  boss.on("error", (err) => log("pg-boss error", { err: String(err) }));
  await boss.start();
  await boss.createQueue("poll");
  await boss.createQueue("hello");

  // Polling: GitHub cannot deliver webhooks to localhost.
  await boss.work("poll", async () => {
    for (const repo of config.HEPH_REPOS) {
      try {
        const issues = await github.approvedIssues(repo, config.HEPH_APPROVED_LABEL);
        for (const issue of issues) {
          // singletonKey: never two runs for the same issue at once.
          await boss.send("hello", { repo, issue } satisfies HelloJob, {
            singletonKey: `${repo}#${issue.number}`,
            retryLimit: 0,
          });
        }
        if (issues.length) log("enqueued approved issues", { repo, count: issues.length });
      } catch (err) {
        log("poll failed", { repo, err: String(err) });
      }
    }
  });

  await boss.work<HelloJob>("hello", async (jobs) => {
    for (const job of jobs) {
      await runHello({ db, github, runtimes, persona: hello, policy, config, log }, job.data);
    }
  });

  // Reconciler tick. pg-boss cron is minute-grained; finer polling uses a timer.
  const tick = () => boss.send("poll", {}, { singletonKey: "poll" }).catch((e) => log("poll enqueue failed", { e: String(e) }));
  await tick();
  setInterval(tick, config.HEPH_POLL_SECONDS * 1000);

  log("worker started", { repos: config.HEPH_REPOS, runtimes: Object.keys(runtimes) });

  const stop = async () => {
    log("stopping");
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
