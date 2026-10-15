import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authMode, ownerEmails } from "@/server/auth";
import { clientKey, errorResponse, handleError, parseJson, rateLimit, sameOrigin } from "@/server/http";
import { createPkcePair, PKCE_COOKIE, PKCE_TTL_SECONDS, sendMagicLink } from "@/server/supabase-auth";

export const runtime = "nodejs";

const body = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(200)) });

/**
 * Requests a Supabase magic link. Only allow-listed owner emails are forwarded to Supabase; the
 * response is identical either way, so the endpoint does not reveal who the owner is.
 */
export async function POST(req: NextRequest) {
  try {
    if (authMode() !== "supabase") return errorResponse(404, "NOT_FOUND", "magic-link sign-in is not enabled");
    if (!sameOrigin(req)) return errorResponse(403, "FORBIDDEN_ORIGIN", "cross-origin request refused");
    if (!rateLimit(`magic:${clientKey(req)}`, 3, 10 * 60_000)) return errorResponse(429, "RATE_LIMITED", "too many sign-in requests");
    const { email } = await parseJson(req, body);

    const { verifier, challenge } = createPkcePair();
    if (ownerEmails().includes(email)) {
      const redirectTo = new URL("/auth/callback", req.nextUrl.origin).toString();
      try {
        await sendMagicLink(email, redirectTo, challenge);
      } catch (err) {
        console.error("[auth] magic link request failed", (err as Error).message);
      }
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(PKCE_COOKIE, verifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/auth/callback",
      maxAge: PKCE_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
