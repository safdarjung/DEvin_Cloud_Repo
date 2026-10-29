import "server-only";
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export interface AuditEvent {
  /** Dotted lowercase, usually the action's permission name, e.g. `attendance.submit`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Json;
  after?: Json;
  metadata?: Json;
}

/**
 * 04 §D20 / D27 — intent-level audit event for a server action. Writes through
 * `public.record_audit_event`, which records the signed-in user as actor and
 * checks membership of `ctx.institution`. Never put prompt text, payloads, or
 * other free-form user content in before/after/metadata.
 * Throws AppError on failure; defineAction turns that into the envelope.
 */
export async function audit(ctx: TenantContext, event: AuditEvent): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_audit_event", {
    p_institution_id: ctx.institution.id,
    p_action: event.action,
    p_entity_type: event.entityType,
    p_entity_id: event.entityId ?? undefined,
    p_before: event.before ?? undefined,
    p_after: event.after ?? undefined,
    p_metadata: event.metadata ?? undefined,
  });

  if (error) {
    const mapped = mapSqlError(error);
    if (mapped.ok) throw new AppError("internal", "Audit event could not be recorded.");
    throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
  }
  return data;
}
