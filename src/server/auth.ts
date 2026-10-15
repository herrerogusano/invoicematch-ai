import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Owner authentication. Two adapters behind one interface:
 *
 * - local:    passphrase login → HMAC-signed, HttpOnly session cookie. Refused on deployed
 *             environments (VERCEL or DEPLOYED set), where only Supabase Auth is allowed.
 * - supabase: Supabase Auth magic link; the access token is verified server-side against
 *             Supabase's /auth/v1/user endpoint. (Wired; not verified without a Supabase project.)
 *
 * In both modes the email must be on the OWNER_EMAILS allowlist. Every mutation checks this
 * server-side; hiding buttons in the UI is never the protection.
 */

export const SESSION_COOKIE = "im_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export class AuthError extends Error {
  constructor(
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "AUTH_MISCONFIGURED" | "INVALID_CREDENTIALS",
    readonly httpStatus: 401 | 403 | 500,
    message: string,
  ) {
    super(message);
  }
}

export type AuthMode = "local" | "supabase";

export function authMode(): AuthMode {
  const m = process.env.AUTH_MODE ?? "local";
  if (m !== "local" && m !== "supabase") throw new AuthError("AUTH_MISCONFIGURED", 500, "invalid AUTH_MODE");
  return m;
}

export function isDeployedEnvironment(): boolean {
  return Boolean(process.env.VERCEL || process.env.DEPLOYED);
}

export function ownerEmails(): string[] {
  return (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function sessionSecret(): Buffer {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.length < 32) throw new AuthError("AUTH_MISCONFIGURED", 500, "SESSION_SECRET must be at least 32 characters");
  return Buffer.from(s);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export interface Session {
  email: string;
  exp: number;
}

export function createSessionToken(email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof s.email !== "string" || typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

/** Local passphrase login. Returns a session token for an allow-listed email. */
export function loginLocal(email: string, passphrase: string): string {
  if (authMode() !== "local") throw new AuthError("AUTH_MISCONFIGURED", 500, "local login is disabled (AUTH_MODE is not local)");
  if (isDeployedEnvironment()) throw new AuthError("AUTH_MISCONFIGURED", 500, "local login is refused on deployed environments");
  const expected = process.env.OWNER_PASSPHRASE ?? "";
  if (expected.length < 12) throw new AuthError("AUTH_MISCONFIGURED", 500, "OWNER_PASSPHRASE must be at least 12 characters");
  const normalized = email.trim().toLowerCase();
  // Compare both even on a bad email to avoid a timing oracle on the allowlist.
  const passOk = safeEqual(passphrase, expected);
  const emailOk = ownerEmails().includes(normalized);
  if (!passOk || !emailOk) throw new AuthError("INVALID_CREDENTIALS", 401, "invalid credentials");
  return createSessionToken(normalized);
}

async function verifySupabaseToken(accessToken: string | undefined): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new AuthError("AUTH_MISCONFIGURED", 500, "Supabase Auth is not configured");
  if (!accessToken) return null;
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) return null;
  const user = (await res.json()) as { email?: string };
  return user.email?.toLowerCase() ?? null;
}

export const SUPABASE_TOKEN_COOKIE = "im_sb_token";

/** Resolves the current owner from request cookies, or null if not signed in. Fails closed. */
export async function currentOwner(cookies: { get(name: string): { value: string } | undefined }): Promise<string | null> {
  let email: string | null = null;
  if (authMode() === "local") {
    if (isDeployedEnvironment()) return null;
    email = verifySessionToken(cookies.get(SESSION_COOKIE)?.value)?.email ?? null;
  } else {
    email = await verifySupabaseToken(cookies.get(SUPABASE_TOKEN_COOKIE)?.value);
  }
  if (!email) return null;
  return ownerEmails().includes(email) ? email : null;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && isDeployedEnvironment(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
