import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";
import { PKCE_COOKIE } from "@/server/supabase-auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete({ name: PKCE_COOKIE, path: "/auth/callback" });
  return res;
}
