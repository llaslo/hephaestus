# Hephaestus

Agentic software factory: turns business requirements into PRDs and user stories, then builds, tests, reviews and ships them with Claude agent teams. Adversarial quality gates, cheapest-capable model routing, human-in-the-loop decisions, and per-operation cost tracking.

> **Status: Phase 0 (foundations).** One "hello" persona runs the loop end to end:
> approved GitHub issue → agent → quality gate → `factory/*` branch → draft PR → ledger row with tokens and cost.
> See the [architecture doc](https://claude.ai/artifact/Sxzo4iZ399wqLDzGfkGVDL) for where this is going.

## How it fits together

```
 GitHub issue (factory:approved)
        │  polled every 60s (webhooks can't reach localhost)
        ▼
 apps/worker ── Model Router (Haiku → Sonnet → Opus; Fable only by human approval)
        │     ── Placement (managed | local | self-hosted | actions)
        ▼
 AgentRuntime ── Managed Agents session (Anthropic cloud)    ← default
              └─ Local Docker container (Claude Agent SDK)    ← opt-in
        │
        ▼
 Gates (schema, claim-vs-evidence) ──fail──► retry with findings / escalate / Decision Request
        │ pass
        ▼
 Control plane commits to factory/issue-N and opens a draft PR (agents never hold GitHub credentials)
        │
        ▼
 PostgreSQL ledger ──► apps/web (Next.js) cost and operations view
```

| Path | What it is |
| --- | --- |
| `packages/core` | Ledger schema (Drizzle + PostgreSQL), pricing and cost calculation, Model Router, placement policy, gates, persona loader |
| `apps/worker` | pg-boss worker: GitHub polling, hello flow, Managed Agents and local Docker runtimes |
| `apps/web` | Next.js operations ledger UI on `localhost:3000` |
| `packages/runner` | Agent SDK runner used inside the local container (and later on GitHub Actions runners) |
| `factory/agents/*.yaml` | Persona definitions: model tier, tools, budget, system prompt, output schema |

## Prerequisites

- Node.js 22+, pnpm 10 (`corepack enable`), Docker Desktop
- An Anthropic API key, ideally in a dedicated workspace with a spend limit
- A GitHub App installed on a **throwaway sandbox repo**, with these repository permissions:
  Contents (read/write), Issues (read/write), Pull requests (read/write), Metadata (read)

## Setup

```bash
pnpm install
cp .env.example .env.local          # fill in ANTHROPIC_API_KEY, GITHUB_APP_ID, key path, HEPH_REPOS
docker compose up -d                # PostgreSQL + Jaeger
pnpm build
pnpm db:migrate
pnpm db:seed                        # model pricing (verify the rates in packages/core/src/pricing-seed.ts)
pnpm --filter @hephaestus/worker setup:managed   # prints MANAGED_AGENT_ID / MANAGED_ENVIRONMENT_ID for .env.local
pnpm runner:build                   # optional: image for the local runtime
pnpm dev                            # worker + web on http://localhost:3000
```

Then, in the sandbox repo, open an issue such as *"Add a HELLO.md that greets contributors"* and label it `factory:approved`. Within a minute the worker picks it up, labels it `factory:in-progress`, and either opens a draft PR or labels it `factory:blocked` with a comment explaining why.

## Phase 0 exit checks

1. **Cost accuracy.** For one operation, compare the ledger's `cost_usd` (from the session's `list_cost`) with the Anthropic Console. The UI shows our own token-based calculation beside it.
2. **Guardrails.** Confirm which hooks Managed Agents enforces (protected tests, planned paths, schema on stop). Whatever it can't enforce moves to the Agent SDK runtimes.
3. **Local isolation.** Set `HEPH_DEFAULT_RUNTIME=local`, run the same issue, and confirm the container has no host mounts and is removed afterwards (`docker ps -a`).

## Design rules this code already follows

- **Usage comes from the provider**, never from the agent's own report. Managed sessions use `usage.list_cost`; local runs are priced from tokens with an effective-dated price list.
- **One operation = one ledger row**, written *before* the agent runs so crashes still leave a trace.
- **Escalation is evidence-driven.** Two attempts per tier, gate findings fed back into the retry, automatic escalation stops at Opus, and Fable needs a human decision.
- **Agents never get GitHub credentials.** The control plane writes branches and PRs with short-lived App installation tokens, and only to `factory/*` branches.
- **Untrusted input is data.** Issue text and repo content are fenced in the prompt and the persona is told not to follow instructions inside them.

## Testing

```bash
pnpm test                       # unit tests (router, placement, pricing, gates)
DATABASE_URL=... pnpm test      # also runs the hello-flow integration tests against PostgreSQL
```

## Notes

- The Claude Agent SDK (used by `packages/runner`) is distributed under Anthropic's own terms, not MIT. Hephaestus depends on it as a package and does not redistribute it.
- Managed Agents is a beta API (`managed-agents-2026-04-01`); all calls are isolated in `apps/worker/src/runtimes/managed.ts`.

## Contributing

Contributions are welcome. Please sign off your commits (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/).

## License

[MIT](LICENSE) © 2026 Peter Karaganis
