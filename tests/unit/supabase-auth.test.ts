import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSessionToken, currentOwner, SESSION_COOKIE } from "@/server/auth";
import { pkceChallenge, PKCE_COOKIE } from "@/server/supabase-auth";
import * as magicLinkRoute from "@/app/api/auth/magic-link/route";
import * as callbackRoute from "@/app/auth/callback/route";

const OWNER = "owner@example.com";
const SUPABASE = "https://project-ref.supabase.co";

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": init.ip ?? "10.0.0.1" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const cookieJar = (res: Response) => ({
  get: (name: string) => {
    const m = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
    const value = m?.split(";")[0]?.slice(name.length + 1);
    return value ? { value } : undefined;
  },
});

let fetchMock: ReturnType<typeof vi.fn>;
let ipCounter = 0;
const nextIp = () => `10.0.1.${++ipCounter}`;

beforeEach(() => {
  process.env.AUTH_MODE = "supabase";
  process.env.OWNER_EMAILS = OWNER;
  process.env.SESSION_SECRET = "s".repeat(48);
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
  delete process.env.VERCEL;
  delete process.env.DEPLOYED;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.AUTH_MODE = "local";
});

describe("magic-link request", () => {
  it("sends a PKCE magic link for an allow-listed owner and keeps the verifier in an HttpOnly cookie", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await magicLinkRoute.POST(req("/api/auth/magic-link", { method: "POST", body: { email: " Owner@Example.com " }, ip: nextIp() }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SUPABASE}/auth/v1/otp?redirect_to=${encodeURIComponent("http://localhost:3000/auth/callback")}`);
    const sent = JSON.parse(String(init.body));
    expect(sent.email).toBe(OWNER);
    expect(sent.code_challenge_method).toBe("s256");

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${PKCE_COOKIE}=`))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/auth\/callback/);
    const verifier = cookieJar(res).get(PKCE_COOKIE)!.value;
    expect(sent.code_challenge).toBe(pkceChallenge(verifier));
  });

  it("answers identically for a non-owner email without contacting Supabase", async () => {
    const res = await magicLinkRoute.POST(req("/api/auth/magic-link", { method: "POST", body: { email: "intruder@example.com" }, ip: nextIp() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cookieJar(res).get(PKCE_COOKIE)).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses cross-origin requests, local mode, and bursts", async () => {
    const cross = await magicLinkRoute.POST(req("/api/auth/magic-link", { method: "POST", body: { email: OWNER }, origin: "https://evil.example", ip: nextIp() }));
    expect(cross.status).toBe(403);

    process.env.AUTH_MODE = "local";
    const local = await magicLinkRoute.POST(req("/api/auth/magic-link", { method: "POST", body: { email: OWNER }, ip: nextIp() }));
    expect(local.status).toBe(404);
    process.env.AUTH_MODE = "supabase";

    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const ip = nextIp();
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await magicLinkRoute.POST(req("/api/auth/magic-link", { method: "POST", body: { email: OWNER }, ip }))).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("magic-link callback", () => {
  const tokenResponse = (email: string) => new Response(JSON.stringify({ access_token: "x", user: { email } }), { status: 200 });

  it("exchanges the code with the stored verifier and issues an owner session", async () => {
    fetchMock.mockResolvedValue(tokenResponse(OWNER));
    const res = await callbackRoute.GET(req("/auth/callback?code=abc123", { cookie: `${PKCE_COOKIE}=verifier-value` }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/owner");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SUPABASE}/auth/v1/token?grant_type=pkce`);
    expect(JSON.parse(String(init.body))).toEqual({ auth_code: "abc123", code_verifier: "verifier-value" });
    expect(await currentOwner(cookieJar(res))).toBe(OWNER);
  });

  it("does not create a session for a verified email that is not an owner", async () => {
    fetchMock.mockResolvedValue(tokenResponse("someone@example.com"));
    const res = await callbackRoute.GET(req("/auth/callback?code=abc123", { cookie: `${PKCE_COOKIE}=v` }));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=forbidden");
    expect(cookieJar(res).get(SESSION_COOKIE)).toBeUndefined();
  });

  it("rejects a missing verifier, a missing code, or a code Supabase refuses", async () => {
    const noVerifier = await callbackRoute.GET(req("/auth/callback?code=abc123"));
    expect(noVerifier.headers.get("location")).toContain("error=link");
    const noCode = await callbackRoute.GET(req("/auth/callback", { cookie: `${PKCE_COOKIE}=v` }));
    expect(noCode.headers.get("location")).toContain("error=link");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }));
    const refused = await callbackRoute.GET(req("/auth/callback?code=bad", { cookie: `${PKCE_COOKIE}=v` }));
    expect(refused.headers.get("location")).toContain("error=link");
    expect(cookieJar(refused).get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("sessions are bound to the sign-in method", () => {
  it("rejects a local-passphrase session in supabase mode and vice versa", async () => {
    const local = createSessionToken(OWNER, Date.now(), "local");
    const supa = createSessionToken(OWNER, Date.now(), "supabase");
    const jar = (v: string) => ({ get: (n: string) => (n === SESSION_COOKIE ? { value: v } : undefined) });
    expect(await currentOwner(jar(local))).toBeNull();
    expect(await currentOwner(jar(supa))).toBe(OWNER);
    process.env.AUTH_MODE = "local";
    expect(await currentOwner(jar(supa))).toBeNull();
    expect(await currentOwner(jar(local))).toBe(OWNER);
  });

  it("keeps accepting supabase sessions on a deployed environment", async () => {
    process.env.VERCEL = "1";
    try {
      const supa = createSessionToken(OWNER, Date.now(), "supabase");
      expect(await currentOwner({ get: () => ({ value: supa }) })).toBe(OWNER);
    } finally {
      delete process.env.VERCEL;
    }
  });
});
