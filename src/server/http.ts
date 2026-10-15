import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AuthError, currentOwner } from "./auth";
import { ServiceError } from "./reconciliation-service";

/** Structured JSON errors: { error: { code, message } } with an explicit HTTP status. */
export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export function handleError(err: unknown) {
  if (err instanceof AuthError) return errorResponse(err.httpStatus, err.code, err.message);
  if (err instanceof ServiceError) return errorResponse(err.httpStatus, err.code, err.message);
  if (err instanceof ZodError) return errorResponse(400, "INVALID_REQUEST", "request body failed validation", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  console.error("[api] unexpected error", (err as Error)?.message);
  return errorResponse(500, "INTERNAL_ERROR", "unexpected server error");
}

/**
 * Same-origin check for cookie-authenticated mutations (defence in depth on top of SameSite=Lax).
 * Requests without an Origin header (e.g. curl) are allowed through to the auth check, which still
 * requires a valid owner session.
 */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function requireOwner(req: NextRequest): Promise<string> {
  const owner = await currentOwner(req.cookies);
  if (!owner) throw new AuthError("UNAUTHENTICATED", 401, "owner sign-in required");
  return owner;
}

const MAX_BODY_BYTES = 32 * 1024;

export async function parseJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new ServiceError("UNSUPPORTED_MEDIA_TYPE", 415, "content-type must be application/json");
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ServiceError("PAYLOAD_TOO_LARGE", 413, "request body too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ServiceError("INVALID_JSON", 400, "request body is not valid JSON");
  }
  return schema.parse(body);
}

/** Wraps an owner-only mutation: origin check → auth → handler, all server-side. */
export function ownerMutation(handler: (req: NextRequest, owner: string, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      if (!sameOrigin(req)) return errorResponse(403, "FORBIDDEN_ORIGIN", "cross-origin request refused");
      const owner = await requireOwner(req);
      return await handler(req, owner, ctx);
    } catch (err) {
      return handleError(err);
    }
  };
}

export function ownerRead(handler: (req: NextRequest, owner: string, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const owner = await requireOwner(req);
      return await handler(req, owner, ctx);
    } catch (err) {
      return handleError(err);
    }
  };
}

/** Small per-process fixed-window limiter (best effort; the DB budget ledger is the hard guard). */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= max;
}

export function clientKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
