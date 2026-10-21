import { loadLocalEnv } from "./load-env";

/**
 * Applies migrations, Mastra storage and the idempotent seed to the Supabase database.
 * SUPABASE_DATABASE_URL holds the session-pooler URL without a password; SUPABASE_DB_PASSWORD
 * holds the raw password, percent-encoded here so special characters need no manual escaping.
 * Never prints the password. Never runs db:reset-style deletes (the seed only upserts).
 *
 *   npm run db:cloud            → migrate + Mastra storage + seed, row counts, exposure check
 *   npm run db:cloud -- --check → connection test only
 */
loadLocalEnv();

const base = process.env.SUPABASE_DATABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!base || !password) {
  console.error("Set SUPABASE_DATABASE_URL and SUPABASE_DB_PASSWORD in .env.local");
  process.exit(2);
}
const url = new URL(base);
url.password = encodeURIComponent(password);
// Encrypted connection; Supabase's pooler certificate is not in Node's default CA store.
url.searchParams.set("sslmode", "no-verify");
process.env.DATABASE_URL = url.toString();
process.env.DB_POOL_MAX = "2";

const { getPool, closePool } = await import("../src/db/pool");
const checkOnly = process.argv.includes("--check");

try {
  const { rows } = await getPool().query("select current_user, version() as version");
  console.log(`connected to ${url.hostname} as ${rows[0].current_user} (${String(rows[0].version).split(" ").slice(0, 2).join(" ")})`);
  if (!checkOnly) {
    const { migrate } = await import("../src/db/migrate");
    const { seed } = await import("../src/db/seed");
    const { initMastraStorage, closeMastraStorage } = await import("../src/mastra/storage");
    await migrate();
    await initMastraStorage();
    console.log("mastra storage ready (schema: mastra)");
    await closeMastraStorage();
    await seed();
    const counts = await getPool().query(
      `select (select count(*) from app.suppliers) as suppliers,
              (select count(*) from app.purchase_orders) as purchase_orders,
              (select count(*) from app.reconciliations) as reconciliations`,
    );
    console.log("rows:", JSON.stringify(counts.rows[0]));
    // Supabase exposes some schemas through its public Data API. Ours must never be reachable by the
    // anon/authenticated roles; all access goes through the app's server-side checks.
    const exposed = await getPool().query(
      `select n.nspname, r.rolname from pg_namespace n cross join pg_roles r
        where n.nspname in ('app', 'mastra') and r.rolname in ('anon', 'authenticated')
          and has_schema_privilege(r.rolname, n.nspname, 'USAGE')`,
    );
    if (exposed.rowCount) throw new Error(`schemas reachable by public roles: ${JSON.stringify(exposed.rows)}`);
    console.log("security: app and mastra schemas not reachable by anon/authenticated");
  }
} catch (err) {
  console.error(`FAIL: ${(err as Error).message.replaceAll(password, "***")}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
