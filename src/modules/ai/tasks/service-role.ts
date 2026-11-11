import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";

// Orb task bridge (0143, security review): ai_proposals grants authenticated no
// UPDATE, so a creator cannot mark a card approved or re-open an in-flight claim
// over PostgREST. proposals.ts writes every status change through this client,
// only after reading the row under the caller's own RLS, and always filters by
// id + institution_id + created_by + the expected status. Scoped to the
// synchronous call like agents/service-role.ts (SERVICE_ROLE_CALLER is process-wide).
function withOrbTasksServiceRole<T>(fn: () => T): T {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "orb_tasks";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}

export function orbTasksAdmin(): SupabaseClient<Database> {
  return withOrbTasksServiceRole(() => createAdminClient());
}
