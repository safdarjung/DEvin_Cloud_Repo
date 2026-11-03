"use server";

// M13-T7 — calendar.event.upsert / calendar.event.delete (M13-tasks.md
// rulings; migration 0075). Upsert semantics mirror
// academics/setup.actions.ts's upsertGrade (update when `id` given, else
// insert). Error-code mapping (M13 rulings "ErrorCode mapping"): 23503 →
// not_found, 42501 → forbidden, delete/update hitting 0 rows → not_found.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  CalendarEventDeleteSchema,
  CalendarEventUpsertSchema,
  type CalendarEventDeleteInput,
  type CalendarEventUpsertInput,
} from "@/modules/calendar/schemas";

const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";
const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

export const upsertCalendarEvent = defineAction({
  name: "calendar.event.upsert",
  module: "calendar",
  schema: CalendarEventUpsertSchema,
  permission: "academics.manage",
  handler: async (
    { id, academicYearId, kind, title, description, startsOn, endsOn, audience }: CalendarEventUpsertInput,
    ctx,
  ) => {
    const supabase = await createClient();
    const row = {
      academic_year_id: academicYearId,
      kind,
      title,
      description: description ?? null,
      starts_on: startsOn,
      ends_on: endsOn,
      audience,
    };
    const query = id
      ? supabase.from("academic_calendar_events").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase
          .from("academic_calendar_events")
          .insert({ ...row, institution_id: ctx.institution.id, created_by: ctx.user.id });
    const { data, error } = await query.select("id, kind, starts_on, ends_on").maybeSingle();
    if (error) {
      const code = errorCode(error);
      if (code === POSTGRES_FOREIGN_KEY_VIOLATION) {
        throw new AppError("not_found", "Academic year not found.", { academicYearId: ["Unknown academic year."] });
      }
      if (code === POSTGRES_RLS_VIOLATION) {
        throw new AppError("forbidden", "You do not have permission to perform this action.");
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Calendar event not found.");

    await audit(ctx, {
      action: "calendar.event.upsert",
      entityType: "academic_calendar_event",
      entityId: data.id as string,
      after: { kind: data.kind, startsOn: data.starts_on, endsOn: data.ends_on },
    });

    return { id: data.id as string };
  },
});

export const deleteCalendarEvent = defineAction({
  name: "calendar.event.delete",
  module: "calendar",
  schema: CalendarEventDeleteSchema,
  permission: "academics.manage",
  handler: async ({ id }: CalendarEventDeleteInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("academic_calendar_events")
      .delete()
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id, kind")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Calendar event not found.");

    await audit(ctx, {
      action: "calendar.event.delete",
      entityType: "academic_calendar_event",
      entityId: data.id as string,
      after: { kind: data.kind },
    });

    return { id: data.id as string };
  },
});
