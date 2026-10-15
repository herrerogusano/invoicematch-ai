import { z } from "zod";
import catalogJson from "../../data/fixtures/catalog.json";
import scenariosJson from "../../data/fixtures/scenarios.json";
import {
  invoicePayloadSchema,
  purchaseOrderPayloadSchema,
  RECONCILIATION_STATUSES,
  supplierSchema,
} from "@/schemas/domain";
import { RULES, type RuleId } from "@/domain/reconcile";

const ruleId = z.enum(Object.keys(RULES) as [RuleId, ...RuleId[]]);

export const scenarioSchema = z.object({
  id: z.string().regex(/^S\d{2}-[a-z0-9-]+$/),
  title: z.string(),
  summary: z.string(),
  agentRequired: z.boolean().optional(),
  expected: z.object({
    status: z.enum(RECONCILIATION_STATUSES),
    ruleIds: z.array(ruleId),
  }),
  invoice: invoicePayloadSchema,
});
export type Scenario = z.infer<typeof scenarioSchema>;

const catalogSchema = z.object({
  suppliers: z.array(supplierSchema),
  purchaseOrders: z.array(purchaseOrderPayloadSchema),
  historicalInvoices: z.array(invoicePayloadSchema),
});

/** Parsed and validated once; a malformed fixture fails loudly at import time. */
export const catalog = catalogSchema.parse(catalogJson);
export const scenarios: Scenario[] = z
  .object({ version: z.number(), scenarios: z.array(scenarioSchema).min(12) })
  .parse(scenariosJson).scenarios;

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
