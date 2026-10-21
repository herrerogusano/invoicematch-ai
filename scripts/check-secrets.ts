/**
 * Fails if tracked files contain secret-looking values or if any .env file other than .env.example
 * is tracked. Runs in CI and before every commit/push in this project.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS: Array<[string, RegExp]> = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["Langfuse secret key", /sk-lf-[A-Za-z0-9-]{20,}/],
  ["Langfuse public key", /pk-lf-[A-Za-z0-9-]{20,}/],
  ["JWT / Supabase key", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ["Postgres URL with password (non-local)", /postgres(?:ql)?:\/\/[^:\s"']+:[^@\s"']+@(?!localhost|127\.0\.0\.1|postgres[:/])[^\s"']+/],
  ["Private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["Vercel token", /vercel_[A-Za-z0-9]{20,}/i],
];

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const problems: string[] = [];

for (const f of files) {
  const base = f.split("/").at(-1)!;
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") problems.push(`${f}: tracked env file`);
  if (/\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(f) || f === "package-lock.json") continue;
  let text: string;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const [name, re] of PATTERNS) {
    if (re.test(text) && f !== "scripts/check-secrets.ts") problems.push(`${f}: possible ${name}`);
  }
}

if (problems.length) {
  console.error("secret check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`secret check passed (${files.length} tracked files scanned)`);
