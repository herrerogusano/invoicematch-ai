import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getReconciliationDetail } from "@/db/repository";
import { setupScratch, snapshotStatus, teardownScratch } from "./setup";

const run = promisify(execFile);
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const CLI = path.resolve("tests/integration/child/cli.ts");

let databaseUrl = "";
beforeAll(async () => {
  databaseUrl = await setupScratch("invoicematch_test_restart");
});
afterAll(teardownScratch);

/** Runs the CLI in a brand-new Node process; returns its parsed JSON line and pid. */
async function child(...args: string[]) {
  // A non-zero exit (expected for refused decisions) still carries the JSON line on stdout.
  const { stdout } = await run(process.execPath, [TSX, CLI, ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "development" },
    timeout: 60_000,
  }).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? "" }));
  const line = stdout.trim().split("\n").at(-1)!;
  return JSON.parse(line) as { pid: number; out?: { reconciliationId: string; status: string }; error?: string };
}

describe("suspend in one process, resume in another (durable HITL)", () => {
  it("approve and reject are resumed by fresh processes from the Postgres snapshot", async () => {
    // Process A: start two runs that suspend, then exit.
    const a1 = await child("start", "S03-unit-price-mismatch", "restart-approve-key");
    const a2 = await child("start", "S07-wrong-currency", "restart-reject-key");
    expect(a1.out!.status).toBe("REVIEW_REQUIRED");
    expect(a2.out!.status).toBe("REVIEW_REQUIRED");
    const before = (await getReconciliationDetail(a1.out!.reconciliationId))!;
    expect(await snapshotStatus(before.workflowRunId)).toBe("suspended");

    // Processes B and C: new PIDs, no shared memory, resume via runId only.
    const b = await child("decide", a1.out!.reconciliationId, "APPROVE", "restart-approve-decision", "Price increase agreed with supplier");
    const c = await child("decide", a2.out!.reconciliationId, "REJECT", "restart-reject-decision", "Invoice must be reissued in USD");
    expect(new Set([a1.pid, a2.pid, b.pid, c.pid, process.pid]).size).toBe(5);
    expect(b.error).toBeUndefined();
    expect(c.error).toBeUndefined();

    const approved = (await getReconciliationDetail(a1.out!.reconciliationId))!;
    const rejected = (await getReconciliationDetail(a2.out!.reconciliationId))!;
    expect(approved.status).toBe("APPROVED_WITH_EXCEPTION");
    expect(rejected.status).toBe("REJECTED");
    expect(await snapshotStatus(approved.workflowRunId)).toBe("success");
    expect(await snapshotStatus(rejected.workflowRunId)).toBe("success");
    expect(approved.decision).toMatchObject({ decision: "APPROVE", reason: "Price increase agreed with supplier", resumeStatus: "RESUMED" });
    expect(approved.decision!.reviewer).toBe(`owner-pid-${b.pid}@example.com`);
    expect(approved.events.map((e) => e.eventType)).toEqual([
      "CREATED",
      "AGENT_STEP",
      "RECONCILED",
      "SUSPENDED_FOR_REVIEW",
      "DECISION_RECORDED",
      "FINALIZED",
    ]);

    // A later process cannot change the outcome.
    const late = await child("decide", a1.out!.reconciliationId, "REJECT", "restart-late-decision", "Too late to change");
    expect(late.error).toMatch(/already recorded/);
    expect((await getReconciliationDetail(a1.out!.reconciliationId))!.status).toBe("APPROVED_WITH_EXCEPTION");
  });
});
