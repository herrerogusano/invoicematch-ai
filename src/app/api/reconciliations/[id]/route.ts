import { NextResponse } from "next/server";
import { z } from "zod";
import { getReconciliationDetail } from "@/db/repository";
import { errorResponse, ownerRead } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRead(async (_req, _owner, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return errorResponse(400, "INVALID_ID", "id must be a UUID");
  const detail = await getReconciliationDetail(id!);
  if (!detail) return errorResponse(404, "NOT_FOUND", "reconciliation not found");
  return NextResponse.json(detail);
});
