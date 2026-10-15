import { Pool, type PoolClient } from "pg";

/**
 * One pg Pool per process. On serverless (Vercel) keep DB_POOL_MAX small and point DATABASE_URL at
 * the Supabase transaction pooler; locally it is the Docker Postgres from docker-compose.yml.
 */

const globalForPool = globalThis as unknown as { __invoicematchPool?: Pool };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return url;
}

export function getPool(): Pool {
  if (!globalForPool.__invoicematchPool) {
    globalForPool.__invoicematchPool = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      application_name: "invoicematch-ai",
    });
  }
  return globalForPool.__invoicematchPool;
}

export async function closePool(): Promise<void> {
  const pool = globalForPool.__invoicematchPool;
  globalForPool.__invoicematchPool = undefined;
  if (pool) await pool.end();
}

export type Queryable = Pick<PoolClient, "query">;

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** True only for hosts that can never be a managed cloud database. Used by destructive scripts. */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(host);
  } catch {
    return false;
  }
}
