import type { ChangeProposal } from "./schemas.js";

export interface GateVerdict {
  gate: string;
  passed: boolean;
  findings: string[];
}

/**
 * Claim-vs-evidence check: the files an agent SAYS it changed must be exactly the files it
 * actually produced, and must stay inside the allowed paths. Deterministic, no model needed.
 */
export function claimVsEvidenceGate(
  proposal: ChangeProposal,
  opts: { allowedPathPrefixes?: string[]; protectedPaths?: string[] } = {},
): GateVerdict {
  const findings: string[] = [];
  const actual = new Set(proposal.files.map((f) => f.path));
  const claimed = new Set(proposal.claims.filesChanged);

  for (const p of claimed) if (!actual.has(p)) findings.push(`claimed but not produced: ${p}`);
  for (const p of actual) if (!claimed.has(p)) findings.push(`produced but not claimed: ${p}`);

  if (opts.allowedPathPrefixes?.length) {
    for (const p of actual) {
      if (!opts.allowedPathPrefixes.some((prefix) => p.startsWith(prefix))) {
        findings.push(`outside allowed paths: ${p}`);
      }
    }
  }
  for (const p of actual) {
    if (opts.protectedPaths?.some((prot) => p === prot || p.startsWith(`${prot}/`))) {
      findings.push(`touches protected path: ${p}`);
    }
  }
  return { gate: "G5-claims", passed: findings.length === 0, findings };
}
