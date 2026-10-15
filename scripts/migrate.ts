import { loadLocalEnv } from "./load-env";
loadLocalEnv();

const { migrate } = await import("../src/db/migrate");
const { initMastraStorage } = await import("../src/mastra/storage");
const { closePool } = await import("../src/db/pool");

try {
  await migrate();
  await initMastraStorage();
  console.log("mastra storage ready (schema: mastra)");
} finally {
  await closePool();
}
