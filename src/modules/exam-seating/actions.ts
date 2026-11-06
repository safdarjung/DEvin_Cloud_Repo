"use server";

// X06-T5 — action `examSeating.generate` (X06-tasks.md "Task 5" ruling). Thin
// wrapper over T3's `generate_seating_plan` RPC, which is already the full
// authorization/validation boundary (exam_write_roles, slot/exam state,
// room validation, capacity conflict) — mirrors timetable/actions.ts's
// `publishVersion` (RPC + mapSqlError, no extra handling). No TS audit: the
// RPC audits `exam.seating.generated` with ids/counts only.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { GenerateSeatingSchema, type GenerateSeatingInput } from "@/modules/exam-seating/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const generateSeatingPlan = defineAction({
  name: "examSeating.generate",
  module: "exam_seating",
  schema: GenerateSeatingSchema,
  permission: "exam.manage",
  handler: async ({ examId, slotStart, rooms }: GenerateSeatingInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("generate_seating_plan", {
      p_institution_id: ctx.institution.id,
      p_exam_id: examId,
      p_slot_start: slotStart,
      p_rooms: rooms.map((r) => ({ room_id: r.roomId, ...(r.seats !== undefined ? { seats: r.seats } : {}) })),
    });
    if (error) throwMapped(error);

    return { planId: data.id as string, versionNo: data.version_no as number, seatCount: data.seat_count as number };
  },
});
