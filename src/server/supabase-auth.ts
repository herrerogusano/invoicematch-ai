import { createHash, randomBytes } from "node:crypto";
import { AuthError } from "./auth";

/**
 * Supabase Auth magic link with PKCE, called over REST from the server (no client SDK). Supabase
 * only proves that the owner controls the email address; after the code exchange the app issues
 * its own signed session cookie, so no Supabase token is stored or refreshed.
 *
 * Contract (matches supabase-js signInWithOtp / exchangeCodeForSession):
 *   POST {url}/auth/v1/otp?redirect_to=…           { email, create_user, code_challenge, code_challenge_method: "s256" }
 *   POST {url}/auth/v1/token?grant_type=pkce        { auth_code, code_verifier }
 */

export const PKCE_COOKIE = "im_pkce";
export const PKCE_TTL_SECONDS = 10 * 60;

function config(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new AuthError("AUTH_MISCONFIGURED", 500, "Supabase Auth is not configured");
  return { url, anonKey };
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Asks Supabase to email a magic link that returns to `redirectTo` with a one-time `code`. */
export async function sendMagicLink(email: string, redirectTo: string, challenge: string): Promise<void> {
  const { url, anonKey } = config();
  const res = await fetch(`${url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    // apikey only: new publishable keys (sb_publishable_…) are not JWTs and must not be sent as Bearer.
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, create_user: true, code_challenge: challenge, code_challenge_method: "s256" }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase /otp returned ${res.status}`);
}

/** Exchanges the callback code for the verified email address, or null if Supabase refuses it. */
export async function exchangeCodeForEmail(code: string, verifier: string): Promise<string | null> {
  const { url, anonKey } = config();
  const res = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    // apikey only: new publishable keys (sb_publishable_…) are not JWTs and must not be sent as Bearer.
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { user?: { email?: string; email_confirmed_at?: string | null } };
  const email = body.user?.email?.trim().toLowerCase();
  return email || null;
}
