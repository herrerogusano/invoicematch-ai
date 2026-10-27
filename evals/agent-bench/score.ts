/**
 * Pure scoring for the agent benchmark. One "run" is one case executed once through the real
 * workflow; scores compare what the workflow kept (selected PO and line mapping) with the label.
 */

export type Outcome = "correct_pick" | "correct_abstain" | "wrong_pick" | "over_abstain" | "fixed_po" | "error";

export interface Expected {
  poNumber: string | null;
  lines: Record<string, string | null>;
}

export interface Actual {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  poNumber: string | null;
  /** invoice line id -> PO line id (null when unmapped). */
  lines: Record<string, string | null>;
}

export interface RunScore {
  outcome: Outcome;
  /** null for fixed-PO cases, where the PO is not the agent's choice. */
  poCorrect: boolean | null;
  wrongPick: boolean;
  tp: number;
  fp: number;
  fn: number;
  lineF1: number;
  /** Selected PO (or fixed PO) right and every invoice line mapped exactly as labeled. */
  exact: boolean;
}

/** The workflow rejects a PO outside the verified candidate set; that is a wrong pick, not an outage. */
export function isInvalidSelection(a: Actual): boolean {
  return a.status === "FAILED" && a.errorCode === "AGENT_INVALID_OUTPUT" && /outside the verified candidate set/.test(a.errorMessage ?? "");
}

export function f1(tp: number, fp: number, fn: number): number {
  if (tp === 0 && fp === 0 && fn === 0) return 1;
  return tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
}

export function scoreRun(expected: Expected, fixedPo: boolean, actual: Actual): RunScore {
  const failed = actual.status === "FAILED";
  const invalidPick = isInvalidSelection(actual);
  const actualLines = failed ? {} : actual.lines;

  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const [inv, target] of Object.entries(expected.lines)) {
    const got = actualLines[inv] ?? null;
    if (target !== null && got === target) tp++;
    else {
      if (target !== null) fn++;
      if (got !== null) fp++;
    }
  }
  const exactLines = !failed && Object.entries(expected.lines).every(([inv, target]) => (actualLines[inv] ?? null) === target);

  let outcome: Outcome;
  let poCorrect: boolean | null;
  if (fixedPo) {
    outcome = failed ? "error" : "fixed_po";
    poCorrect = null;
  } else if (invalidPick) {
    outcome = "wrong_pick";
    poCorrect = false;
  } else if (failed) {
    outcome = "error";
    poCorrect = false;
  } else if (actual.poNumber === expected.poNumber) {
    outcome = expected.poNumber === null ? "correct_abstain" : "correct_pick";
    poCorrect = true;
  } else if (actual.poNumber === null) {
    outcome = "over_abstain";
    poCorrect = false;
  } else {
    outcome = "wrong_pick";
    poCorrect = false;
  }
  return {
    outcome,
    poCorrect,
    wrongPick: outcome === "wrong_pick",
    tp,
    fp,
    fn,
    lineF1: f1(tp, fp, fn),
    exact: (poCorrect ?? !failed) && exactLines,
  };
}

/** Stable signature of what a run decided, used to measure agreement across repetitions. */
export function decisionSignature(actual: Actual): string {
  if (isInvalidSelection(actual)) return "INVALID_PICK";
  if (actual.status === "FAILED") return `ERROR:${actual.errorCode ?? "?"}`;
  const lines = Object.keys(actual.lines)
    .sort()
    .map((k) => `${k}=${actual.lines[k] ?? "-"}`)
    .join(",");
  return `${actual.poNumber ?? "NONE"}|${lines}`;
}

/** Share of repetitions that agree with the most frequent decision (1 = fully consistent). */
export function agreement(signatures: string[]): number {
  if (signatures.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const s of signatures) counts.set(s, (counts.get(s) ?? 0) + 1);
  return Math.max(...counts.values()) / signatures.length;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export interface RunRow {
  caseId: string;
  split: string;
  category: string;
  fixedPo: boolean;
  rep: number;
  score: RunScore;
  signature: string;
  confidence: string | null;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  costUsd: number;
  latencyMs: number;
}

export interface Aggregate {
  runs: number;
  cases: number;
  poRuns: number;
  poAccuracy: number;
  wrongPickRate: number;
  overAbstainRate: number;
  errorRate: number;
  highConfidenceWrongPicks: number;
  lineP: number;
  lineR: number;
  lineF1: number;
  exactRate: number;
  meanAgreement: number;
  stableCases: number;
  costUsd: number;
  costPerRunUsd: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

export function aggregate(rows: RunRow[]): Aggregate {
  const po = rows.filter((r) => !r.fixedPo);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const tp = sum(rows.map((r) => r.score.tp));
  const fp = sum(rows.map((r) => r.score.fp));
  const fn = sum(rows.map((r) => r.score.fn));
  const byCase = new Map<string, string[]>();
  for (const r of rows) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r.signature]);
  const agreements = [...byCase.values()].map(agreement);
  const cost = sum(rows.map((r) => r.costUsd));
  return {
    runs: rows.length,
    cases: byCase.size,
    poRuns: po.length,
    poAccuracy: ratio(po.filter((r) => r.score.poCorrect).length, po.length),
    wrongPickRate: ratio(po.filter((r) => r.score.wrongPick).length, po.length),
    overAbstainRate: ratio(po.filter((r) => r.score.outcome === "over_abstain").length, po.length),
    errorRate: ratio(rows.filter((r) => r.score.outcome === "error").length, rows.length),
    highConfidenceWrongPicks: po.filter((r) => r.score.wrongPick && r.confidence === "HIGH").length,
    lineP: ratio(tp, tp + fp),
    lineR: ratio(tp, tp + fn),
    lineF1: f1(tp, fp, fn),
    exactRate: ratio(rows.filter((r) => r.score.exact).length, rows.length),
    meanAgreement: ratio(sum(agreements), agreements.length),
    stableCases: agreements.filter((a) => a === 1).length,
    costUsd: cost,
    costPerRunUsd: ratio(cost, rows.length),
    meanInputTokens: ratio(sum(rows.map((r) => r.inputTokens)), rows.length),
    meanOutputTokens: ratio(sum(rows.map((r) => r.outputTokens)), rows.length),
    latencyP50Ms: percentile(rows.map((r) => r.latencyMs), 50),
    latencyP95Ms: percentile(rows.map((r) => r.latencyMs), 95),
  };
}
