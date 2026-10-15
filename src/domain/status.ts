import type { ReconciliationStatus } from "@/schemas/domain";

/**
 * Exact status transition table. Rendered in the UI and docs/architecture.md.
 * "APPROVED_WITH_EXCEPTION" records a human decision only; it never means money was paid.
 */
export const STATUS_TRANSITIONS: Record<ReconciliationStatus, readonly ReconciliationStatus[]> = {
  PROCESSING: ["MATCHED", "REVIEW_REQUIRED", "UNMATCHED", "FAILED"],
  MATCHED: [],
  REVIEW_REQUIRED: ["APPROVED_WITH_EXCEPTION", "REJECTED"],
  UNMATCHED: ["APPROVED_WITH_EXCEPTION", "REJECTED"],
  APPROVED_WITH_EXCEPTION: [],
  REJECTED: [],
  FAILED: [],
};

export const STATUS_DESCRIPTIONS: Record<ReconciliationStatus, string> = {
  PROCESSING: "Workflow is running (technical, transient).",
  MATCHED: "All material comparisons passed; finalized automatically without review.",
  REVIEW_REQUIRED: "Mismatch, ambiguity, weak semantic mapping or arithmetic disagreement; awaiting owner review.",
  UNMATCHED: "No valid purchase order could be associated; awaiting owner review.",
  APPROVED_WITH_EXCEPTION: "Owner explicitly accepted the flagged differences with a reason. No payment is made.",
  REJECTED: "Owner rejected the invoice with a reason.",
  FAILED: "Technical error (e.g. model outage); no matching result is claimed.",
};

export const PENDING_REVIEW_STATUSES: readonly ReconciliationStatus[] = ["REVIEW_REQUIRED", "UNMATCHED"];
export const TERMINAL_STATUSES: readonly ReconciliationStatus[] = [
  "MATCHED",
  "APPROVED_WITH_EXCEPTION",
  "REJECTED",
  "FAILED",
];

export function canTransition(from: ReconciliationStatus, to: ReconciliationStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ReconciliationStatus, to: ReconciliationStatus): void {
  if (!canTransition(from, to)) throw new Error(`illegal status transition ${from} → ${to}`);
}
