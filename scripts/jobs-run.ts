import { createScriptAdminClient } from "./lib/admin-client.ts";
import { createRunnerPorts, runOnceCore } from "../src/modules/jobs/runner.ts";

// Own process: setting SERVICE_ROLE_CALLER once here is fine (unlike the
// Next server, this process never serves another caller) — see
// src/modules/jobs/with-service-role.ts and 07 §4.
process.env.SERVICE_ROLE_CALLER = "jobs";

async function runLoop(loop: boolean): Promise<void> {
  const admin = createScriptAdminClient();
  const ports = createRunnerPorts(admin);
  const workerId = `cli-${process.pid}-${crypto.randomUUID()}`;

  do {
    const startedAt = Date.now();
    const summary = await runOnceCore({ workerId }, ports);
    console.log(
      `claimed ${summary.claimed} · succeeded ${summary.succeeded} · requeued ${summary.requeued} · dead ${summary.dead} (${Date.now() - startedAt}ms)`,
    );
    if (loop) await new Promise((resolve) => setTimeout(resolve, 5_000));
  } while (loop);
}

runLoop(process.argv.includes("--loop")).catch((err: unknown) => {
  console.error("jobs:run failed:", err);
  process.exit(1);
});
