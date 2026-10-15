import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Owner authentication. Two adapters behind one interface:
 *
 * - local:    passphrase login → HMAC-signed, HttpOnly session cookie. Refused on deployed
 *             environments (VERCEL or DEPLOYED set), where only Supabase Auth is allowed.
 * - supabase: Supabase Auth magic link (PKCE, see supabase-auth.ts) proves the email; the app
 *             then issues the same kind of signed session cookie, tagged with how it was obtained.
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
  /** Sign-in method; a session is only valid while AUTH_MODE matches it. */
  via: AuthMode;
}

export function createSessionToken(email: string, now = Date.now(), via: AuthMode = "local"): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS, via })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof s.email !== "string" || typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    if (s.via !== "local" && s.via !== "supabase") return null;
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

/** Resolves the current owner from request cookies, or null if not signed in. Fails closed. */
export async function currentOwner(cookies: { get(name: string): { value: string } | undefined }): Promise<string | null> {
  const mode = authMode();
  if (mode === "local" && isDeployedEnvironment()) return null;
  const session = verifySessionToken(cookies.get(SESSION_COOKIE)?.value);
  // A session minted by one sign-in method is not accepted after switching AUTH_MODE.
  if (!session || session.via !== mode) return null;
  return ownerEmails().includes(session.email) ? session.email : null;
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
