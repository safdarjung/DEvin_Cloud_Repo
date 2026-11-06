"use server";

// X07-T5 — visitors.gatePass.create / visitors.gatePass.setStatus
// (X07-tasks.md Task 5 rulings; migration 0090's gate_passes table +
// gate_pass_before_insert / guard_gate_passes_update triggers, built in T2).
// Mapping style mirrors src/modules/facilities/actions.ts
// (throwMapped/isUniqueViolation/isRlsViolation).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  GatePassCreateSchema,
  GatePassSetStatusSchema,
  GATE_PASS_STATUSES,
  type GatePassCreateInput,
  type GatePassSetStatusInput,
} from "@/modules/visitors/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_RLS_VIOLATION = "42501";
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";

type GatePassStatus = (typeof GATE_PASS_STATUSES)[number];

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function pgCode(error: unknown): string | undefined {
  return error && typeof error === "object" ? (error as { code?: string }).code : undefined;
}

export const createGatePass = defineAction({
  name: "visitors.gatePass.create",
  module: "visitors",
  schema: GatePassCreateSchema,
  permission: "gatepass.manage",
  handler: async ({ studentId, reason, guardianId, pickupPersonId }: GatePassCreateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("gate_passes")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        reason,
        guardian_id: guardianId ?? null,
        pickup_person_id: pickupPersonId ?? null,
        // NOT NULL columns with no DB default — app.gate_pass_before_insert
        // (0090) always overwrites these before the row is written
        // (collector_* unconditionally; requested_by whenever the caller
        // isn't service_role/postgres, i.e. always for this real-user
        // server action). Placeholders only to satisfy the Insert type.
        collector_name: "",
        collector_relation: "",
        requested_by: ctx.user.id,
      })
      .select("id, status")
      .single();
    if (error) {
      const code = pgCode(error);
      if (code === POSTGRES_UNIQUE_VIOLATION) {
        throw new AppError("conflict", "Student already has an open gate pass.", {
          studentId: ["Student already has an open gate pass."],
        });
      }
      if (code === POSTGRES_RLS_VIOLATION) {
        throw new AppError("forbidden", "You do not have permission to perform this action.");
      }
      if (code === POSTGRES_FOREIGN_KEY_VIOLATION) {
        throw new AppError("not_found", "Student, guardian or pickup person not found.");
      }
      throwMapped(error);
    }

    await audit(ctx, {
      action: "visitors.gate_pass.create",
      entityType: "gate_pass",
      entityId: data.id,
      after: { status: data.status },
    });

    return { id: data.id as string, status: data.status as GatePassStatus };
  },
});

export const setGatePassStatus = defineAction({
  name: "visitors.gatePass.setStatus",
  module: "visitors",
  schema: GatePassSetStatusSchema,
  permission: "gatepass.manage",
  handler: async ({ id, status }: GatePassSetStatusInput, ctx) => {
    const supabase = await createClient();
    const { data: existing, error: readError } = await supabase
      .from("gate_passes")
      .select("id, status")
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!existing) throw new AppError("not_found", "Gate pass not found.");

    // One UPDATE; the DB guard (app.guard_gate_passes_update, 0090) enforces
    // the status transition table and raises `code:invalid_state` for an
    // illegal move — mapSqlError below turns that straight into the envelope.
    const { data, error } = await supabase
      .from("gate_passes")
      .update({ status })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id, status")
      .maybeSingle();
    if (error) {
      if (pgCode(error) === POSTGRES_RLS_VIOLATION) {
        throw new AppError("forbidden", "You do not have permission to perform this action.");
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Gate pass not found.");

    await audit(ctx, {
      action: "visitors.gate_pass.set_status",
      entityType: "gate_pass",
      entityId: data.id,
      before: { status: existing.status },
      after: { status: data.status },
    });

    return { id: data.id as string, status: data.status as GatePassStatus };
  },
});
