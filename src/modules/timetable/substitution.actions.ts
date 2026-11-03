"use server";

// M08-T9 — timetable.substitution.assign / timetable.substitution.cancel
// (M08-tasks.md rulings "substitutions"; migration 0070 part 2). Thin RPC
// wrappers over `assign_substitution`/`cancel_substitution`, which already
// enforce every check and audit (`substitution.assigned`/`.cancelled`)
// themselves — mirrors timetable.publish in actions.ts (no extra audit call
// here). The RPC's own pre-checks raise `code:conflict` for a double-booked
// substitute before ever reaching the unique indexes; a raw 23505 on them is
// only the race-condition backstop. Both name `fieldErrors.substituteId`.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import {
  SubstitutionAssignSchema,
  SubstitutionCancelSchema,
  type SubstitutionAssignInput,
  type SubstitutionCancelInput,
} from "@/modules/timetable/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_RLS_VIOLATION = "42501";

function pgErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** assign_substitution's own mapping: 42501/23505 plus the RPC's pre-check
 *  `code:conflict` (double-booked substitute, checked before the unique
 *  indexes) all name `fieldErrors.substituteId`. */
function throwAssignMapped(error: unknown): never {
  if (pgErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
    throw new AppError("conflict", "This teacher is already booked for that date and period.", {
      substituteId: ["Already booked for this date and period."],
    });
  }
  if (pgErrorCode(error) === POSTGRES_RLS_VIOLATION) {
    throw new AppError("forbidden", "You do not have permission to perform this action.");
  }
  const mapped = mapSqlError(error);
  if (!mapped.ok && mapped.error.code === "conflict") {
    throw new AppError("conflict", mapped.error.message, { substituteId: [mapped.error.message] });
  }
  throwMapped(error);
}

interface SubstitutionRow {
  id: string;
  slot_id: string;
  date: string;
  period_id: string;
  original_teacher_id: string;
  substitute_teacher_id: string;
  status: "assigned" | "cancelled";
}

function toSubstitution(data: SubstitutionRow) {
  return {
    id: data.id,
    slotId: data.slot_id,
    date: data.date,
    periodId: data.period_id,
    originalTeacherId: data.original_teacher_id,
    substituteTeacherId: data.substitute_teacher_id,
    status: data.status,
  };
}

export const assignSubstitution = defineAction({
  name: "timetable.substitution.assign",
  module: "substitution",
  schema: SubstitutionAssignSchema,
  permission: "timetable.manage",
  handler: async ({ slotId, date, substituteId, leaveRequestId, note }: SubstitutionAssignInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("assign_substitution", {
      p_slot_id: slotId,
      p_date: date,
      p_substitute_id: substituteId,
      p_leave_request_id: leaveRequestId,
      p_note: note,
    });
    if (error) throwAssignMapped(error);
    return toSubstitution(data as SubstitutionRow);
  },
});

export const cancelSubstitution = defineAction({
  name: "timetable.substitution.cancel",
  module: "substitution",
  schema: SubstitutionCancelSchema,
  permission: "timetable.manage",
  handler: async ({ substitutionId }: SubstitutionCancelInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cancel_substitution", { p_substitution_id: substitutionId });
    if (error) {
      if (pgErrorCode(error) === POSTGRES_RLS_VIOLATION) {
        throw new AppError("forbidden", "You do not have permission to perform this action.");
      }
      throwMapped(error);
    }
    return toSubstitution(data as SubstitutionRow);
  },
});
