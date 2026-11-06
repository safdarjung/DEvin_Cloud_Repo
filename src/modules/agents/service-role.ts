import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";
import { AGENT_SLUGS } from "./catalog";

// M22-T7 (rulings "Writes are server-only"). `agent_definitions` /
// `agent_runs` grant no authenticated insert/update of anything other than
// `agent_definitions.is_enabled` (07 §4, 20261028000095) — this factory is
// their only server-side write path, scoped to the synchronous call like
// `withAiServiceRole` (src/lib/ai/usage.ts): never left set for the rest of
// the process, since `SERVICE_ROLE_CALLER` is a process-wide env var.
function withAgentsServiceRole<T>(fn: () => T): T {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "agents";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}

export function agentsAdmin(): SupabaseClient<Database> {
  return withAgentsServiceRole(() => createAdminClient());
}

// Materialises the catalog slugs as rows for this institution (`on
// conflict do nothing`, `is_enabled` defaults true) — no SQL slug list, no
// trigger, survives `demo:reset`. Called at the start of `agent.run`,
// `agent.definition.setEnabled` and the `agents.definitions` query.
export async function ensureAgentDefinitions(institutionId: string): Promise<void> {
  const admin = agentsAdmin();
  const { error } = await admin
    .from("agent_definitions")
    .upsert(
      AGENT_SLUGS.map((slug) => ({ institution_id: institutionId, slug })),
      { onConflict: "institution_id,slug", ignoreDuplicates: true },
    );
  if (error) throw error;
}
