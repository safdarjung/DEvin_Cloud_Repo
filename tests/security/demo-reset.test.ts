import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 07 §6 C-04 (T-042). The SQL guard (`app.demo_reset` refuses a non-demo
// institution) is proven in tests/db/demo-reset.test.ts, run by this project
// too (vitest.config.mts). This covers the other half: the CLI refuses to run
// without DEMO_RESET_ALLOWED=true, before it reads any credentials.
describe("C-04: demo:reset refuses without the env flag", () => {
  it.each([undefined, "false", "1"])("DEMO_RESET_ALLOWED=%s exits 1 and touches nothing", (flag) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.DEMO_RESET_ALLOWED;
    if (flag !== undefined) env.DEMO_RESET_ALLOWED = flag;
    // No DB URL either: proves the flag check runs first.
    delete env.SUPABASE_DB_URL;

    const run = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/demo-reset.ts")], { env, encoding: "utf8" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("DEMO_RESET_ALLOWED");
  });
});
