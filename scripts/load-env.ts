import { existsSync } from "node:fs";
import path from "node:path";

/** Scripts run outside Next.js, so load .env.local the same way Next would (existing env wins). */
export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), file);
    if (existsSync(p)) {
      const before = { ...process.env };
      process.loadEnvFile(p);
      for (const [k, v] of Object.entries(before)) process.env[k] = v;
    }
  }
}
