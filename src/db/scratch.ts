import { Client } from "pg";
import { isLocalDatabaseUrl } from "./pool";

/**
 * Creates a fresh, throw-away database next to the local one (e.g. invoicematch_eval) and points
 * DATABASE_URL at it. Local-only: refuses any non-local server. Used by evals and integration tests
 * so they never touch demo data.
 */
export async function createScratchDatabase(name: string): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("invalid scratch database name");
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  if (!isLocalDatabaseUrl(base)) throw new Error("scratch databases are only created on a local server");
  const admin = new URL(base);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`drop database if exists ${name} with (force)`);
    await client.query(`create database ${name}`);
  } finally {
    await client.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  return process.env.DATABASE_URL;
}
