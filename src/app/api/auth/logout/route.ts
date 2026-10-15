import { NextResponse } from "next/server";
import { SESSION_COOKIE, SUPABASE_TOKEN_COOKIE } from "@/server/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(SUPABASE_TOKEN_COOKIE);
  return res;
}
