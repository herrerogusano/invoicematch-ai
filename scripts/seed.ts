import { loadLocalEnv } from "./load-env";
loadLocalEnv();

const { seed } = await import("../src/db/seed");
const { closePool } = await import("../src/db/pool");

try {
  await seed();
} finally {
  await closePool();
}
