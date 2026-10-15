import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewDecisionSchema } from "@/schemas/domain";
import { errorResponse, ownerMutation, parseJson } from "@/server/http";
import { decideReview } from "@/server/reconciliation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Owner-only: approve (with exception) or reject a reconciliation awaiting review. Reason required. */
export const POST = ownerMutation(async (req, owner, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return errorResponse(400, "INVALID_ID", "id must be a UUID");
  const input = await parseJson(req, reviewDecisionSchema);
  const result = await decideReview(id!, input, owner);
  return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
});
