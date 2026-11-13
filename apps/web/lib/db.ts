import "server-only";
import { config } from "dotenv";
import { join } from "node:path";
import { createDb, type Db } from "@hephaestus/core";

config({ path: join(process.cwd(), "../../.env.local") });

const globalForDb = globalThis as unknown as { hephDb?: Db };

/** One pool per server process, reused across hot reloads. */
export const db: Db =
  globalForDb.hephDb ??
  (globalForDb.hephDb = createDb(
    process.env.DATABASE_URL ?? "postgres://hephaestus:hephaestus@127.0.0.1:5432/hephaestus",
  ));
