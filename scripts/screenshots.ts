/**
 * Captures real screenshots of a running local app (no mock images) with the locally installed
 * Chrome/Edge via playwright-core. Also acts as a browser smoke test of the owner flow.
 *
 *   BASE_URL=http://localhost:3100 npx tsx scripts/screenshots.ts
 *
 * Requires OWNER_EMAILS / OWNER_PASSPHRASE in .env.local. Writes docs/screenshots/*.png.
 */
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright-core";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";
const email = (process.env.OWNER_EMAILS ?? "").split(",")[0]!.trim();
const passphrase = process.env.OWNER_PASSPHRASE ?? "";

async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`saved ${OUT}/${name}.png`);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chrome", headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(`${BASE}/`);
  await shot(desktop, "01-landing");
  await desktop.goto(`${BASE}/samples/S02-quantity-mismatch`);
  await shot(desktop, "02-sample-quantity-mismatch");

  // Owner pages without a session must redirect to /login.
  await desktop.goto(`${BASE}/owner`);
  if (!desktop.url().endsWith("/login")) throw new Error(`expected redirect to /login, got ${desktop.url()}`);

  await desktop.fill("input[name=email]", email);
  await desktop.fill("input[name=passphrase]", passphrase);
  await desktop.getByRole("button", { name: "Sign in" }).click();
  await desktop.waitForURL(`${BASE}/owner`);
  await shot(desktop, "03-owner-console");

  // Run a scenario that needs the agent and the review gate.
  const row = desktop.locator("li", { hasText: "PO selected by the agent" });
  await row.getByRole("button", { name: "Run reconciliation" }).click();
  await desktop.waitForURL(/\/owner\/reconciliations\//, { timeout: 60_000 });
  await desktop.getByRole("heading", { name: "Review required" }).waitFor();
  await shot(desktop, "04-review-required");

  await desktop.fill("textarea", "Licence and support lines checked against the signed quote");
  await desktop.getByRole("button", { name: "Approve exception" }).click();
  await desktop.getByText("APPROVED WITH EXCEPTION").first().waitFor({ timeout: 60_000 });
  await desktop.reload();
  await desktop.getByText("DECISION_RECORDED").waitFor();
  await shot(desktop, "05-approved-audit-trail");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobile.goto(`${BASE}/samples/S13-agent-selected-po`);
  await shot(mobile, "06-mobile-sample");
} finally {
  await browser.close();
}
