import { NextResponse } from "next/server";
import { scenarios } from "@/fixtures";

export const runtime = "nodejs";

/** Public: the synthetic, labeled scenarios (fictional data only). */
export async function GET() {
  return NextResponse.json({
    cases: scenarios.map((s) => ({ id: s.id, title: s.title, summary: s.summary, expected: s.expected, invoice: s.invoice })),
  });
}
