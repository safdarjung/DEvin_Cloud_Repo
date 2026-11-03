"use server";

// M14-T6 — lifecycle.promote / lifecycle.transfer / lifecycle.withdraw.
// Thin RPC wrappers (timetable/actions.ts's publishVersion style): the 0076
// definers already raise code:unauthenticated/forbidden/not_found/
// validation_failed/invalid_state (mapped by mapSqlError below) and write
// their own audit row, so no extra handling or TS-side audit duplicate here.
//
// LANE B NOTE (M14-tasks.md top-of-file controller ruling): this tree
// predates MOD, so no `module: "student_lifecycle"` field is passed to
// defineAction and no ModuleKey registry line is touched — MOD's retrofit
// adds both after the merge.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import {
  PromoteSchema,
  TransferSchema,
  WithdrawSchema,
  type PromoteInput,
  type TransferInput,
  type WithdrawInput,
} from "@/modules/lifecycle/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** Both RPCs return jsonb — the generated `Json` type carries no field names; narrow once at the boundary (admissions/actions.ts's asJsonRecord precedent). */
function asJsonRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new AppError("internal", "Unexpected response shape.");
  }
  return data as Record<string, unknown>;
}

export const promote = defineAction({
  name: "lifecycle.promote",
  module: "student_lifecycle",
  schema: PromoteSchema,
  permission: "academics.manage",
  handler: async ({ fromYearId, toYearId, mappings, overrides, exclude }: PromoteInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("promote_students", {
      p_from_year_id: fromYearId,
      p_to_year_id: toYearId,
      p_mappings: mappings.map((m) => ({ from_section_id: m.fromSectionId, to_section_id: m.toSectionId })),
      p_overrides: (overrides ?? []).map((o) => ({ student_id: o.studentId, to_section_id: o.toSectionId })),
      p_exclude: exclude ?? [],
    });
    if (error) throwMapped(error);

    const result = asJsonRecord(data);
    return {
      batchId: result.batch_id as string,
      promoted: result.promoted as number,
      graduated: result.graduated as number,
      skippedStudentIds: (result.skipped_student_ids as string[]) ?? [],
    };
  },
});

async function exitStudent(kind: "transferred_out" | "withdrawn", input: TransferInput | WithdrawInput) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exit_student", {
    p_student_id: input.studentId,
    p_kind: kind,
    p_reason: input.reason,
    p_left_on: input.leftOn,
    p_destination_school: input.destinationSchool,
    p_conduct: input.conduct,
  });
  if (error) throwMapped(error);

  const result = asJsonRecord(data);
  return { eventId: result.event_id as string, tcNo: result.tc_no as string };
}

export const transfer = defineAction({
  name: "lifecycle.transfer",
  module: "student_lifecycle",
  schema: TransferSchema,
  permission: "student.write",
  handler: async (input: TransferInput) => exitStudent("transferred_out", input),
});

export const withdraw = defineAction({
  name: "lifecycle.withdraw",
  module: "student_lifecycle",
  schema: WithdrawSchema,
  permission: "student.write",
  handler: async (input: WithdrawInput) => exitStudent("withdrawn", input),
});
