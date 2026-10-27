import { describe, expect, it } from "vitest";
import { benchCases, benchCatalog, validateLabels } from "@/fixtures/agent-bench";
import { agreement, aggregate, decisionSignature, scoreRun, type Actual, type RunRow } from "../../evals/agent-bench/score";

const ok = (poNumber: string | null, lines: Record<string, string | null>): Actual => ({ status: "REVIEW_REQUIRED", errorCode: null, errorMessage: null, poNumber, lines });
const expected = { poNumber: "PO-1", lines: { "1": "L1", "2": "L2", "3": null } };

describe("agent bench fixtures", () => {
  it("has a balanced, fully labeled set of cases", () => {
    expect(benchCases.length).toBeGreaterThanOrEqual(30);
    expect(benchCases.filter((c) => c.split === "dev").length).toBe(benchCases.filter((c) => c.split === "test").length);
    for (const c of benchCases) {
      expect(c.invoice.lines.every((l) => l.sku === null)).toBe(true);
      expect(Object.keys(c.expected.lines).sort()).toEqual(c.invoice.lines.map((l) => l.lineId).sort());
    }
  });

  it("rejects labels that point outside the supplier's open POs", () => {
    const raw = { id: "B99-x", split: "dev" as const, category: "search" as const, summary: "", expected: { poNumber: "PO-K-099", lines: { "1": "K099-L1" } },
      invoice: { supplierCode: "SUP-KITE", poReference: null, currency: "EUR" as const, lines: [{ lineId: "1", description: "x", quantity: "1", unitPrice: "1.00", taxRate: "0.21" }] } };
    expect(() => validateLabels([raw], benchCatalog)).toThrow(/OPEN PO/);
    expect(() => validateLabels([{ ...raw, expected: { poNumber: "PO-K-101", lines: { "1": "K102-L1" } } }], benchCatalog)).toThrow(/not a line/);
  });
});

describe("agent bench scoring", () => {
  it("scores a correct pick with exact lines", () => {
    const s = scoreRun(expected, false, ok("PO-1", { "1": "L1", "2": "L2", "3": null }));
    expect(s).toMatchObject({ outcome: "correct_pick", poCorrect: true, wrongPick: false, tp: 2, fp: 0, fn: 0, lineF1: 1, exact: true });
  });

  it("separates wrong picks, over-abstention and correct abstention", () => {
    expect(scoreRun(expected, false, ok("PO-2", { "1": "X1" })).outcome).toBe("wrong_pick");
    expect(scoreRun(expected, false, ok(null, {})).outcome).toBe("over_abstain");
    expect(scoreRun({ poNumber: null, lines: { "1": null } }, false, ok(null, { "1": null }))).toMatchObject({ outcome: "correct_abstain", exact: true, lineF1: 1 });
  });

  it("counts a PO rejected by the workflow as a wrong pick, other failures as errors", () => {
    const invalid: Actual = { status: "FAILED", errorCode: "AGENT_INVALID_OUTPUT", errorMessage: "agent selected a purchase order outside the verified candidate set", poNumber: null, lines: {} };
    expect(scoreRun(expected, false, invalid)).toMatchObject({ outcome: "wrong_pick", wrongPick: true, fn: 2 });
    const outage: Actual = { ...invalid, errorCode: "MODEL_UNAVAILABLE", errorMessage: "529" };
    expect(scoreRun(expected, false, outage)).toMatchObject({ outcome: "error", wrongPick: false });
    expect(decisionSignature(invalid)).toBe("INVALID_PICK");
  });

  it("scores line mapping on fixed-PO cases without a PO verdict", () => {
    const s = scoreRun(expected, true, ok("PO-1", { "1": "L2", "2": "L1", "3": null }));
    expect(s).toMatchObject({ outcome: "fixed_po", poCorrect: null, tp: 0, fp: 2, fn: 2, exact: false });
  });

  it("measures agreement across repetitions and aggregates rates", () => {
    expect(agreement(["a", "a", "b", "a"])).toBe(0.75);
    const row = (caseId: string, actual: Actual, fixedPo = false): RunRow => ({
      caseId, split: "dev", category: "search", fixedPo, rep: 1, score: scoreRun(expected, fixedPo, actual), signature: decisionSignature(actual),
      confidence: "HIGH", inputTokens: 100, outputTokens: 10, requests: 2, costUsd: 0.001, latencyMs: 1000,
    });
    const a = aggregate([row("c1", ok("PO-1", { "1": "L1", "2": "L2", "3": null })), row("c1", ok("PO-2", {})), row("c2", ok("PO-1", { "1": "L1", "2": "L2" }), true)]);
    expect(a).toMatchObject({ runs: 3, cases: 2, poRuns: 2, poAccuracy: 0.5, wrongPickRate: 0.5, highConfidenceWrongPicks: 1, meanAgreement: 0.75 });
    expect(a.costUsd).toBeCloseTo(0.003);
  });
});
