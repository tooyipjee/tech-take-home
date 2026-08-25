import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withClient } from "./pool.ts";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrate(): Promise<string[]> {
  return withClient(async (client) => {
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
    const applied = new Set(rows.map((row) => row.name));
    const pending = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();

    for (const name of pending) {
      await client.query("begin");
      try {
        await client.query(readFileSync(join(migrationsDir, name), "utf8"));
        await client.query("insert into schema_migrations (name) values ($1)", [name]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`migration ${name} failed: ${(error as Error).message}`);
      }
    }
    return pending;
  });
}
