import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authMode, isDeployedEnvironment, loginLocal, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { clientKey, errorResponse, handleError, parseJson, rateLimit } from "@/server/http";

export const runtime = "nodejs";

const body = z.object({ email: z.string().email().max(200), passphrase: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  try {
    // Passphrase sign-in only exists in local mode on a non-deployed machine.
    if (authMode() !== "local" || isDeployedEnvironment()) return errorResponse(404, "NOT_FOUND", "passphrase sign-in is not enabled");
    if (!rateLimit(`login:${clientKey(req)}`, 5, 60_000)) return errorResponse(429, "RATE_LIMITED", "too many login attempts");
    const { email, passphrase } = await parseJson(req, body);
    const token = loginLocal(email, passphrase);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    return handleError(err);
  }
}
