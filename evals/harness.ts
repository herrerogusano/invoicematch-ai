import { migrate } from "@/db/migrate";
import { seed } from "@/db/seed";
import { createScratchDatabase } from "@/db/scratch";
import { getReconciliationDetail } from "@/db/repository";
import { scenarios, type Scenario } from "@/fixtures";
import { initMastraStorage } from "@/mastra/storage";
import { startReconciliation } from "@/server/reconciliation-service";

export async function prepareScratch(name: string) {
  await createScratchDatabase(name);
  await migrate(() => undefined);
  await initMastraStorage();
  await seed(() => undefined);
}

export interface ScenarioOutcome {
  id: string;
  title: string;
  expectedStatus: string;
  actualStatus: string;
  expectedRuleIds: string[];
  actualRuleIds: string[];
  statusOk: boolean;
  rulesOk: boolean;
  pass: boolean;
  agentInvoked: boolean;
  agentMode: string;
  toolCalls: string[];
  poNumber: string | null;
  invoiceTotal: string | null;
  error: string | null;
}

const sorted = (xs: string[]) => [...xs].sort();

export async function runScenario(s: Scenario, tag: string): Promise<ScenarioOutcome> {
  try {
    const started = await startReconciliation({
      invoice: s.invoice,
      scenarioId: s.id,
      idempotencyKey: `eval-${tag}-${s.id}`,
      requestedBy: "eval-runner",
    });
    const d = await getReconciliationDetail(started.reconciliationId);
    const actualRuleIds = sorted((d?.result?.findings ?? []).map((f) => f.ruleId));
    const expectedRuleIds = sorted(s.expected.ruleIds);
    const agentEvent = d?.events.find((e) => e.eventType === "AGENT_STEP")?.payload as { toolCalls?: string[] } | undefined;
    const statusOk = started.status === s.expected.status;
    const rulesOk = JSON.stringify(actualRuleIds) === JSON.stringify(expectedRuleIds);
    return {
      id: s.id,
      title: s.title,
      expectedStatus: s.expected.status,
      actualStatus: started.status,
      expectedRuleIds,
      actualRuleIds,
      statusOk,
      rulesOk,
      pass: statusOk && rulesOk,
      agentInvoked: d?.agentInvoked ?? false,
      agentMode: d?.agentMode ?? "unknown",
      toolCalls: agentEvent?.toolCalls ?? [],
      poNumber: d?.poNumber ?? null,
      invoiceTotal: d?.result?.invoiceTotals.total ?? null,
      error: d?.errorCode ? `${d.errorCode}: ${d.errorMessage}` : null,
    };
  } catch (err) {
    return {
      id: s.id, title: s.title, expectedStatus: s.expected.status, actualStatus: "ERROR", expectedRuleIds: sorted(s.expected.ruleIds),
      actualRuleIds: [], statusOk: false, rulesOk: false, pass: false, agentInvoked: false, agentMode: "unknown", toolCalls: [],
      poNumber: null, invoiceTotal: null, error: (err as Error).message,
    };
  }
}

export { scenarios };
