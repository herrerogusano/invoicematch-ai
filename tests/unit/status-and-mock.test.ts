import { describe, expect, it } from "vitest";
import { canTransition, STATUS_TRANSITIONS } from "@/domain/status";
import { mockDecide } from "@/mastra/mock-model";
import { extractJsonObject, parseTaskFromPrompt, renderTaskPrompt, type AgentTask } from "@/mastra/contracts";

describe("status transitions", () => {
  it("allows only the documented transitions", () => {
    expect(canTransition("PROCESSING", "MATCHED")).toBe(true);
    expect(canTransition("REVIEW_REQUIRED", "APPROVED_WITH_EXCEPTION")).toBe(true);
    expect(canTransition("UNMATCHED", "REJECTED")).toBe(true);
    expect(canTransition("MATCHED", "APPROVED_WITH_EXCEPTION")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED_WITH_EXCEPTION")).toBe(false);
    expect(canTransition("PROCESSING", "APPROVED_WITH_EXCEPTION")).toBe(false);
    for (const terminal of ["MATCHED", "APPROVED_WITH_EXCEPTION", "REJECTED", "FAILED"] as const) {
      expect(STATUS_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

const task: AgentTask = {
  invoiceNumber: "INV-X",
  supplierCode: "SUP-X",
  currency: "EUR",
  poReference: null,
  fixedPurchaseOrderId: null,
  lines: [{ lineId: "1", sku: null, description: "Sealed ball bearing 6205", quantity: "50", unitPrice: "3.40" }],
};
const poA = {
  id: "a",
  poNumber: "PO-A",
  lines: [{ lineId: "A1", description: "Ball bearing 6205-2RS sealed", quantity: "50", unitPrice: "3.40" }],
};

describe("mock agent heuristic (offline stand-in, not an LLM)", () => {
  it("returns null with LOW confidence when candidates tie", () => {
    const p = mockDecide(task, [poA, { ...poA, id: "b", poNumber: "PO-B" }]);
    expect(p.purchaseOrderId).toBeNull();
    expect(p.confidence).toBe("LOW");
    expect(p.reasons[0]).toContain("[MOCK]");
  });

  it("selects a single plausible candidate", () => {
    const p = mockDecide(task, [poA]);
    expect(p.purchaseOrderId).toBe("a");
    expect(p.lineMappings).toEqual([{ invoiceLineId: "1", poLineId: "A1" }]);
  });

  it("returns null when there are no candidates", () => {
    expect(mockDecide(task, []).purchaseOrderId).toBeNull();
  });

  it("round-trips the task through the prompt and parses fenced JSON", () => {
    expect(parseTaskFromPrompt(renderTaskPrompt(task))).toEqual(task);
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJsonObject("no json here")).toThrow();
    // Agent benchmark B19: correct answer followed by stray closing brackets.
    expect(extractJsonObject('{"a":{"b":"x}"},"c":[1]}]}')).toEqual({ a: { b: "x}" }, c: [1] });
    expect(extractJsonObject('{"q":"say \\"hi\\" {"}')).toEqual({ q: 'say "hi" {' });
    expect(() => extractJsonObject('{"a":1')).toThrow(/complete/);
  });
});
