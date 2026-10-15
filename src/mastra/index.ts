import { Mastra } from "@mastra/core/mastra";
import { Observability } from "@mastra/observability";
import { LangfuseExporter } from "@mastra/langfuse";
import { createReconciliationAgent } from "./agent";
import { getMastraStorage } from "./storage";
import { reconciliationWorkflow } from "./workflow";

/**
 * Tracing: Langfuse is enabled only when both keys are present. Without keys no exporter is
 * registered, so nothing leaves the process; the instrumentation itself stays in place.
 */
export function langfuseConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

type Exporter = NonNullable<ConstructorParameters<typeof Observability>[0]["configs"]> extends Record<string, infer C>
  ? C extends { exporters?: Array<infer E> }
    ? E
    : never
  : never;

const extraExporters: Exporter[] = [];
/** Lets tests attach an in-memory exporter (e.g. TestExporter) before the instance is created. */
export function registerExporterForTests(exporter: Exporter): void {
  extraExporters.push(exporter);
}

function createMastra(): Mastra {
  const exporters: Exporter[] = [...extraExporters];
  if (langfuseConfigured()) {
    exporters.push(
      new LangfuseExporter({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
        environment: process.env.NODE_ENV,
        // Serverless functions may freeze after the response; flush each event.
        realtime: true,
      }),
    );
  }
  return new Mastra({
    agents: { reconciliationAgent: createReconciliationAgent() },
    workflows: { reconciliationWorkflow },
    storage: getMastraStorage(),
    ...(exporters.length
      ? { observability: new Observability({ configs: { default: { serviceName: "invoicematch-ai", exporters } } }) }
      : {}),
  });
}

const globalForMastra = globalThis as unknown as { __invoicematchMastra?: Mastra };

export function getMastra(): Mastra {
  if (!globalForMastra.__invoicematchMastra) globalForMastra.__invoicematchMastra = createMastra();
  return globalForMastra.__invoicematchMastra;
}

export function resetMastraForTests(): void {
  globalForMastra.__invoicematchMastra = undefined;
}
