import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../../../.env.local") });

const url = process.env.DATABASE_URL ?? "postgres://hephaestus:hephaestus@127.0.0.1:5432/hephaestus";
const sql = postgres(url, { max: 1 });
await migrate(drizzle(sql), {
  migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "../../drizzle"),
});
await sql.end();
console.log("Migrations applied.");
