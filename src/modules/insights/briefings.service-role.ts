import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";

// M25-T4 (rulings "Writes"). `briefings` has no INSERT/UPDATE policy
// (0092) — this factory is its only write path, scoped to the synchronous
// call like withAiServiceRole (src/lib/ai/usage.ts) / agents/service-role.ts:
// never left set for the rest of the process, since SERVICE_ROLE_CALLER is
// a process-wide env var. Callers (src/modules/insights/briefings.ts) check
// permission and module before ever reaching this.
function withBriefingsServiceRole<T>(fn: () => T): T {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "briefings";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}

export function briefingsAdmin(): SupabaseClient<Database> {
  return withBriefingsServiceRole(() => createAdminClient());
}
