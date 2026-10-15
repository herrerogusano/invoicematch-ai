import { NextResponse, type NextRequest } from "next/server";
import { authMode, createSessionToken, ownerEmails, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { exchangeCodeForEmail, PKCE_COOKIE } from "@/server/supabase-auth";

export const runtime = "nodejs";

/** Magic-link landing: exchanges the one-time code (PKCE) and issues the owner session. */
export async function GET(req: NextRequest) {
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${reason}`, req.nextUrl.origin));
    res.cookies.delete({ name: PKCE_COOKIE, path: "/auth/callback" });
    return res;
  };
  try {
    if (authMode() !== "supabase") return fail("disabled");
    const code = req.nextUrl.searchParams.get("code");
    const verifier = req.cookies.get(PKCE_COOKIE)?.value;
    if (!code || !verifier) return fail("link");
    const email = await exchangeCodeForEmail(code, verifier);
    if (!email) return fail("link");
    if (!ownerEmails().includes(email)) return fail("forbidden");

    const res = NextResponse.redirect(new URL("/owner", req.nextUrl.origin));
    res.cookies.set(SESSION_COOKIE, createSessionToken(email, Date.now(), "supabase"), sessionCookieOptions());
    res.cookies.delete({ name: PKCE_COOKIE, path: "/auth/callback" });
    return res;
  } catch (err) {
    console.error("[auth] callback failed", (err as Error).message);
    return fail("server");
  }
}
