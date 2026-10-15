import { PostgresStore } from "@mastra/pg";
import { databaseUrl } from "@/db/pool";

/**
 * Mastra persists workflow snapshots (including suspended runs) in Postgres, in the dedicated
 * "mastra" schema so its tables never collide with the business tables in "app".
 * A snapshot is keyed by (workflow name, runId); app.reconciliations.workflow_run_id holds that runId.
 */
export const MASTRA_SCHEMA = "mastra";

const globalForStore = globalThis as unknown as { __invoicematchMastraStore?: PostgresStore };

export function getMastraStorage(): PostgresStore {
  if (!globalForStore.__invoicematchMastraStore) {
    globalForStore.__invoicematchMastraStore = new PostgresStore({
      id: "invoicematch-mastra-store",
      connectionString: databaseUrl(),
      schemaName: MASTRA_SCHEMA,
      max: Number(process.env.DB_POOL_MAX ?? 5),
    });
  }
  return globalForStore.__invoicematchMastraStore;
}

export async function initMastraStorage(): Promise<void> {
  await getMastraStorage().init();
}

export async function closeMastraStorage(): Promise<void> {
  const store = globalForStore.__invoicematchMastraStore;
  globalForStore.__invoicematchMastraStore = undefined;
  const closable = store as unknown as { close?: () => Promise<void> };
  if (closable?.close) await closable.close();
}
