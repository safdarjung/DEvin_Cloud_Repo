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
        },
      },
      {
        extends: true,
        test: {
          name: "security",
          environment: "node",
          include: ["tests/security/**/*.test.ts"],
        },
      },
    ],
  },
});
