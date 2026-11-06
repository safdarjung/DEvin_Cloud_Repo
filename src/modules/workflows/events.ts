// M23-T14 — called by a notify.* job handler after its own domain checks,
// before its recipient early-returns (rulings §Events). `@/` imports here
// are type-only and erased at build (src/modules/reports/sources.ts
// precedent), so this stays plain-node safe for the job runner.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { WorkflowEventKey } from "./catalog.ts";

export async function emitWorkflowEvent(
  admin: SupabaseClient<Database>,
  institutionId: string,
  event: WorkflowEventKey,
  entityId: string,
): Promise<number> {
  const { data, error } = await admin.rpc("emit_workflow_event", {
    p_institution_id: institutionId,
    p_event: event,
    p_entity_id: entityId,
  });
  // Error → throw, so the job retries (at-least-once, rulings §Events).
  if (error) throw error;
  return data ?? 0;
}
