import { loadLocalEnv } from "../../scripts/load-env";
import { migrate } from "@/db/migrate";
import { seed } from "@/db/seed";
import { createScratchDatabase } from "@/db/scratch";
import { closePool, getPool } from "@/db/pool";
import { initMastraStorage, closeMastraStorage } from "@/mastra/storage";
import { getScenario } from "@/fixtures";

/** Fresh local scratch database per test file; never the demo database. */
export async function setupScratch(name = "invoicematch_test"): Promise<string> {
  loadLocalEnv();
  process.env.AGENT_MODE = "mock";
  const url = await createScratchDatabase(name);
  await migrate(() => undefined);
  await initMastraStorage();
  await seed(() => undefined);
  return url;
}

export async function teardownScratch(): Promise<void> {
  await closeMastraStorage();
  await closePool();
}

export function scenario(id: string) {
  const s = getScenario(id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

export async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await getPool().query(sql, params);
  return Number(rows[0]?.n ?? 0);
}

export async function snapshotStatus(runId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    "select snapshot->>'status' as status from mastra.mastra_workflow_snapshot where run_id = $1",
    [runId],
  );
  return rows[0]?.status ?? null;
}
