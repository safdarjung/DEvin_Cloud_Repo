// M23-T10 — queues an agent_runs row from a workflow node (M23-tasks.md
// rulings "Agent queue"). Plain-node safe: the workflow engine and the
// runner import this without any Next.js module; value imports stay
// relative, type-only imports may use `@/`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { AGENT_CATALOG_VERSION, AGENT_SLUGS, CUSTOM_AGENT_SLUG_RE, type AgentSlug } from "./catalog.ts";

const POSTGRES_UNIQUE_VIOLATION = "23505";

export interface QueueWorkflowAgentRunInput {
  institutionId: string;
  slug: string;
  task: string;
  requestedBy: string;
  workflowRunId: string;
}

export type QueueWorkflowAgentRunResult =
  | { status: "queued"; runId: string; created: boolean }
  | { status: "disabled" }
  /** A custom agent (0134) that was archived or never existed in this institution. */
  | { status: "missing" };

function isAgentSlug(slug: string): slug is AgentSlug {
  return (AGENT_SLUGS as readonly string[]).includes(slug);
}

/** Queues (or finds) the one `agent_runs` row a workflow's agent node owns for its run (idempotent: `agent_runs_workflow_agent_key`). */
export async function queueWorkflowAgentRun(
  admin: SupabaseClient<Database>,
  input: QueueWorkflowAgentRunInput,
): Promise<QueueWorkflowAgentRunResult> {
  const custom = CUSTOM_AGENT_SLUG_RE.test(input.slug);
  if (!custom && !isAgentSlug(input.slug)) {
    throw new Error("invalid_agent");
  }

  // shortcut: duplicates ensureAgentDefinitions' upsert because the runner cannot import @/; merge when service-role.ts becomes plain-node safe
  const { error: upsertError } = await admin
    .from("agent_definitions")
    .upsert(
      AGENT_SLUGS.map((slug) => ({ institution_id: input.institutionId, slug })),
      { onConflict: "institution_id,slug", ignoreDuplicates: true },
    );
  if (upsertError) throw upsertError;

  // A custom agent runs as its base narrowed to its own scope; agent.start
  // (runTarget) enforces that and the base being on when the run starts.
  const { data: definition, error: defError } = await admin
    .from("agent_definitions")
    .select("id, is_enabled, archived_at")
    .eq("institution_id", input.institutionId)
    .eq("slug", input.slug)
    .maybeSingle();
  if (defError) throw defError;
  if (!definition) {
    if (custom) return { status: "missing" };
    throw new Error("agent_definition_missing");
  }
  if (definition.archived_at) return { status: "missing" };
  if (!definition.is_enabled) return { status: "disabled" };

  const { data: inserted, error: insertError } = await admin
    .from("agent_runs")
    .insert({
      institution_id: input.institutionId,
      agent_id: definition.id,
      workflow_run_id: input.workflowRunId,
      task: input.task,
      requested_by: input.requestedBy,
      status: "queued",
      risk_class: "read_only",
      catalog_version: AGENT_CATALOG_VERSION,
    })
    .select("id")
    .single();

  if (!insertError) {
    return { status: "queued", runId: inserted.id as string, created: true };
  }
  // Partial unique index agent_runs_workflow_agent_key (0096) has no
  // non-partial twin, so PostgREST's on_conflict can't target it (Postgres
  // only infers a predicate-less arbiter from a bare column list) — insert
  // and recover from the 23505 instead (same pattern as the actions' named-
  // constraint 23505 mapping).
  if ((insertError as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION) throw insertError;

  const { data: existing, error: readError } = await admin
    .from("agent_runs")
    .select("id")
    .eq("workflow_run_id", input.workflowRunId)
    .eq("agent_id", definition.id)
    .single();
  if (readError) throw readError;
  return { status: "queued", runId: existing.id as string, created: false };
}
