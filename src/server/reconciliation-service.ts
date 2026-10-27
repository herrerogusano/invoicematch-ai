import { randomUUID } from "node:crypto";
import { getPool, withTransaction } from "@/db/pool";
import {
  appendEvent,
  getReconciliationDetail,
  getReconciliationIdByIdempotencyKey,
  markFailed,
} from "@/db/repository";
import { PENDING_REVIEW_STATUSES } from "@/domain/status";
import { getMastra } from "@/mastra";
import { REVIEW_STEP_ID, WORKFLOW_ID } from "@/mastra/workflow";
import type { InvoicePayload, ReconciliationStatus, ReviewDecisionInput } from "@/schemas/domain";

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

export interface StartResult {
  reconciliationId: string;
  status: ReconciliationStatus;
  deduplicated: boolean;
}

async function statusOf(id: string): Promise<ReconciliationStatus> {
  const { rows } = await getPool().query("select status from app.reconciliations where id = $1", [id]);
  if (!rows[0]) throw new ServiceError("NOT_FOUND", 404, "reconciliation not found");
  return rows[0].status;
}

/**
 * Starts one reconciliation run. The idempotency key makes retries safe: the same key never
 * creates a second invoice, run or model call.
 */
export async function startReconciliation(input: {
  invoice: InvoicePayload;
  scenarioId: string | null;
  idempotencyKey: string;
  requestedBy: string;
  /** Extra trace tags and metadata (used by the agent benchmark to label runs in Langfuse). */
  tracing?: { tags?: string[]; metadata?: Record<string, unknown>; traceId?: string };
}): Promise<StartResult> {
  const existing = await getReconciliationIdByIdempotencyKey(input.idempotencyKey);
  if (existing) return { reconciliationId: existing, status: await statusOf(existing), deduplicated: true };

  const runId = randomUUID();
  const run = await getMastra().getWorkflow(WORKFLOW_ID).createRun({ runId });
  const result = await run.start({
    inputData: {
      invoice: input.invoice,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.requestedBy,
      scenarioId: input.scenarioId,
    },
    ...(input.tracing ? { tracingOptions: { tags: input.tracing.tags, metadata: input.tracing.metadata, traceId: input.tracing.traceId } } : {}),
  });

  const id = await getReconciliationIdByIdempotencyKey(input.idempotencyKey);
  if (!id) {
    // Failed before anything was persisted (e.g. invalid input): report explicitly, no fake result.
    const message = result.status === "failed" ? String((result as { error?: unknown }).error ?? "workflow failed") : `workflow ended with ${result.status}`;
    throw new ServiceError("WORKFLOW_FAILED", 422, message.slice(0, 300));
  }
  if (result.status === "failed") {
    // Any unexpected step error leaves an explicit FAILED state instead of a dangling PROCESSING row.
    const err = (result as { error?: unknown }).error;
    if (await markFailed(id, "WORKFLOW_ERROR", String((err as Error)?.message ?? err ?? "workflow failed"))) {
      await appendEvent(id, "FAILED", "system", { code: "WORKFLOW_ERROR" });
    }
  }
  const dedup = result.status === "success" && (result.result as { status?: string } | undefined)?.status === "DUPLICATE_REQUEST";
  return { reconciliationId: id, status: await statusOf(id), deduplicated: dedup };
}

/** Resumes the suspended workflow for a persisted decision. Safe to call repeatedly. */
export async function resumeWithDecision(reconciliationId: string): Promise<ReconciliationStatus> {
  const { rows } = await getPool().query(
    `select r.workflow_run_id, d.id as decision_id, d.decision, d.reviewer, d.resume_status, r.status
       from app.reconciliations r join app.review_decisions d on d.reconciliation_id = r.id
      where r.id = $1`,
    [reconciliationId],
  );
  const row = rows[0];
  if (!row) throw new ServiceError("NO_DECISION", 409, "no persisted decision to resume with");
  if (row.resume_status === "RESUMED" || !PENDING_REVIEW_STATUSES.includes(row.status)) return row.status;

  const run = await getMastra().getWorkflow(WORKFLOW_ID).createRun({ runId: row.workflow_run_id });
  try {
    await run.resume({
      step: REVIEW_STEP_ID,
      resumeData: { decisionId: row.decision_id, decision: row.decision, reviewer: row.reviewer },
    });
  } catch (err) {
    // Another request already claimed this resume; the decision row guarantees the same outcome.
    if ((err as { id?: string })?.id !== "WORKFLOW_RESUME_ALREADY_CLAIMED") throw err;
  }
  return statusOf(reconciliationId);
}

export interface DecideResult {
  reconciliationId: string;
  status: ReconciliationStatus;
  decisionId: string;
  replayed: boolean;
}

/**
 * Records exactly one human decision, then resumes the workflow.
 * Order: decision row first (source of truth, unique per reconciliation), then resume. If the resume
 * fails, the decision stays PENDING-resume; a retry with the same key, any later decision attempt,
 * opening the case or opening the review queue completes it (healPendingResume / recoverPendingResumes).
 */
export async function decideReview(
  reconciliationId: string,
  input: ReviewDecisionInput,
  reviewer: string,
): Promise<DecideResult> {
  const recorded = await recordDecision(reconciliationId, input, reviewer).catch(async (err) => {
    // A decision already exists. If its resume never finished (crash after commit, then a reload that
    // created a new idempotency key), finish it now so the case does not stay stuck behind the 409.
    if (err instanceof ServiceError && err.code === "ALREADY_DECIDED") await healPendingResume(reconciliationId);
    throw err;
  });

  const status = await resumeWithDecision(reconciliationId);
  return { reconciliationId, status, ...recorded };
}

async function recordDecision(
  reconciliationId: string,
  input: ReviewDecisionInput,
  reviewer: string,
): Promise<{ decisionId: string; replayed: boolean }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query("select status from app.reconciliations where id = $1 for update", [reconciliationId]);
    if (!rows[0]) throw new ServiceError("NOT_FOUND", 404, "reconciliation not found");
    const existing = await client.query("select id, idempotency_key from app.review_decisions where reconciliation_id = $1", [reconciliationId]);
    const prev = existing.rows[0];
    if (prev) {
      if (prev.idempotency_key === input.idempotencyKey) return { decisionId: prev.id as string, replayed: true };
      throw new ServiceError("ALREADY_DECIDED", 409, "a decision was already recorded for this reconciliation");
    }
    if (!PENDING_REVIEW_STATUSES.includes(rows[0].status)) {
      throw new ServiceError("NOT_PENDING_REVIEW", 409, `reconciliation is ${rows[0].status}, not awaiting review`);
    }
    const keyUsed = await client.query("select 1 from app.review_decisions where idempotency_key = $1", [input.idempotencyKey]);
    if (keyUsed.rowCount) throw new ServiceError("IDEMPOTENCY_KEY_REUSED", 409, "idempotency key already used for another reconciliation");
    const ins = await client.query(
      `insert into app.review_decisions (reconciliation_id, reviewer, decision, reason, idempotency_key)
       values ($1, $2, $3, $4, $5) returning id`,
      [reconciliationId, reviewer, input.decision, input.reason, input.idempotencyKey],
    );
    await appendEvent(reconciliationId, "DECISION_RECORDED", reviewer, { decision: input.decision, reason: input.reason }, client);
    return { decisionId: ins.rows[0].id as string, replayed: false };
  }).catch((err) => {
    // Concurrent insert lost the unique(reconciliation_id) race.
    if ((err as { code?: string }).code === "23505") throw new ServiceError("ALREADY_DECIDED", 409, "a decision was already recorded for this reconciliation");
    throw err;
  });
}

const STUCK_DECISIONS = `select d.reconciliation_id from app.review_decisions d
       join app.reconciliations r on r.id = d.reconciliation_id
      where d.resume_status = 'PENDING' and r.status in ('REVIEW_REQUIRED', 'UNMATCHED')`;

/**
 * Finishes the workflow of one case whose decision is stored but whose resume never ran. Called
 * whenever the owner looks at the case (detail page/API, decision retry), so a stuck case repairs
 * itself the moment someone opens it. Cheap no-op otherwise; never throws, so a read still renders.
 */
export async function healPendingResume(reconciliationId: string): Promise<boolean> {
  try {
    const { rowCount } = await getPool().query(`${STUCK_DECISIONS} and d.reconciliation_id = $1`, [reconciliationId]);
    if (!rowCount) return false;
    await resumeWithDecision(reconciliationId);
    return true;
  } catch (err) {
    console.error(`pending resume for ${reconciliationId} could not be completed yet`, err);
    return false;
  }
}

/**
 * Completes every decision whose workflow resume did not finish (crash between commit and resume).
 * Called when the owner opens the review queue; the cases it repairs leave the queue.
 */
export async function recoverPendingResumes(limit = 20): Promise<string[]> {
  const { rows } = await getPool().query(`${STUCK_DECISIONS} order by d.created_at limit $1`, [limit]);
  const done: string[] = [];
  for (const r of rows) if (await healPendingResume(r.reconciliation_id)) done.push(r.reconciliation_id);
  return done;
}

export { getReconciliationDetail };
