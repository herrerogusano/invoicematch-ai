/**
 * Minimal Langfuse public-API client for the agent benchmark (scores in, metrics out). Keys come
 * from .env.local and are never printed.
 */

export function langfuseAuth(): { baseUrl: string; auth: string } | null {
  const pk = process.env.LANGFUSE_PUBLIC_KEY;
  const sk = process.env.LANGFUSE_SECRET_KEY;
  if (!pk || !sk) return null;
  return {
    baseUrl: (process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, ""),
    auth: "Basic " + Buffer.from(`${pk}:${sk}`).toString("base64"),
  };
}

export interface ScoreInput {
  traceId: string;
  name: string;
  value: number | string;
  dataType: "NUMERIC" | "BOOLEAN" | "CATEGORICAL";
  comment?: string;
}

export async function postScores(scores: ScoreInput[], environment: string, concurrency = 4): Promise<{ ok: number; failed: number }> {
  const lf = langfuseAuth();
  if (!lf) return { ok: 0, failed: scores.length };
  let ok = 0;
  let failed = 0;
  const queue = [...scores];
  async function worker() {
    for (let s = queue.shift(); s; s = queue.shift()) {
      let sent = false;
      // Langfuse rate-limits the public API; wait as instructed and retry a few times.
      for (let attempt = 0; attempt < 6 && !sent; attempt++) {
        const res = await fetch(`${lf!.baseUrl}/api/public/scores`, {
          method: "POST",
          headers: { Authorization: lf!.auth, "Content-Type": "application/json" },
          body: JSON.stringify({ ...s, environment, source: "API" }),
        }).catch(() => null);
        if (res?.ok) sent = true;
        else if (res?.status === 429 || !res || res.status >= 500) {
          const body = res ? ((await res.json().catch(() => ({}))) as { details?: { retryAfterSeconds?: number } }) : {};
          await new Promise((r) => setTimeout(r, 1000 * Math.min(60, (body.details?.retryAfterSeconds ?? 5) + 1)));
        } else break;
      }
      if (sent) ok++;
      else failed++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { ok, failed };
}

/** GET /api/public/v2/metrics with a query object. */
export async function queryMetrics(query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const lf = langfuseAuth();
  if (!lf) throw new Error("Langfuse keys are not set");
  const url = `${lf.baseUrl}/api/public/v2/metrics?query=${encodeURIComponent(JSON.stringify(query))}`;
  const res = await fetch(url, { headers: { Authorization: lf.auth } });
  if (!res.ok) throw new Error(`Langfuse metrics ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { data?: Array<Record<string, unknown>> }).data ?? [];
}
