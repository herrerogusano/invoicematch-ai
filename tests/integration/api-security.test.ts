import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { setAgentModelForTests } from "@/mastra/agent";
import { createMockModel } from "@/mastra/mock-model";
import { createSessionToken, SESSION_COOKIE } from "@/server/auth";
import * as reconciliationsRoute from "@/app/api/reconciliations/route";
import * as detailRoute from "@/app/api/reconciliations/[id]/route";
import * as decisionRoute from "@/app/api/reconciliations/[id]/decision/route";
import * as reviewsRoute from "@/app/api/reviews/route";
import * as samplesRoute from "@/app/api/samples/route";
import * as loginRoute from "@/app/api/auth/login/route";
import { count, setupScratch, teardownScratch } from "./setup";

const OWNER = "owner@example.com";
let modelCalls = 0;

function countingModel(): LanguageModelV4 {
  const inner = createMockModel();
  return {
    ...inner,
    doGenerate: (o) => {
      modelCalls++;
      return inner.doGenerate(o);
    },
    doStream: (o) => {
      modelCalls++;
      return inner.doStream(o);
    },
  };
}

beforeAll(async () => {
  await setupScratch("invoicematch_test_api");
  process.env.AUTH_MODE = "local";
  process.env.OWNER_EMAILS = OWNER;
  process.env.OWNER_PASSPHRASE = "correct horse battery staple";
  process.env.SESSION_SECRET = "s".repeat(48);
  delete process.env.VERCEL;
  delete process.env.DEPLOYED;
  setAgentModelForTests(countingModel());
});
afterEach(() => {
  delete process.env.VERCEL;
});
afterAll(async () => {
  setAgentModelForTests(null);
  await teardownScratch();
});

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string; contentType?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (init.body !== undefined) headers["content-type"] = init.contentType ?? "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

const ownerCookie = () => `${SESSION_COOKIE}=${createSessionToken(OWNER)}`;
const startBody = (key: string) => ({ scenarioId: "S13-agent-selected-po", idempotencyKey: key });

describe("anonymous and spoofed requests cannot spend tokens or decide", () => {
  it("anonymous POST to run → 401 with zero LLM calls and nothing stored", async () => {
    const res = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: startBody("anon-run-key") }), ctx());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(modelCalls).toBe(0);
    expect(await count("select count(*) as n from app.reconciliations")).toBe(0);
  });

  it("anonymous POST to a decision → 401", async () => {
    const res = await decisionRoute.POST(
      req("/api/reconciliations/00000000-0000-4000-8000-000000000000/decision", { method: "POST", body: { decision: "APPROVE", reason: "anonymous try", idempotencyKey: "anon-decision" } }),
      ctx({ id: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(res.status).toBe(401);
  });

  it("forged, tampered, expired and non-allow-listed sessions are rejected", async () => {
    const valid = createSessionToken(OWNER);
    const [payload] = valid.split(".");
    const cookies = [
      `${SESSION_COOKIE}=${payload}.forgedsignature`,
      `${SESSION_COOKIE}=${Buffer.from(JSON.stringify({ email: OWNER, exp: 9999999999 })).toString("base64url")}.${valid.split(".")[1]}`,
      `${SESSION_COOKIE}=${createSessionToken(OWNER, Date.now() - 24 * 3600 * 1000)}`,
      `${SESSION_COOKIE}=${createSessionToken("attacker@example.com")}`,
    ];
    for (const cookie of cookies) {
      const res = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: startBody("spoof-run-key"), cookie }), ctx());
      expect(res.status).toBe(401);
    }
    expect(modelCalls).toBe(0);
  });

  it("local sessions are not honoured on a deployed environment", async () => {
    process.env.VERCEL = "1";
    const res = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: startBody("vercel-run-key"), cookie: ownerCookie() }), ctx());
    expect(res.status).toBe(401);
    const login = await loginRoute.POST(req("/api/auth/login", { method: "POST", body: { email: OWNER, passphrase: "correct horse battery staple" } }));
    expect(login.status).toBe(500);
    expect(modelCalls).toBe(0);
  });

  it("cross-origin mutation with a valid session → 403", async () => {
    const res = await reconciliationsRoute.POST(
      req("/api/reconciliations", { method: "POST", body: startBody("cross-origin-key"), cookie: ownerCookie(), origin: "https://evil.example" }),
      ctx(),
    );
    expect(res.status).toBe(403);
    expect(modelCalls).toBe(0);
  });

  it("owner reads are protected; public samples are not", async () => {
    expect((await reconciliationsRoute.GET(req("/api/reconciliations"), ctx())).status).toBe(401);
    expect((await reviewsRoute.GET(req("/api/reviews"), ctx())).status).toBe(401);
    expect((await detailRoute.GET(req("/api/reconciliations/x"), ctx({ id: "x" }))).status).toBe(401);
    const samples = await samplesRoute.GET();
    expect(samples.status).toBe(200);
    expect((await samples.json()).samples.length).toBeGreaterThanOrEqual(12);
  });
});

describe("owner flow over HTTP", () => {
  it("login rejects wrong passphrase and sets an HttpOnly cookie on success", async () => {
    const bad = await loginRoute.POST(req("/api/auth/login", { method: "POST", body: { email: OWNER, passphrase: "wrong passphrase!!" } }));
    expect(bad.status).toBe(401);
    const good = await loginRoute.POST(req("/api/auth/login", { method: "POST", body: { email: OWNER, passphrase: "correct horse battery staple" } }));
    expect(good.status).toBe(200);
    expect(good.headers.get("set-cookie")).toMatch(/im_session=.*HttpOnly/i);
  });

  it("validates bodies with explicit status codes", async () => {
    const wrongType = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: "x", contentType: "text/plain", cookie: ownerCookie() }), ctx());
    expect(wrongType.status).toBe(415);
    const badJson = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: "{not json", cookie: ownerCookie() }), ctx());
    expect(badJson.status).toBe(400);
    const badKey = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: { scenarioId: "S01-exact-match", idempotencyKey: "x" }, cookie: ownerCookie() }), ctx());
    expect(badKey.status).toBe(400);
    const unknown = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: { scenarioId: "S99-nope", idempotencyKey: "unknown-scenario-key" }, cookie: ownerCookie() }), ctx());
    expect(unknown.status).toBe(404);
    expect(modelCalls).toBe(0);
  });

  it("owner runs, re-submits idempotently, then decides with a reason", async () => {
    const first = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: startBody("owner-http-run"), cookie: ownerCookie(), origin: "http://localhost:3000" }), ctx());
    expect(first.status).toBe(201);
    const run = await first.json();
    expect(run.status).toBe("REVIEW_REQUIRED");
    expect(modelCalls).toBeGreaterThan(0);
    const callsAfterFirst = modelCalls;

    const again = await reconciliationsRoute.POST(req("/api/reconciliations", { method: "POST", body: startBody("owner-http-run"), cookie: ownerCookie() }), ctx());
    expect(again.status).toBe(200);
    expect((await again.json()).reconciliationId).toBe(run.reconciliationId);
    expect(modelCalls).toBe(callsAfterFirst); // no second model call

    const noReason = await decisionRoute.POST(
      req(`/api/reconciliations/${run.reconciliationId}/decision`, { method: "POST", body: { decision: "APPROVE", reason: "", idempotencyKey: "owner-http-decision" }, cookie: ownerCookie() }),
      ctx({ id: run.reconciliationId }),
    );
    expect(noReason.status).toBe(400);

    const decided = await decisionRoute.POST(
      req(`/api/reconciliations/${run.reconciliationId}/decision`, { method: "POST", body: { decision: "APPROVE", reason: "Semantic mapping checked manually", idempotencyKey: "owner-http-decision" }, cookie: ownerCookie() }),
      ctx({ id: run.reconciliationId }),
    );
    expect(decided.status).toBe(201);
    expect((await decided.json()).status).toBe("APPROVED_WITH_EXCEPTION");

    const second = await decisionRoute.POST(
      req(`/api/reconciliations/${run.reconciliationId}/decision`, { method: "POST", body: { decision: "REJECT", reason: "Changed my mind", idempotencyKey: "owner-http-decision-2" }, cookie: ownerCookie() }),
      ctx({ id: run.reconciliationId }),
    );
    expect(second.status).toBe(409);

    const detail = await detailRoute.GET(req(`/api/reconciliations/${run.reconciliationId}`, { cookie: ownerCookie() }), ctx({ id: run.reconciliationId }));
    const body = await detail.json();
    expect(body.status).toBe("APPROVED_WITH_EXCEPTION");
    expect(body.decision.reviewer).toBe(OWNER);
  });
});
