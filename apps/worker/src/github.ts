import { readFile } from "node:fs/promises";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  htmlUrl: string;
}

export const LABELS = {
  inProgress: "factory:in-progress",
  done: "factory:done",
  blocked: "factory:blocked",
} as const;

/**
 * Everything that writes to GitHub goes through here, with short-lived App installation
 * tokens. Agents never receive GitHub credentials.
 */
export class GitHubAdapter {
  private readonly app: App;
  private readonly clients = new Map<string, Octokit>();

  private constructor(app: App) {
    this.app = app;
  }

  static async create(appId: string, privateKeyPath: string): Promise<GitHubAdapter> {
    const privateKey = await readFile(privateKeyPath, "utf8");
    return new GitHubAdapter(new App({ appId, privateKey, Octokit }));
  }

  private async client(repoFull: string): Promise<{ gh: Octokit; owner: string; repo: string }> {
    const [owner, repo] = repoFull.split("/") as [string, string];
    let gh = this.clients.get(repoFull);
    if (!gh) {
      const { data } = await this.app.octokit.request("GET /repos/{owner}/{repo}/installation", { owner, repo });
      gh = (await this.app.getInstallationOctokit(data.id)) as unknown as Octokit;
      this.clients.set(repoFull, gh);
    }
    return { gh, owner, repo };
  }

  /** Open issues carrying the approval label and not already being worked. */
  async approvedIssues(repoFull: string, approvedLabel: string): Promise<Issue[]> {
    const { gh, owner, repo } = await this.client(repoFull);
    const { data } = await gh.rest.issues.listForRepo({ owner, repo, state: "open", labels: approvedLabel, per_page: 50 });
    return data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body ?? "",
        labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
        htmlUrl: i.html_url,
      }))
      .filter((i) => !i.labels.some((l) => l === LABELS.inProgress || l === LABELS.done || l === LABELS.blocked));
  }

  /** Small, read-only context for Phase 0 prompts: README and the top-level file list. */
  async repoContext(repoFull: string): Promise<{ defaultBranch: string; readme: string; files: string[] }> {
    const { gh, owner, repo } = await this.client(repoFull);
    const { data: r } = await gh.rest.repos.get({ owner, repo });
    const { data: tree } = await gh.rest.git.getTree({ owner, repo, tree_sha: r.default_branch, recursive: "true" });
    const files = tree.tree.filter((t) => t.type === "blob" && t.path).map((t) => t.path!).slice(0, 300);
    let readme = "";
    try {
      const { data } = await gh.rest.repos.getReadme({ owner, repo });
      readme = Buffer.from((data as { content: string }).content, "base64").toString("utf8").slice(0, 8000);
    } catch {
      /* no README */
    }
    return { defaultBranch: r.default_branch, readme, files };
  }

  async setLabels(repoFull: string, issue: number, add: string[], remove: string[] = []): Promise<void> {
    const { gh, owner, repo } = await this.client(repoFull);
    if (add.length) await gh.rest.issues.addLabels({ owner, repo, issue_number: issue, labels: add });
    for (const name of remove) {
      await gh.rest.issues.removeLabel({ owner, repo, issue_number: issue, name }).catch(() => undefined);
    }
  }

  async comment(repoFull: string, issue: number, body: string): Promise<void> {
    const { gh, owner, repo } = await this.client(repoFull);
    await gh.rest.issues.createComment({ owner, repo, issue_number: issue, body });
  }

  /** Commit files to a new factory/* branch off the default branch, in one commit. */
  async commitToBranch(
    repoFull: string,
    branch: string,
    files: { path: string; content: string }[],
    message: string,
  ): Promise<string> {
    if (!branch.startsWith("factory/")) throw new Error("agents may only write factory/* branches");
    const { gh, owner, repo } = await this.client(repoFull);
    const { data: r } = await gh.rest.repos.get({ owner, repo });
    const { data: baseRef } = await gh.rest.git.getRef({ owner, repo, ref: `heads/${r.default_branch}` });
    const baseSha = baseRef.object.sha;
    const { data: baseCommit } = await gh.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
    const { data: tree } = await gh.rest.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: "100644" as const, type: "blob" as const, content: f.content })),
    });
    const { data: commit } = await gh.rest.git.createCommit({ owner, repo, message, tree: tree.sha, parents: [baseSha] });
    try {
      await gh.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.sha });
    } catch {
      await gh.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.sha, force: true });
    }
    return commit.sha;
  }

  async openDraftPr(repoFull: string, branch: string, title: string, body: string): Promise<{ number: number; url: string }> {
    const { gh, owner, repo } = await this.client(repoFull);
    const { data: r } = await gh.rest.repos.get({ owner, repo });
    const existing = await gh.rest.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open" });
    if (existing.data[0]) return { number: existing.data[0].number, url: existing.data[0].html_url };
    const { data } = await gh.rest.pulls.create({ owner, repo, head: branch, base: r.default_branch, title, body, draft: true });
    return { number: data.number, url: data.html_url };
  }
}
