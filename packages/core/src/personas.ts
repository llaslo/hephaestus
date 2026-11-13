import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { PersonaSchema, type Persona } from "./schemas.js";

/** Load and validate every persona in a directory (factory/agents). */
export async function loadPersonas(dir: string): Promise<Map<string, Persona>> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const personas = new Map<string, Persona>();
  for (const file of files) {
    const raw = parse(await readFile(join(dir, file), "utf8"));
    const result = PersonaSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid persona ${file}: ${result.error.message}`);
    }
    personas.set(result.data.name, result.data);
  }
  return personas;
}
