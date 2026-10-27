import { NextResponse } from "next/server";
import { listReconciliations } from "@/db/repository";
import { ownerRead } from "@/server/http";
import { recoverPendingResumes } from "@/server/reconciliation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRead(async () => {
  await recoverPendingResumes();
  const items = await listReconciliations({ statuses: ["REVIEW_REQUIRED", "UNMATCHED"] });
  return NextResponse.json({ pending: items });
});
