import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export interface AttentionJobRow {
  id: string;
  type: string;
  status: "queued" | "dead";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string;
}

/**
 * Jobs an admin should look at: dead-lettered, or queued again after a
 * failure (06 §W12 backoff) — i.e. anything with a recorded `last_error`.
 * Uses the signed-in user client, not the service-role client: RLS
 * (`jobs_select`, 07 §4) already limits this to the caller's institution,
 * and the explicit `institution_id` filter below is defense in depth
 * (CLAUDE.md rule 1).
 */
export async function listAttentionJobs(ctx: TenantContext): Promise<AttentionJobRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, type, status, attempts, max_attempts, last_error, updated_at")
    .eq("institution_id", ctx.institution.id)
    .not("last_error", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status as AttentionJobRow["status"],
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  }));
}
