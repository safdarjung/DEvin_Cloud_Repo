import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Vitest's Node environment does not read .env.local the way `next dev` does;
// load it into process.env so tests/db and tests/security see SUPABASE_DB_URL etc.
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
// M17-T1: tests never send real mail — stub it back in per test with vi.stubEnv.
delete process.env.RESEND_API_KEY;

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only`'s real module throws unless the bundler sets the
      // `react-server` condition (Next.js does; Vitest doesn't) — see
      // tests/setup/server-only-mock.ts.
      "server-only": path.resolve(import.meta.dirname, "tests/setup/server-only-mock.ts"),
    },
  },
  test: {
    globalSetup: ["./tests/setup/global.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          // tests/db/seed-determinism.test.ts resets + reseeds the shared
          // `st-josephs-demo` tenant in place; run db test files one at a
          // time so no other file reads it mid-reseed (Vitest's documented
          // fix for suites that share a live resource).
          fileParallelism: false,
          // M16 gate: fixtures that call admin.auth.admin.createUser (bcrypt
          // hashing, e.g. createTestInstitution/withTwoInstitutions) are
          // consistently ~5s under full sequential suite load, flaking past
          // Vitest's 5s default. Raise the db project's floor instead of
          // patching each test file as it turns up (rls-performance.test.ts
          // already sets its own higher per-test override for a different,
          // query-latency reason).
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: "security",
          environment: "node",
          // T-042: `pnpm test:security` runs every 07 §6 C-id. Ids already
          // proven by a unit/db file are run from that file, not duplicated.
          include: [
            "tests/security/**/*.test.ts",
            "tests/unit/permissions.test.ts", // C-03 matrix snapshot
            "tests/unit/ai-policy.test.ts", // C-62, C-63
            "tests/unit/ai-gateway.test.ts", // C-62, C-63
            "tests/db/website-schema.test.ts", // C-80
            "tests/db/public-enquiry-route.test.ts", // C-81, C-83
            "tests/db/demo-reset.test.ts", // C-04 (SQL guard)
          ],
        },
      },
    ],
  },
});
