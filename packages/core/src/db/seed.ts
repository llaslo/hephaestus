import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { modelPricing } from "./schema.js";
import { PRICING_SEED } from "../pricing-seed.js";

config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../../../.env.local") });

const db = createDb(process.env.DATABASE_URL ?? "postgres://hephaestus:hephaestus@127.0.0.1:5432/hephaestus");

let added = 0;
for (const p of PRICING_SEED) {
  const existing = await db
    .select({ id: modelPricing.id })
    .from(modelPricing)
    .where(and(eq(modelPricing.model, p.model), eq(modelPricing.effectiveFrom, p.effectiveFrom)));
  if (existing.length) continue;
  await db.insert(modelPricing).values({
    model: p.model,
    effectiveFrom: p.effectiveFrom,
    inputPerMTok: String(p.inputPerMTok),
    outputPerMTok: String(p.outputPerMTok),
    cacheReadPerMTok: String(p.cacheReadPerMTok),
    cacheWrite5mPerMTok: String(p.cacheWrite5mPerMTok),
    cacheWrite1hPerMTok: String(p.cacheWrite1hPerMTok),
    longContextThreshold: p.longContextThreshold ?? null,
    longContextMultiplier: p.longContextMultiplier == null ? null : String(p.longContextMultiplier),
    source: p.source,
  });
  added++;
}
console.log(`Pricing seed: ${added} row(s) added.`);
process.exit(0);
