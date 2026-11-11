"use server";

// behaviour.incident.log / behaviour.incident.void (migration 0113). Insert goes
// through RLS (teacher: taught students only; guard forces reported_by); void only
// through public.void_behaviour_incident. Behaviour is welfare data: not AI-draftable (§E).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { IncidentLogSchema, IncidentVoidSchema, type IncidentLogInput, type IncidentVoidInput } from "./schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const logIncident = defineAction({
  name: "behaviour.incident.log",
  module: "behaviour",
  schema: IncidentLogSchema,
  permission: "behaviour.write",
  handler: async ({ studentId, category, severity, points, note, occurredOn }: IncidentLogInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("behaviour_incidents")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        category,
        severity,
        points,
        note: note ?? null,
        ...(occurredOn ? { occurred_on: occurredOn } : {}),
        reported_by: ctx.user.id, // guard overwrites; RLS checks it
      })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === POSTGRES_RLS_VIOLATION) {
        throw new AppError("forbidden", "You can only log incidents for students you teach.");
      }
      throwMapped(error);
    }
    await audit(ctx, {
      action: "behaviour.incident.log",
      entityType: "behaviour_incidents",
      entityId: data.id,
      after: { studentId, severity, points },
    });
    return { id: data.id as string };
  },
});

export const voidIncident = defineAction({
  name: "behaviour.incident.void",
  module: "behaviour",
  schema: IncidentVoidSchema,
  permission: "behaviour.write",
  // The definer writes its own audit row (ids only).
  handler: async ({ incidentId, reason }: IncidentVoidInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("void_behaviour_incident", { p_incident_id: incidentId, p_reason: reason });
    if (error) throwMapped(error);
    return { id: data.id as string };
  },
});
