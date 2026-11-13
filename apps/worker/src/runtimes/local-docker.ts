import { spawn } from "node:child_process";
import type { AgentRunResult, AgentRuntime, AgentTask } from "@hephaestus/core";

/**
 * Local runtime: runs the Claude Agent SDK inside a throwaway Docker container on this machine.
 * The container gets only the task and the API key: no host filesystem, no home directory,
 * no GitHub credentials. It is removed when the operation ends.
 */
export class LocalDockerRuntime implements AgentRuntime {
  readonly kind = "local" as const;
  private inFlight = 0;

  constructor(
    private readonly opts: { image: string; slots: number; apiKey: string; network?: string },
  ) {}

  async available(): Promise<boolean> {
    if (this.opts.slots <= 0 || this.inFlight >= this.opts.slots) return false;
    return dockerReachable();
  }

  async run(task: AgentTask): Promise<AgentRunResult> {
    this.inFlight++;
    const name = `heph-op-${task.operationId}`;
    try {
      const args = [
        "run",
        "--rm",
        "-i",
        "--name",
        name,
        "--read-only",
        "--tmpfs",
        "/tmp:rw,size=256m",
        "--tmpfs",
        "/work:rw,size=512m",
        "--memory",
        "2g",
        "--cpus",
        "2",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "-e",
        "ANTHROPIC_API_KEY",
        ...(this.opts.network ? ["--network", this.opts.network] : []),
        this.opts.image,
      ];
      const stdout = await runWithInput("docker", args, JSON.stringify(task), task.timeoutMs, {
        ...process.env,
        ANTHROPIC_API_KEY: this.opts.apiKey,
      }).catch(async (err) => {
        await runWithInput("docker", ["rm", "-f", name], "", 30_000).catch(() => undefined);
        throw err;
      });
      const line = stdout.trim().split("\n").at(-1) ?? "";
      const out = JSON.parse(line) as RunnerOutput;
      return {
        finalText: out.finalText,
        usage: out.usage,
        // The Agent SDK reports its own cost estimate; the ledger also computes one from tokens.
        providerCostUsd: undefined,
        externalId: name,
        stopReason: out.stopReason,
      };
    } finally {
      this.inFlight--;
    }
  }
}

export interface RunnerOutput {
  finalText: string;
  stopReason: string;
  sdkCostUsd?: number;
  usage: AgentRunResult["usage"];
}

async function dockerReachable(): Promise<boolean> {
  try {
    await runWithInput("docker", ["info", "--format", "{{.ServerVersion}}"], "", 5_000);
    return true;
  } catch {
    return false;
  }
}

function runWithInput(
  cmd: string,
  args: string[],
  input: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`));
    });
    child.stdin.end(input);
  });
}
