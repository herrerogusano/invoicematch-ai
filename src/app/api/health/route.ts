import { NextResponse } from "next/server";
import { getPool } from "@/db/pool";
import { agentMode } from "@/mastra/agent";
import { langfuseConfigured } from "@/mastra";
import { authMode } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public health/status. Reports configuration presence only, never values. */
export async function GET() {
  let db: "ok" | "unavailable" = "ok";
  try {
    await getPool().query("select 1");
  } catch {
    // A paused Supabase Free project lands here; the UI shows a friendly message.
    db = "unavailable";
  }
  return NextResponse.json(
    {
      status: db === "ok" ? "ok" : "degraded",
      database: db,
      agentMode: agentMode(),
      liveModelConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      tracing: langfuseConfigured() ? "langfuse" : "disabled",
      authMode: authMode(),
    },
    { status: db === "ok" ? 200 : 503 },
  );
}
