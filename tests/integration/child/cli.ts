/**
 * Tiny CLI run as a separate Node process by restart.test.ts. Each invocation is a fresh process
 * with no in-memory state: it can only continue a workflow through the Postgres snapshot.
 *
 *   start  <scenarioId> <idempotencyKey>
 *   decide <reconciliationId> <APPROVE|REJECT> <idempotencyKey> <reason...>
 */
import { getScenario } from "@/fixtures";
import { closePool } from "@/db/pool";
import { closeMastraStorage } from "@/mastra/storage";
import { decideReview, startReconciliation } from "@/server/reconciliation-service";

const [cmd, ...args] = process.argv.slice(2);
process.env.AGENT_MODE = "mock";

async function main(): Promise<unknown> {
  if (cmd === "start") {
    const s = getScenario(args[0]!);
    if (!s) throw new Error("unknown scenario");
    return startReconciliation({ invoice: s.invoice, scenarioId: s.id, idempotencyKey: args[1]!, requestedBy: `pid-${process.pid}` });
  }
  if (cmd === "decide") {
    const [id, decision, key, ...reason] = args;
    return decideReview(id!, { decision: decision as "APPROVE" | "REJECT", reason: reason.join(" "), idempotencyKey: key! }, `owner-pid-${process.pid}@example.com`);
  }
  throw new Error(`unknown command ${cmd}`);
}

main()
  .then((out) => process.stdout.write(JSON.stringify({ pid: process.pid, out }) + "\n"))
  .catch((err) => {
    process.stdout.write(JSON.stringify({ pid: process.pid, error: (err as Error).message }) + "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMastraStorage();
    await closePool();
  });
