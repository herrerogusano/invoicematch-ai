import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "./pool";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

/** Applies migrations/*.sql in name order, each in its own transaction, recording them once. */
export async function migrate(log: (msg: string) => void = console.log): Promise<string[]> {
  const pool = getPool();
  await pool.query("create schema if not exists app");
  await pool.query(
    "create table if not exists app.schema_migrations (id text primary key, applied_at timestamptz not null default now())",
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Serialise concurrent migrators.
      await client.query("select pg_advisory_xact_lock(hashtext('invoicematch-migrations'))");
      const done = await client.query("select 1 from app.schema_migrations where id = $1", [file]);
      if (done.rowCount) {
        await client.query("commit");
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query(sql);
      await client.query("insert into app.schema_migrations (id) values ($1)", [file]);
      await client.query("commit");
      applied.push(file);
      log(`applied ${file}`);
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (!applied.length) log("migrations up to date");
  return applied;
}
