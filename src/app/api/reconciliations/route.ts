import { NextResponse } from "next/server";
import { z } from "zod";
import { listReconciliations } from "@/db/repository";
import { getScenario } from "@/fixtures";
import { RECONCILIATION_STATUSES } from "@/schemas/domain";
import { clientKey, errorResponse, ownerMutation, ownerRead, parseJson, rateLimit } from "@/server/http";
import { startReconciliation } from "@/server/reconciliation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const startBody = z.object({
  scenarioId: z.string().max(64),
  idempotencyKey: z.string().trim().min(8).max(100),
});

/** Owner-only: start a reconciliation for one of the synthetic scenarios. */
export const POST = ownerMutation(async (req, owner) => {
  if (!rateLimit(`start:${clientKey(req)}`, 10, 60_000)) return errorResponse(429, "RATE_LIMITED", "too many runs, slow down");
  const { scenarioId, idempotencyKey } = await parseJson(req, startBody);
  const scenario = getScenario(scenarioId);
  if (!scenario) return errorResponse(404, "UNKNOWN_SCENARIO", "unknown scenario id");
  const result = await startReconciliation({ invoice: scenario.invoice, scenarioId, idempotencyKey, requestedBy: owner });
  return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
});

const listQuery = z.object({ status: z.enum(RECONCILIATION_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(200).optional() });

export const GET = ownerRead(async (req) => {
  const q = listQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const items = await listReconciliations({ statuses: q.status ? [q.status] : undefined, limit: q.limit });
  return NextResponse.json({ reconciliations: items });
});
