import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getPurchaseOrderById, MAX_CANDIDATES, searchPurchaseOrders } from "@/db/repository";

/**
 * Server-supplied scope for tool calls. It travels in Mastra's requestContext, so the model can
 * never widen it: tools only ever see the invoice's own supplier.
 */
export interface ToolScope {
  supplierId: string;
  fixedPurchaseOrderId: string | null;
}

export const TOOL_SCOPE_KEY = "invoicematch.scope";

function scopeFrom(ctx: { requestContext?: { get: (k: string) => unknown } }): ToolScope {
  const scope = ctx.requestContext?.get(TOOL_SCOPE_KEY) as ToolScope | undefined;
  if (!scope?.supplierId) throw new Error("tool called without a server-side supplier scope");
  return scope;
}

export const lookupPurchaseOrders = createTool({
  id: "lookupPurchaseOrders",
  description:
    "List up to 5 purchase orders of the invoice's supplier per page, each with its lines (lineId, description, quantity, unitPrice). Optionally filter by an exact PO number. When hasMore is true, call again with offset = offset + candidates.length to see the next page.",
  inputSchema: z.object({
    poNumber: z.string().trim().min(1).max(64).nullish().describe("Exact PO number, if the invoice references one"),
    includeClosed: z.boolean().default(false),
    limit: z.number().int().min(1).max(MAX_CANDIDATES).default(MAX_CANDIDATES),
    offset: z.number().int().min(0).max(1000).default(0).describe("Number of candidates to skip (paging)"),
  }),
  outputSchema: z.object({
    candidates: z.array(
      z.object({
        id: z.string(),
        poNumber: z.string(),
        status: z.enum(["OPEN", "CLOSED"]),
        currency: z.string(),
        total: z.string(),
        lineCount: z.number(),
        lines: z.array(z.object({ lineId: z.string(), description: z.string(), quantity: z.string(), unitPrice: z.string() })),
      }),
    ),
    total: z.number().describe("Number of matching purchase orders across all pages"),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
  execute: async (input, ctx) => {
    const scope = scopeFrom(ctx);
    const { candidates, total } = await searchPurchaseOrders({
      supplierId: scope.supplierId,
      poNumber: input.poNumber ?? null,
      includeClosed: input.includeClosed,
      limit: input.limit,
      offset: input.offset,
    });
    return { candidates, total, offset: input.offset, hasMore: input.offset + candidates.length < total };
  },
});

export const getSupplierAndOrderDetails = createTool({
  id: "getSupplierAndOrderDetails",
  description:
    "Fetch one purchase order of the invoice's supplier with supplier details and all its lines (lineId, sku, description, quantity, unitPrice, taxRate).",
  inputSchema: z.object({ purchaseOrderId: z.string().uuid() }),
  outputSchema: z.object({
    found: z.boolean(),
    supplier: z.object({ code: z.string(), name: z.string() }).nullable(),
    purchaseOrder: z
      .object({
        id: z.string(),
        poNumber: z.string(),
        status: z.string(),
        currency: z.string(),
        lines: z.array(
          z.object({
            lineId: z.string(),
            sku: z.string().nullable(),
            description: z.string(),
            quantity: z.string(),
            unitPrice: z.string(),
            taxRate: z.string(),
          }),
        ),
      })
      .nullable(),
  }),
  execute: async (input, ctx) => {
    const scope = scopeFrom(ctx);
    const po = await getPurchaseOrderById(input.purchaseOrderId);
    // Cross-supplier reads are reported as "not found" rather than leaking another supplier's data.
    if (!po || po.supplierId !== scope.supplierId) return { found: false, supplier: null, purchaseOrder: null };
    return {
      found: true,
      supplier: { code: po.supplierCode, name: po.supplierName },
      purchaseOrder: {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        currency: po.currency,
        lines: po.lines.map((l) => ({ ...l, sku: l.sku ?? null })),
      },
    };
  },
});

export const reconciliationTools = { lookupPurchaseOrders, getSupplierAndOrderDetails };
