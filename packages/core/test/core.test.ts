import { describe, expect, it } from "vitest";
import {
  tokenCostUsd,
  centsStringToUsd,
  priceAt,
  sessionRuntimeCostUsd,
  route,
  choosePlacement,
  claimVsEvidenceGate,
  extractJsonBlock,
  ChangeProposalSchema,
  type PlacementPolicy,
} from "../src/index.js";
import { PRICING_SEED } from "../src/pricing-seed.js";

const haiku = PRICING_SEED.find((p) => p.model === "claude-haiku-5-5")!;
const sonnet = PRICING_SEED.find((p) => p.model === "claude-sonnet-5-5")!;

describe("pricing", () => {
  it("computes token cost per million", () => {
    const cost = tokenCostUsd(
      { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
      sonnet,
    );
    expect(cost).toBeCloseTo(2 + 1, 6);
  });

  it("applies the Haiku 5.5 long-context multiplier above 100K prompt tokens", () => {
    const usage = { inputTokens: 150_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };
    expect(tokenCostUsd(usage, haiku)).toBeCloseTo((150_000 * 0.5 + 1_000 * 2.5) / 1e6, 6);
    const short = { ...usage, inputTokens: 50_000 };
    expect(tokenCostUsd(short, haiku)).toBeCloseTo((50_000 * 0.1 + 1_000 * 0.5) / 1e6, 6);
  });

  it("converts Managed Agents cents strings", () => {
    expect(centsStringToUsd("187")).toBe(1.87);
  });

  it("charges $0.08 per session-hour", () => {
    expect(sessionRuntimeCostUsd(1800)).toBeCloseTo(0.04, 6);
  });

  it("selects the price in effect at a date", () => {
    const later = { ...sonnet, effectiveFrom: new Date("2027-01-01"), inputPerMTok: 1 };
    const prices = [sonnet, later];
    expect(priceAt(prices, sonnet.model, new Date("2026-12-01"))?.inputPerMTok).toBe(2);
    expect(priceAt(prices, sonnet.model, new Date("2027-02-01"))?.inputPerMTok).toBe(1);
    expect(priceAt(prices, sonnet.model, new Date("2020-01-01"))).toBeUndefined();
  });
});

describe("router escalation ladder", () => {
  it("uses the default tier twice, then escalates", () => {
    const tiers = [1, 2, 3, 4].map((attempt) => route({ category: "code_generation", attempt }));
    expect(tiers.map((t) => (t.kind === "run" ? t.tier : t.kind))).toEqual(["haiku", "haiku", "sonnet", "sonnet"]);
  });

  it("stops at opus and asks a human", () => {
    expect(route({ category: "code_generation", attempt: 5 })).toMatchObject({ kind: "run", tier: "opus" });
    expect(route({ category: "code_generation", attempt: 6 })).toMatchObject({ kind: "run", tier: "opus" });
    expect(route({ category: "code_generation", attempt: 7 })).toMatchObject({ kind: "needs_decision", lastTier: "opus" });
  });

  it("never reaches fable without approval", () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      const r = route({ category: "architecture", attempt });
      if (r.kind === "run") expect(r.tier).not.toBe("fable");
    }
    expect(route({ category: "architecture", attempt: 9, fableApproved: true })).toMatchObject({ tier: "fable" });
  });
});

describe("placement", () => {
  const policy: PlacementPolicy = {
    defaultRuntime: "managed",
    byPersona: { Engineer: "local" },
    byRepo: { "acme/secret": "local" },
    pinnedRepos: ["acme/secret"],
  };
  const up = { localAvailable: true, waitedSeconds: 0, maxLocalWaitSeconds: 300 };
  const down = { localAvailable: false, waitedSeconds: 0, maxLocalWaitSeconds: 300 };

  it("follows override > persona > repo > default", () => {
    expect(choosePlacement(policy, { persona: "Architect", repo: "a/b" }, up)).toMatchObject({ runtime: "managed" });
    expect(choosePlacement(policy, { persona: "Engineer", repo: "a/b" }, up)).toMatchObject({ runtime: "local" });
    expect(choosePlacement(policy, { persona: "Engineer", repo: "a/b", override: "actions" }, up)).toMatchObject({
      runtime: "actions",
    });
  });

  it("falls back to managed only after the wait", () => {
    expect(choosePlacement(policy, { persona: "Engineer", repo: "a/b" }, down)).toMatchObject({ kind: "wait" });
    expect(
      choosePlacement(policy, { persona: "Engineer", repo: "a/b" }, { ...down, waitedSeconds: 300 }),
    ).toMatchObject({ kind: "place", runtime: "managed" });
  });

  it("never sends a pinned repo to Anthropic's sandbox", () => {
    expect(choosePlacement(policy, { persona: "Architect", repo: "acme/secret" }, up)).toMatchObject({ runtime: "local" });
    expect(
      choosePlacement(policy, { persona: "Architect", repo: "acme/secret", override: "managed" }, { ...down, waitedSeconds: 9999 }),
    ).toMatchObject({ kind: "wait" });
  });
});

describe("structured output and claim-vs-evidence gate", () => {
  const text = 'Done.\n```json\n{"summary":"x","files":[{"path":"HELLO.md","content":"hi"}],"claims":{"filesChanged":["HELLO.md"]}}\n```';

  it("extracts the last json block", () => {
    const parsed = ChangeProposalSchema.parse(extractJsonBlock(text));
    expect(parsed.files[0]?.path).toBe("HELLO.md");
  });

  it("rejects paths that escape the repo", () => {
    const bad = { summary: "x", files: [{ path: "../etc/passwd", content: "" }], claims: { filesChanged: [] } };
    expect(ChangeProposalSchema.safeParse(bad).success).toBe(false);
  });

  it("fails when claims and evidence disagree", () => {
    const proposal = ChangeProposalSchema.parse(extractJsonBlock(text));
    expect(claimVsEvidenceGate(proposal).passed).toBe(true);
    const lying = { ...proposal, claims: { ...proposal.claims, filesChanged: ["HELLO.md", "src/app.ts"] } };
    expect(claimVsEvidenceGate(lying)).toMatchObject({ passed: false });
  });

  it("blocks protected paths", () => {
    const proposal = ChangeProposalSchema.parse(extractJsonBlock(text.replaceAll("HELLO.md", "tests/a.test.ts")));
    expect(claimVsEvidenceGate(proposal, { protectedPaths: ["tests"] }).passed).toBe(false);
  });
});
