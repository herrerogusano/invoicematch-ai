import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "@/db/pool";
import { getReconciliationDetail, getSupplierByCode } from "@/db/repository";
import { lookupPurchaseOrders, getSupplierAndOrderDetails, TOOL_SCOPE_KEY } from "@/mastra/tools";
import { RequestContext } from "@mastra/core/request-context";
import {
  decideReview,
  recoverPendingResumes,
  ServiceError,
  startReconciliation,
} from "@/server/reconciliation-service";
import { count, scenario, setupScratch, snapshotStatus, teardownScratch } from "./setup";

beforeAll(async () => {
  await setupScratch("invoicematch_test_workflow");
});
afterAll(teardownScratch);

const start = (id: string, key: string) =>
  startReconciliation({ invoice: scenario(id).invoice, scenarioId: id, idempotencyKey: key, requestedBy: "test" });

describe("reconciliation workflow (real Mastra workflow + Postgres, mock model)", () => {
  it("exact match is MATCHED, finalized automatically, no approval needed", async () => {
    const r = await start("S01-exact-match", "wf-test-s01");
    expect(r.status).toBe("MATCHED");
    const d = (await getReconciliationDetail(r.reconciliationId))!;
    expect(d.decision).toBeNull();
    expect(d.finalizedAt).not.toBeNull();
    expect(d.result!.findings).toEqual([]);
    expect(d.result!.lines.every((l) => l.subtotalDelta === "0.00")).toBe(true);
    expect(d.events.map((e) => e.eventType)).toEqual(["CREATED", "AGENT_STEP", "RECONCILED", "FINALIZED"]);
    expect(await snapshotStatus(d.workflowRunId)).toBe("success");
  });

  it("quantity mismatch persists a precise finding and a suspended Mastra snapshot", async () => {
    const r = await start("S02-quantity-mismatch", "wf-test-s02");
    expect(r.status).toBe("REVIEW_REQUIRED");
    const d = (await getReconciliationDetail(r.reconciliationId))!;
    const f = d.result!.findings.find((x) => x.ruleId === "LINE_QUANTITY_MISMATCH")!;
    expect(f).toMatchObject({ invoiceRef: { lineId: "2" }, poRef: { lineId: "PO-1001-L2" }, actual: "5", expected: "4", delta: "1" });
    expect(d.result!.findings.find((x) => x.ruleId === "TOTAL_VS_PO_MISMATCH")!.delta).toBe("108.78");
    expect(await snapshotStatus(d.workflowRunId)).toBe("suspended");
    expect(d.events.at(-1)!.eventType).toBe("SUSPENDED_FOR_REVIEW");
  });

  it("the same idempotency key never creates a second invoice, run or decision", async () => {
    const a = await start("S03-unit-price-mismatch", "wf-test-s03");
    const b = await start("S03-unit-price-mismatch", "wf-test-s03");
    expect(b).toEqual({ reconciliationId: a.reconciliationId, status: a.status, deduplicated: true });
    expect(await count("select count(*) as n from app.invoices where invoice_number = 'INV-N-0001'")).toBe(1);
    expect(await count("select count(*) as n from app.reconciliations where idempotency_key = 'wf-test-s03'")).toBe(1);
  });

  it("concurrent starts with the same key still produce one reconciliation", async () => {
    const results = await Promise.all([1, 2, 3].map(() => start("S04-missing-line", "wf-test-s04-race")));
    expect(new Set(results.map((r) => r.reconciliationId)).size).toBe(1);
    expect(await count("select count(*) as n from app.invoices where invoice_number = 'INV-N-0002'")).toBe(1);
  });

  it("an invoice submitted twice (new key) is flagged as duplicate, not silently accepted", async () => {
    const again = await start("S03-unit-price-mismatch", "wf-test-s03-second-submission");
    const d = (await getReconciliationDetail(again.reconciliationId))!;
    expect(d.status).toBe("REVIEW_REQUIRED");
    expect(d.result!.findings.map((f) => f.ruleId)).toContain("DUPLICATE_INVOICE");
  });

  it("concurrent review actions yield exactly one terminal decision", async () => {
    const r = await start("S09-incorrect-tax", "wf-test-s09");
    const attempts = await Promise.allSettled(
      ["APPROVE", "REJECT", "APPROVE", "REJECT", "APPROVE"].map((decision, i) =>
        decideReview(
          r.reconciliationId,
          { decision: decision as "APPROVE" | "REJECT", reason: `concurrent attempt ${i}`, idempotencyKey: `wf-test-s09-decision-${i}` },
          `reviewer-${i}@example.com`,
        ),
      ),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rejected.every((a) => (a.reason as ServiceError).code === "ALREADY_DECIDED")).toBe(true);
    const winner = (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof decideReview>>>).value;
    const d = (await getReconciliationDetail(r.reconciliationId))!;
    expect(d.status).toBe(winner.status);
    expect(["APPROVED_WITH_EXCEPTION", "REJECTED"]).toContain(d.status);
    expect(d.decision!.resumeStatus).toBe("RESUMED");
    expect(await count("select count(*) as n from app.review_decisions where reconciliation_id = $1", [r.reconciliationId])).toBe(1);
    expect(d.events.filter((e) => e.eventType === "FINALIZED")).toHaveLength(1);
    expect(await snapshotStatus(d.workflowRunId)).toBe("success");

    // Replaying the winning request is idempotent and adds nothing.
    const eventsBefore = d.events.length;
    const winnerIndex = attempts.findIndex((a) => a.status === "fulfilled");
    const replay = await decideReview(
      r.reconciliationId,
      { decision: winner.status === "REJECTED" ? "REJECT" : "APPROVE", reason: `concurrent attempt ${winnerIndex}`, idempotencyKey: `wf-test-s09-decision-${winnerIndex}` },
      `reviewer-${winnerIndex}@example.com`,
    );
    expect(replay.replayed).toBe(true);
    expect((await getReconciliationDetail(r.reconciliationId))!.events).toHaveLength(eventsBefore);
  });

  it("refuses decisions on reconciliations that are not awaiting review", async () => {
    const r = await start("S01-exact-match", "wf-test-s01-b"); // duplicate of S01 → REVIEW_REQUIRED, so use the first MATCHED one
    const { rows } = await getPool().query("select id from app.reconciliations where idempotency_key = 'wf-test-s01'");
    await expect(
      decideReview(rows[0].id, { decision: "APPROVE", reason: "should not be possible", idempotencyKey: "wf-matched-decision" }, "x@example.com"),
    ).rejects.toMatchObject({ code: "NOT_PENDING_REVIEW", httpStatus: 409 });
    expect(r.status).toBe("REVIEW_REQUIRED");
  });

  it("decisions and audit events are immutable at the database level", async () => {
    const { rows } = await getPool().query("select id from app.review_decisions limit 1");
    await expect(getPool().query("update app.review_decisions set reason = 'tampered' where id = $1", [rows[0].id])).rejects.toThrow(/immutable/);
    await expect(getPool().query("delete from app.review_decisions where id = $1", [rows[0].id])).rejects.toThrow(/cannot be deleted/);
    await expect(getPool().query("delete from app.reconciliation_events")).rejects.toThrow(/append-only/);
    await expect(getPool().query("update app.reconciliation_events set actor = 'x'")).rejects.toThrow(/append-only/);
  });

  it("recovers a decision whose resume never ran (crash between commit and resume)", async () => {
    const r = await start("S14-closed-po", "wf-test-s14");
    expect(r.status).toBe("REVIEW_REQUIRED");
    // Simulate: decision committed, process died before resume.
    await getPool().query(
      `insert into app.review_decisions (reconciliation_id, reviewer, decision, reason, idempotency_key)
       values ($1, 'owner@example.com', 'REJECT', 'closed PO, reject', 'wf-s14-crash')`,
      [r.reconciliationId],
    );
    const recovered = await recoverPendingResumes();
    expect(recovered).toContain(r.reconciliationId);
    const d = (await getReconciliationDetail(r.reconciliationId))!;
    expect(d.status).toBe("REJECTED");
    expect(d.decision!.resumeStatus).toBe("RESUMED");
    expect(await recoverPendingResumes()).toEqual([]);
  });

  it("no PO + two plausible POs never claims a certain match", async () => {
    const r = await start("S12-ambiguous-candidates", "wf-test-s12");
    const d = (await getReconciliationDetail(r.reconciliationId))!;
    expect(d.status).toBe("UNMATCHED");
    expect(d.purchaseOrderId).toBeNull();
    expect(d.agentInvoked).toBe(true);
    expect(d.result!.findings.map((f) => f.ruleId).sort()).toEqual(["LOW_AGENT_CONFIDENCE", "PO_AMBIGUOUS"]);
  });
});

describe("agent tools are bounded and supplier-scoped", () => {
  const ctxFor = (supplierId: string) => {
    const requestContext = new RequestContext();
    requestContext.set(TOOL_SCOPE_KEY, { supplierId, fixedPurchaseOrderId: null });
    return { requestContext } as never;
  };

  it("never returns another supplier's purchase order", async () => {
    const acme = (await getSupplierByCode("SUP-ACME"))!;
    const { rows } = await getPool().query("select id from app.purchase_orders where po_number = 'PO-2001'");
    const out = await getSupplierAndOrderDetails.execute!({ purchaseOrderId: rows[0].id }, ctxFor(acme.id));
    expect(out).toEqual({ found: false, supplier: null, purchaseOrder: null });
    const list = (await lookupPurchaseOrders.execute!({ poNumber: "PO-2001", includeClosed: true, limit: 5 }, ctxFor(acme.id))) as { candidates: unknown[] };
    expect(list.candidates).toEqual([]);
  });

  it("caps candidate lists and refuses calls without a server scope", async () => {
    const nord = (await getSupplierByCode("SUP-NORD"))!;
    const list = (await lookupPurchaseOrders.execute!({ includeClosed: true, limit: 5 }, ctxFor(nord.id))) as { candidates: unknown[] };
    expect(list.candidates.length).toBeLessThanOrEqual(5);
    await expect(lookupPurchaseOrders.execute!({ includeClosed: false, limit: 5 }, {} as never)).rejects.toThrow(/scope/);
  });
});
