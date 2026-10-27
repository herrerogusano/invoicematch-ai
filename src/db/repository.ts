import type { PoolClient } from "pg";
import { dec, formatDecimal } from "@/domain/money";
import type { DomainLine, ReconcileResult } from "@/domain/reconcile";
import type { CurrencyCode, InvoicePayload, ReconciliationStatus } from "@/schemas/domain";
import { getPool, type Queryable } from "./pool";

/** All SQL lives here. Numeric columns come back from pg as strings and stay strings. */

const q = (client?: Queryable): Queryable => client ?? getPool();
const num = (v: string | null): string | null => (v === null ? null : formatDecimal(dec(v)));

export interface SupplierRecord {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
}

export interface PurchaseOrderRecord {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  currency: CurrencyCode;
  status: "OPEN" | "CLOSED";
  totals: { subtotal: string; tax: string; total: string };
  lines: DomainLine[];
}

export interface PoCandidateSummary {
  id: string;
  poNumber: string;
  status: "OPEN" | "CLOSED";
  currency: CurrencyCode;
  total: string;
  lineCount: number;
  /** Compact line list so the agent can screen candidates without fetching each order. */
  lines: Array<{ lineId: string; description: string; quantity: string; unitPrice: string }>;
}

export const MAX_CANDIDATES = 5;
/** Lines shown per candidate in search results; the full order is one getSupplierAndOrderDetails call away. */
export const MAX_SUMMARY_LINES = 10;

export async function getSupplierByCode(code: string, client?: Queryable): Promise<SupplierRecord | null> {
  const { rows } = await q(client).query(
    "select id, code, name, tax_id from app.suppliers where code = $1",
    [code],
  );
  const r = rows[0];
  return r ? { id: r.id, code: r.code, name: r.name, taxId: r.tax_id } : null;
}

export async function listSuppliers(client?: Queryable): Promise<SupplierRecord[]> {
  const { rows } = await q(client).query("select id, code, name, tax_id from app.suppliers order by code");
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, taxId: r.tax_id }));
}

async function loadPurchaseOrder(where: string, value: string, client?: Queryable): Promise<PurchaseOrderRecord | null> {
  const { rows } = await q(client).query(
    `select po.id, po.po_number, po.supplier_id, s.code as supplier_code, s.name as supplier_name,
            po.currency, po.status, po.subtotal, po.tax, po.total
       from app.purchase_orders po join app.suppliers s on s.id = po.supplier_id
      where ${where}`,
    [value],
  );
  const r = rows[0];
  if (!r) return null;
  const lines = await q(client).query(
    `select line_id, sku, description, quantity, unit_price, tax_rate
       from app.purchase_order_lines where purchase_order_id = $1 order by position`,
    [r.id],
  );
  return {
    id: r.id,
    poNumber: r.po_number,
    supplierId: r.supplier_id,
    supplierCode: r.supplier_code,
    supplierName: r.supplier_name,
    currency: r.currency,
    status: r.status,
    totals: { subtotal: num(r.subtotal)!, tax: num(r.tax)!, total: num(r.total)! },
    lines: lines.rows.map((l) => ({
      lineId: l.line_id,
      sku: l.sku,
      description: l.description,
      quantity: num(l.quantity)!,
      unitPrice: num(l.unit_price)!,
      taxRate: num(l.tax_rate)!,
    })),
  };
}

export function getPurchaseOrderById(id: string, client?: Queryable) {
  return loadPurchaseOrder("po.id = $1::uuid", id, client);
}

/** Exact (case-insensitive) PO number lookup across all suppliers; used only for explicit references. */
export function findPurchaseOrderByNumber(poNumber: string, client?: Queryable) {
  return loadPurchaseOrder("upper(po.po_number) = upper($1)", poNumber, client);
}

/**
 * Bounded, supplier-scoped candidate search. The supplier scope comes from the server, never from
 * the model, so a tool call can never read another supplier's orders.
 */
export async function searchPurchaseOrders(
  params: { supplierId: string; poNumber?: string | null; includeClosed?: boolean; limit?: number; offset?: number },
  client?: Queryable,
): Promise<{ candidates: PoCandidateSummary[]; total: number }> {
  const limit = Math.min(Math.max(params.limit ?? MAX_CANDIDATES, 1), MAX_CANDIDATES);
  const offset = Math.max(0, Math.floor(params.offset ?? 0));
  const filter = [params.supplierId, params.poNumber ?? null, params.includeClosed ?? false];
  const where = `where po.supplier_id = $1
        and ($2::text is null or upper(po.po_number) = upper($2))
        and ($3::boolean or po.status = 'OPEN')`;
  const [{ rows }, count] = await Promise.all([
    q(client).query(
      `select po.id, po.po_number, po.status, po.currency, po.total,
              (select count(*)::int from app.purchase_order_lines l where l.purchase_order_id = po.id) as line_count
         from app.purchase_orders po
        ${where}
        order by po.po_number
        limit $4 offset $5`,
      [...filter, limit, offset],
    ),
    q(client).query(`select count(*)::int as n from app.purchase_orders po ${where}`, filter),
  ]);
  const ids = rows.map((r) => r.id);
  const lines = ids.length
    ? (
        await q(client).query(
          `select purchase_order_id, line_id, description, quantity, unit_price
             from (select l.*, row_number() over (partition by purchase_order_id order by position) as rn
                     from app.purchase_order_lines l where purchase_order_id = any($1::uuid[])) x
            where rn <= $2
            order by purchase_order_id, position`,
          [ids, MAX_SUMMARY_LINES],
        )
      ).rows
    : [];
  return {
    total: count.rows[0].n,
    candidates: rows.map((r) => ({
      id: r.id,
      poNumber: r.po_number,
      status: r.status,
      currency: r.currency,
      total: num(r.total)!,
      lineCount: r.line_count,
      lines: lines
        .filter((l) => l.purchase_order_id === r.id)
        .map((l) => ({ lineId: l.line_id, description: l.description, quantity: num(l.quantity)!, unitPrice: num(l.unit_price)! })),
    })),
  };
}

export async function countOpenPurchaseOrders(supplierId: string, client?: Queryable): Promise<number> {
  const { rows } = await q(client).query(
    "select count(*)::int as n from app.purchase_orders where supplier_id = $1 and status = 'OPEN'",
    [supplierId],
  );
  return rows[0].n;
}

export async function findDuplicateInvoiceIds(
  supplierId: string,
  invoiceNumber: string,
  excludeInvoiceId: string,
  client?: Queryable,
): Promise<string[]> {
  const { rows } = await q(client).query(
    `select id from app.invoices
      where supplier_id = $1 and upper(invoice_number) = upper($2) and id <> $3
      order by created_at`,
    [supplierId, invoiceNumber, excludeInvoiceId],
  );
  return rows.map((r) => r.id);
}

export async function insertInvoice(
  client: PoolClient,
  inv: InvoicePayload,
  supplierId: string,
  opts: { historical?: boolean } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into app.invoices
       (invoice_number, supplier_id, po_reference, invoice_date, currency, subtotal, tax, total, source, is_historical)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      inv.invoiceNumber,
      supplierId,
      inv.poReference ?? null,
      inv.invoiceDate,
      inv.currency,
      inv.declared.subtotal,
      inv.declared.tax,
      inv.declared.total,
      JSON.stringify(inv),
      opts.historical ?? false,
    ],
  );
  const invoiceId = rows[0]!.id;
  for (const [i, l] of inv.lines.entries()) {
    await client.query(
      `insert into app.invoice_lines
         (invoice_id, line_id, position, sku, description, quantity, unit_price, tax_rate, line_subtotal)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [invoiceId, l.lineId, i, l.sku ?? null, l.description, l.quantity, l.unitPrice, l.taxRate, l.lineSubtotal ?? null],
    );
  }
  return invoiceId;
}

export type AgentMode = "mock" | "anthropic" | "none";

/** Inserts the reconciliation row; returns null when the idempotency key already exists. */
export async function insertReconciliation(
  client: PoolClient,
  r: { invoiceId: string; runId: string; idempotencyKey: string; scenarioId: string | null; agentMode: AgentMode; requestedBy: string },
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `insert into app.reconciliations
       (invoice_id, workflow_run_id, idempotency_key, scenario_id, status, agent_mode, requested_by)
     values ($1, $2, $3, $4, 'PROCESSING', $5, $6)
     on conflict (idempotency_key) do nothing
     returning id`,
    [r.invoiceId, r.runId, r.idempotencyKey, r.scenarioId, r.agentMode, r.requestedBy],
  );
  return rows[0]?.id ?? null;
}

export async function getReconciliationIdByIdempotencyKey(key: string, client?: Queryable): Promise<string | null> {
  const { rows } = await q(client).query("select id from app.reconciliations where idempotency_key = $1", [key]);
  return rows[0]?.id ?? null;
}

export async function appendEvent(
  reconciliationId: string,
  eventType: string,
  actor: string,
  payload: Record<string, unknown> = {},
  client?: Queryable,
): Promise<void> {
  await q(client).query(
    "insert into app.reconciliation_events (reconciliation_id, event_type, actor, payload) values ($1, $2, $3, $4)",
    [reconciliationId, eventType, actor, JSON.stringify(payload)],
  );
}

/** PROCESSING → MATCHED | REVIEW_REQUIRED | UNMATCHED. Returns false if the row was not PROCESSING. */
export async function storeAutomaticResult(
  id: string,
  r: {
    status: "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";
    purchaseOrderId: string | null;
    result: ReconcileResult & Record<string, unknown>;
    agentOutput: unknown;
    agentInvoked: boolean;
  },
  client?: Queryable,
): Promise<boolean> {
  const res = await q(client).query(
    `update app.reconciliations
        set status = $2, purchase_order_id = $3, result = $4, agent_output = $5, agent_invoked = $6,
            updated_at = now(), finalized_at = case when $2 = 'MATCHED' then now() else null end
      where id = $1 and status = 'PROCESSING'`,
    [id, r.status, r.purchaseOrderId, JSON.stringify(r.result), r.agentOutput === undefined ? null : JSON.stringify(r.agentOutput), r.agentInvoked],
  );
  return res.rowCount === 1;
}

export async function markFailed(id: string, code: string, message: string, client?: Queryable): Promise<boolean> {
  const res = await q(client).query(
    `update app.reconciliations
        set status = 'FAILED', error_code = $2, error_message = left($3, 500), updated_at = now(), finalized_at = now()
      where id = $1 and status = 'PROCESSING'`,
    [id, code, message],
  );
  return res.rowCount === 1;
}

export async function setTraceId(id: string, traceId: string, client?: Queryable): Promise<void> {
  await q(client).query("update app.reconciliations set trace_id = $2 where id = $1 and trace_id is null", [id, traceId]);
}

/** REVIEW_REQUIRED | UNMATCHED → APPROVED_WITH_EXCEPTION | REJECTED, exactly once. */
export async function applyReviewOutcome(
  id: string,
  status: "APPROVED_WITH_EXCEPTION" | "REJECTED",
  client?: Queryable,
): Promise<boolean> {
  const res = await q(client).query(
    `update app.reconciliations
        set status = $2, updated_at = now(), finalized_at = now()
      where id = $1 and status in ('REVIEW_REQUIRED', 'UNMATCHED')`,
    [id, status],
  );
  return res.rowCount === 1;
}

export async function markDecisionResumed(reconciliationId: string, client?: Queryable): Promise<void> {
  await q(client).query(
    "update app.review_decisions set resume_status = 'RESUMED', resumed_at = now() where reconciliation_id = $1 and resume_status = 'PENDING'",
    [reconciliationId],
  );
}

// ---------------------------------------------------------------------------------------------
// Read models for API / UI

export interface ReconciliationSummary {
  id: string;
  status: ReconciliationStatus;
  scenarioId: string | null;
  invoiceNumber: string;
  supplierCode: string;
  supplierName: string;
  poNumber: string | null;
  currency: CurrencyCode;
  declaredTotal: string;
  agentMode: AgentMode;
  agentInvoked: boolean;
  createdAt: string;
  finalizedAt: string | null;
  findingCount: number;
}

const SUMMARY_SELECT = `
  select r.id, r.status, r.scenario_id, i.invoice_number, s.code as supplier_code, s.name as supplier_name,
         po.po_number, i.currency, i.total as declared_total, r.agent_mode, r.agent_invoked,
         r.created_at, r.finalized_at, coalesce(jsonb_array_length(r.result->'findings'), 0) as finding_count
    from app.reconciliations r
    join app.invoices i on i.id = r.invoice_id
    join app.suppliers s on s.id = i.supplier_id
    left join app.purchase_orders po on po.id = r.purchase_order_id`;

function toSummary(r: Record<string, unknown>): ReconciliationSummary {
  return {
    id: r.id as string,
    status: r.status as ReconciliationStatus,
    scenarioId: (r.scenario_id as string) ?? null,
    invoiceNumber: r.invoice_number as string,
    supplierCode: r.supplier_code as string,
    supplierName: r.supplier_name as string,
    poNumber: (r.po_number as string) ?? null,
    currency: r.currency as CurrencyCode,
    declaredTotal: num(r.declared_total as string)!,
    agentMode: r.agent_mode as AgentMode,
    agentInvoked: r.agent_invoked as boolean,
    createdAt: (r.created_at as Date).toISOString(),
    finalizedAt: r.finalized_at ? (r.finalized_at as Date).toISOString() : null,
    findingCount: Number(r.finding_count),
  };
}

export async function listReconciliations(
  opts: { statuses?: ReconciliationStatus[]; limit?: number } = {},
  client?: Queryable,
): Promise<ReconciliationSummary[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const { rows } = await q(client).query(
    `${SUMMARY_SELECT} where ($1::text[] is null or r.status = any($1)) order by r.created_at desc limit $2`,
    [opts.statuses ?? null, limit],
  );
  return rows.map(toSummary);
}

export interface ReconciliationEvent {
  id: number;
  eventType: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ReviewDecisionRecord {
  id: string;
  reviewer: string;
  decision: "APPROVE" | "REJECT";
  reason: string;
  resumeStatus: "PENDING" | "RESUMED";
  createdAt: string;
}

export interface ReconciliationDetail extends ReconciliationSummary {
  workflowRunId: string;
  invoiceId: string;
  purchaseOrderId: string | null;
  invoiceSource: InvoicePayload;
  result: (ReconcileResult & { explanation?: string | null; poSelection?: string; candidateCount?: number }) | null;
  agentOutput: unknown;
  traceId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedBy: string;
  decision: ReviewDecisionRecord | null;
  events: ReconciliationEvent[];
}

export async function getReconciliationDetail(id: string, client?: Queryable): Promise<ReconciliationDetail | null> {
  const { rows } = await q(client).query(
    `select x.*, r.workflow_run_id, r.invoice_id, r.purchase_order_id, i.source, r.result, r.agent_output,
            r.trace_id, r.error_code, r.error_message, r.requested_by
       from (${SUMMARY_SELECT} where r.id = $1::uuid) x
       join app.reconciliations r on r.id = x.id
       join app.invoices i on i.id = r.invoice_id`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const [decision, events] = await Promise.all([
    q(client).query(
      "select id, reviewer, decision, reason, resume_status, created_at from app.review_decisions where reconciliation_id = $1",
      [id],
    ),
    q(client).query(
      "select id, event_type, actor, payload, created_at from app.reconciliation_events where reconciliation_id = $1 order by id",
      [id],
    ),
  ]);
  const d = decision.rows[0];
  return {
    ...toSummary(r),
    workflowRunId: r.workflow_run_id,
    invoiceId: r.invoice_id,
    purchaseOrderId: r.purchase_order_id,
    invoiceSource: r.source,
    result: r.result,
    agentOutput: r.agent_output,
    traceId: r.trace_id,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    requestedBy: r.requested_by,
    decision: d
      ? {
          id: d.id,
          reviewer: d.reviewer,
          decision: d.decision,
          reason: d.reason,
          resumeStatus: d.resume_status,
          createdAt: (d.created_at as Date).toISOString(),
        }
      : null,
    events: events.rows.map((e) => ({
      id: Number(e.id),
      eventType: e.event_type,
      actor: e.actor,
      payload: e.payload,
      createdAt: (e.created_at as Date).toISOString(),
    })),
  };
}
