import { withTransaction, getPool } from "@/db/pool";

/**
 * Application-level spend guard for live model calls. It reduces risk; it does not replace the
 * provider-side spend limit configured in Claude Console.
 *
 * Before a live agent run we reserve the worst case (maxSteps model requests at maxOutputTokens and
 * an input-token ceiling). If that reservation would cross LLM_BUDGET_USD or LLM_MAX_REQUESTS the
 * call is refused (fail closed). After the run the reservation is replaced by measured usage.
 */

export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED";
}

/** USD per million tokens. Unknown models get a deliberately pessimistic price. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
const PESSIMISTIC = { input: 15, output: 75 };

export function priceFor(model: string) {
  return PRICES[model] ?? PESSIMISTIC;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export const LIMITS = {
  maxSteps: 4,
  maxOutputTokens: 1200,
  maxInputTokensPerRequest: 8000,
};

export function budgetConfig() {
  const usd = Number(process.env.LLM_BUDGET_USD ?? 3);
  const requests = Number(process.env.LLM_MAX_REQUESTS ?? 30);
  if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(requests) || requests < 0) {
    throw new BudgetExceededError("invalid LLM budget configuration");
  }
  return { usd, requests };
}

export interface Reservation {
  id: string;
  model: string;
}

export async function reserveLiveCall(model: string, reconciliationId: string | null): Promise<Reservation> {
  const { usd, requests } = budgetConfig();
  const worstCost = estimateCostUsd(
    model,
    LIMITS.maxSteps * LIMITS.maxInputTokensPerRequest,
    LIMITS.maxSteps * LIMITS.maxOutputTokens,
  );
  return withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('invoicematch-llm-budget'))");
    const { rows } = await client.query<{ n: string; cost: string }>(
      "select coalesce(sum(request_count), 0) as n, coalesce(sum(estimated_cost_usd), 0) as cost from app.llm_usage",
    );
    const usedRequests = Number(rows[0]!.n);
    const usedCost = Number(rows[0]!.cost);
    if (usedRequests + LIMITS.maxSteps > requests || usedCost + worstCost > usd) {
      throw new BudgetExceededError(
        `live LLM budget exhausted (requests ${usedRequests}/${requests}, est. $${usedCost.toFixed(4)}/$${usd})`,
      );
    }
    const ins = await client.query<{ id: string }>(
      `insert into app.llm_usage (reconciliation_id, model, status, request_count, estimated_cost_usd)
       values ($1, $2, 'RESERVED', $3, $4) returning id`,
      [reconciliationId, model, LIMITS.maxSteps, worstCost.toFixed(6)],
    );
    return { id: ins.rows[0]!.id, model };
  });
}

export async function settleLiveCall(
  r: Reservation,
  outcome: { ok: boolean; requests: number; inputTokens: number; outputTokens: number },
): Promise<void> {
  // A failed call keeps its worst-case reservation unless we know actual usage: never under-count.
  const cost = estimateCostUsd(r.model, outcome.inputTokens, outcome.outputTokens);
  await getPool().query(
    `update app.llm_usage
        set status = $2, request_count = greatest($3, 1), input_tokens = $4, output_tokens = $5,
            estimated_cost_usd = case when $2 = 'COMPLETED' then $6 else estimated_cost_usd end
      where id = $1`,
    [r.id, outcome.ok ? "COMPLETED" : "FAILED", outcome.requests, outcome.inputTokens, outcome.outputTokens, cost.toFixed(6)],
  );
}

export async function usageSummary() {
  const { rows } = await getPool().query(
    `select count(*)::int as runs, coalesce(sum(request_count), 0)::int as requests,
            coalesce(sum(estimated_cost_usd), 0)::text as cost_usd from app.llm_usage`,
  );
  const { usd, requests } = budgetConfig();
  return { runs: rows[0].runs, requests: rows[0].requests, estimatedCostUsd: rows[0].cost_usd, limitUsd: usd, limitRequests: requests };
}
