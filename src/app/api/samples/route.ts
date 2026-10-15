import { NextResponse } from "next/server";
import { publicSamples } from "@/server/samples";

export const runtime = "nodejs";

/** Public, precomputed, read-only results. No database, no model, no auth required. */
export async function GET() {
  return NextResponse.json(publicSamples());
}
