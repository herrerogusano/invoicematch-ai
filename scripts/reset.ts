import { loadLocalEnv } from "./load-env";
loadLocalEnv();

const { databaseUrl, getPool, closePool, isLocalDatabaseUrl } = await import("../src/db/pool");

// Destructive: refuses anything that is not an obviously local database.
const url = databaseUrl();
if (!isLocalDatabaseUrl(url) || process.env.NODE_ENV === "production") {
  console.error("db:reset refused: DATABASE_URL is not a local database (or NODE_ENV=production).");
  process.exit(1);
}

const { migrate } = await import("../src/db/migrate");
const { seed } = await import("../src/db/seed");
const { initMastraStorage } = await import("../src/mastra/storage");

try {
  await getPool().query("drop schema if exists app cascade; drop schema if exists mastra cascade;");
  console.log("dropped schemas app, mastra");
  await migrate();
  await initMastraStorage();
  await seed();
} finally {
  await closePool();
}
