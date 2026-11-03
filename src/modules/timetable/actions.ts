"use server";

// M07-T4 — timetable.room.upsert / timetable.period.upsert /
// timetable.version.create / timetable.saveDraft / timetable.publish
// (M07-tasks.md rulings; migration 0069). Upsert semantics mirror
// academics/setup.actions.ts's upsertGrade (update when `id` given, else
// insert). saveDraft/publish mirror announcements.actions.ts's
// createAnnouncement (two-step write, documented partial-failure note) and
// publishAnnouncement (thin RPC wrapper — publish_timetable already raises
// `code:forbidden`/`code:invalid_state`/`code:not_found`, mapped by
// mapSqlError, so no extra handling needed here).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  PeriodUpsertSchema,
  PublishVersionSchema,
  RoomUpsertSchema,
  SaveSlotsSchema,
  VersionCreateSchema,
  type PeriodUpsertInput,
  type PublishVersionInput,
  type RoomUpsertInput,
  type SaveSlotsInput,
  type SlotInput,
  type VersionCreateInput,
} from "@/modules/timetable/schemas";

type TimetableClient = Awaited<ReturnType<typeof createClient>>;

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

type SlotConflictKind = "teacher" | "room" | "section";

// Maps the constraint named in the 23505 error (0069's naming convention) to
// the kind the caller sees, then uses the error's `details` ("Key (col,
// ...)=(val, ...) already exists.") to find which input slot it was — a
// single multi-row insert aborts entirely on the first violation (Postgres
// statement-level atomicity), so the DB state after a conflict is always
// unchanged; this only improves the message.
function identifySlotConflict(error: unknown, slots: SlotInput[]): { kind: SlotConflictKind; index: number } | null {
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  let kind: SlotConflictKind | null = null;
  if (message.includes("timetable_slots_teacher_slot_key")) kind = "teacher";
  else if (message.includes("timetable_slots_section_slot_key")) kind = "section";
  else if (message.includes("timetable_slots_room_unique_idx")) kind = "room";
  if (!kind) return null;

  const details = String((error as { details?: unknown } | null)?.details ?? "");
  const match = /\(([^)]+)\)=\(([^)]+)\)/.exec(details);
  let index = 0;
  if (match) {
    const cols = match[1].split(",").map((c) => c.trim());
    const vals = match[2].split(",").map((v) => v.trim());
    const byCol = new Map(cols.map((c, i) => [c, vals[i]]));
    const keyField = kind === "teacher" ? "teacher_id" : kind === "room" ? "room_id" : "class_section_id";
    const keyVal = byCol.get(keyField);
    const weekday = byCol.get("weekday");
    const periodId = byCol.get("period_id");
    const found = slots.findIndex((s) => {
      const field = kind === "teacher" ? s.teacherId : kind === "room" ? s.roomId : s.classSectionId;
      return field !== undefined && String(field) === keyVal && String(s.weekday) === weekday && s.periodId === periodId;
    });
    if (found >= 0) index = found;
  }

  return { kind, index };
}

export const upsertRoom = defineAction({
  name: "timetable.room.upsert",
  module: "timetable",
  schema: RoomUpsertSchema,
  permission: "timetable.manage",
  handler: async ({ id, name, capacity, kind }: RoomUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = { institution_id: ctx.institution.id, name, capacity, ...(kind !== undefined ? { kind } : {}) };
    const query = id
      ? supabase.from("rooms").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("rooms").insert(row);
    const { data, error } = await query.select("id, name, capacity, kind").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A room with this name already exists.", { name: ["Name already in use."] });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Room not found.");

    await audit(ctx, { action: "timetable.room.upsert", entityType: "room", entityId: data.id });

    return { id: data.id as string, name: data.name as string, capacity: data.capacity as number, kind: data.kind as string };
  },
});

export const upsertPeriod = defineAction({
  name: "timetable.period.upsert",
  module: "timetable",
  schema: PeriodUpsertSchema,
  permission: "timetable.manage",
  handler: async ({ id, seq, name, startsAt, endsAt, isBreak }: PeriodUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      seq,
      name,
      starts_at: startsAt,
      ends_at: endsAt,
      ...(isBreak !== undefined ? { is_break: isBreak } : {}),
    };
    const query = id
      ? supabase.from("periods").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("periods").insert(row);
    const { data, error } = await query.select("id, seq, name, starts_at, ends_at, is_break").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A period with this sequence number already exists.", { seq: ["Sequence already in use."] });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Period not found.");

    await audit(ctx, { action: "timetable.period.upsert", entityType: "period", entityId: data.id });

    return {
      id: data.id as string,
      seq: data.seq as number,
      name: data.name as string,
      startsAt: data.starts_at as string,
      endsAt: data.ends_at as string,
      isBreak: data.is_break as boolean,
    };
  },
});

async function assertVersionInInstitution(
  supabase: TimetableClient,
  versionId: string,
  institutionId: string,
): Promise<{ id: string; status: string }> {
  const { data, error } = await supabase
    .from("timetable_versions")
    .select("id, status")
    .eq("id", versionId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Timetable version not found.");
  return { id: data.id as string, status: data.status as string };
}

export const createVersion = defineAction({
  name: "timetable.version.create",
  module: "timetable",
  schema: VersionCreateSchema,
  permission: "timetable.manage",
  handler: async ({ academicYearId, name, copyFromVersionId }: VersionCreateInput, ctx) => {
    const supabase = await createClient();

    const { data: version, error: versionError } = await supabase
      .from("timetable_versions")
      .insert({
        institution_id: ctx.institution.id,
        academic_year_id: academicYearId,
        name,
        created_by: ctx.user.id,
      })
      .select("id, academic_year_id, name, status")
      .single();
    if (versionError) {
      if (isRlsViolation(versionError)) {
        throw new AppError("validation_failed", "Academic year not found in this school.", { academicYearId: ["Unknown academic year."] });
      }
      throwMapped(versionError);
    }

    let copiedSlotCount = 0;
    if (copyFromVersionId) {
      await assertVersionInInstitution(supabase, copyFromVersionId, ctx.institution.id);

      const { data: sourceSlots, error: sourceError } = await supabase
        .from("timetable_slots")
        .select("class_section_id, subject_id, teacher_id, room_id, weekday, period_id")
        .eq("version_id", copyFromVersionId)
        .eq("institution_id", ctx.institution.id);
      if (sourceError) throwMapped(sourceError);

      if (sourceSlots && sourceSlots.length > 0) {
        const { error: copyError } = await supabase.from("timetable_slots").insert(
          sourceSlots.map((s) => ({
            institution_id: ctx.institution.id,
            version_id: version.id,
            class_section_id: s.class_section_id,
            subject_id: s.subject_id,
            teacher_id: s.teacher_id,
            room_id: s.room_id,
            weekday: s.weekday,
            period_id: s.period_id,
          })),
        );
        if (copyError) throwMapped(copyError);
        copiedSlotCount = sourceSlots.length;
      }
    }

    await audit(ctx, {
      action: "timetable.version.create",
      entityType: "timetable_version",
      entityId: version.id,
      after: { copiedSlotCount },
    });

    return {
      id: version.id as string,
      academicYearId: version.academic_year_id as string,
      name: version.name as string,
      status: version.status as "draft" | "published" | "archived",
    };
  },
});

export const saveDraft = defineAction({
  name: "timetable.saveDraft",
  module: "timetable",
  schema: SaveSlotsSchema,
  permission: "timetable.manage",
  handler: async ({ versionId, slots, replaceSectionIds }: SaveSlotsInput, ctx) => {
    const supabase = await createClient();

    const version = await assertVersionInInstitution(supabase, versionId, ctx.institution.id);
    if (version.status !== "draft") {
      throw new AppError("invalid_state", `Timetable version must be draft to edit slots; current status is ${version.status}.`);
    }

    // Two-step write (delete stale slots, then insert the new ones), same
    // documented trade-off as announcements.actions.ts's createAnnouncement:
    // if the insert below fails, the deleted sections are simply empty and
    // the caller can retry saveDraft (still draft, so always re-editable).
    if (replaceSectionIds && replaceSectionIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("timetable_slots")
        .delete()
        .eq("version_id", versionId)
        .eq("institution_id", ctx.institution.id)
        .in("class_section_id", replaceSectionIds);
      if (deleteError) throwMapped(deleteError);
    }

    const { data: inserted, error: insertError } = await supabase
      .from("timetable_slots")
      .insert(
        slots.map((s) => ({
          institution_id: ctx.institution.id,
          version_id: versionId,
          class_section_id: s.classSectionId,
          subject_id: s.subjectId,
          teacher_id: s.teacherId,
          room_id: s.roomId ?? null,
          weekday: s.weekday,
          period_id: s.periodId,
        })),
      )
      .select("id");
    if (insertError) {
      if (isUniqueViolation(insertError)) {
        const conflict = identifySlotConflict(insertError, slots);
        const kind = conflict?.kind ?? "teacher";
        const index = conflict?.index ?? 0;
        throw new AppError("conflict", "One of these slots is already booked.", {
          slots: [`${index}: ${kind} double-booked`],
        });
      }
      if (isRlsViolation(insertError)) {
        throw new AppError("validation_failed", "A slot references a section, teacher, room, or period outside this institution.", {
          slots: ["Unknown section, teacher, room, or period."],
        });
      }
      throwMapped(insertError);
    }

    await audit(ctx, {
      action: "timetable.save_draft",
      entityType: "timetable_version",
      entityId: versionId,
      after: { slotCount: inserted?.length ?? 0, replacedSectionCount: replaceSectionIds?.length ?? 0 },
    });

    return { versionId, slotCount: inserted?.length ?? 0 };
  },
});

export const publishVersion = defineAction({
  name: "timetable.publish",
  module: "timetable",
  schema: PublishVersionSchema,
  permission: "timetable.manage",
  handler: async ({ versionId }: PublishVersionInput) => {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("publish_timetable", { p_version_id: versionId });
    if (error) throwMapped(error);

    return { versionId: data.id as string, status: data.status as "draft" | "published" | "archived" };
  },
});
