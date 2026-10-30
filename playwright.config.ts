import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The Playwright test process (unlike `next dev`) does not read .env.local
// itself; specs that call the Supabase admin API directly (e.g. e2e/auth.spec.ts)
// need it. Mirrors vitest.config.mts's loadDotEnvLocal.
function loadDotEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!match) continue;
    const [, key, value = ""] = match;
    if (!(key in process.env)) {
      process.env[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
}

loadDotEnvLocal();

export default defineConfig({
  testDir: "./e2e",
  // Guarded by E2E_RESET=true inside the function itself (08 §4/§7) — a
  // plain `pnpm test:e2e` locally does nothing here.
  globalSetup: "./e2e/fixtures.ts",
  fullyParallel: true,
  // Batch C: capped to what passes reliably against one local Postgres —
  // several specs (j09/j10/j11/j12, tenant-shell) build/write heavy DB
  // fixtures concurrently and collide under default parallelism (aria-label
  // duplicates, resource contention). 1 worker trades speed for determinism.
  workers: 1,
  reporter: "list",
  use: {
    // T-044 hosted checkpoint: PLAYWRIGHT_BASE_URL=<vercel url> skips the local server.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
      },
});
