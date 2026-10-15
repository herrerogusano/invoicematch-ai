import { NextResponse, type NextRequest } from "next/server";
import { currentOwner } from "@/server/auth";
import { handleError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const owner = await currentOwner(req.cookies);
    return NextResponse.json({ signedIn: Boolean(owner), email: owner });
  } catch (err) {
    return handleError(err);
  }
}
