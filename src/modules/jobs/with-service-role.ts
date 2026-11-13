import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Only imported by `src/app/api/jobs/run/route.ts`, `src/modules/content/actions.ts`
// (in-request run of a book's own content.extract job, after its permission check),
// `src/modules/safety/actions.ts` (in-request `runJobNow` of the alert's own
// job, after the action's permission check) and
// `src/modules/workflows/actions.ts` (same, for the run's own workflow.run
// job after start_workflow_run / decide_workflow_run) — never by
// `scripts/jobs-run.ts` or anything `runner.ts` itself needs, because this
// file uses `server-only` and the `@/` alias, neither of which resolve
// under plain Node (see the header comment in `runner.ts`).
//
// T-035 lesson (07 §4): `createAdminClient()` is guarded by
// `SERVICE_ROLE_CALLER`, but that guard is a process-wide env var. Setting
// it and never unsetting it (as T-035 originally did) unlocks the service
// role for every later caller in this server process. Scope it to this
// synchronous factory call only, exactly like `withAiServiceRole`
// (src/lib/ai/usage.ts) — the CLI script may set it once at process start
// instead (its own process, never shared with another request).
export function withJobsServiceRole<T>(fn: () => T): T {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "jobs";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}

export function createJobsAdminClient() {
  return withJobsServiceRole(() => createAdminClient());
}
