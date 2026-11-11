"use server";

// M07-T4 — timetable.room.upsert / timetable.period.upsert /
// timetable.version.create / timetable.saveDraft / timetable.publish
// (M07-tasks.md rulings; migration 0069). Upsert semantics mirror
// academics/setup.actions.ts's upsertGrade (update when `id` given, else
// insert). 0141: saveDraft writes through apply_timetable_changes (one
// atomic, logged write) and publish through publish_timetable_version (logs
// the publish, restores archived versions); both definers raise
// `code:forbidden`/`code:invalid_state`/`code:not_found`, mapped by mapSqlError.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { applyCellChanges, conflictIndex } from "@/modules/timetable/apply";
import type { CellChange } from "@/modules/timetable/checks";
import { versionCells } from "@/modules/timetable/control.queries";
import { timetableViolations } from "@/modules/timetable/suggest.queries";
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
  handler: async ({ versionId, slots, replaceSectionIds, note }: SaveSlotsInput, ctx) => {
    const supabase = await createClient();

    const version = await assertVersionInInstitution(supabase, versionId, ctx.institution.id);
    if (version.status !== "draft") {
      throw new AppError("invalid_state", `Timetable version must be draft to edit slots; current status is ${version.status}.`);
    }

    // 0141: one logged write through apply_timetable_changes instead of
    // delete-then-insert. Replaced sections' periods missing from `slots` are
    // cleared first; a period outside the replaced sections must be empty
    // (expect: null), as the old plain insert required.
    const key = (c: { classSectionId: string; weekday: number; periodId: string }) => `${c.classSectionId}|${c.weekday}|${c.periodId}`;
    const replaced = new Set(replaceSectionIds ?? []);
    const current = replaced.size ? (await versionCells(ctx, versionId)).filter((c) => replaced.has(c.classSectionId)) : [];
    const incoming = new Set(slots.map(key));
    const existing = new Set(current.map(key));
    const clears: CellChange[] = current
      .filter((c) => !incoming.has(key(c)))
      .map((c) => ({ classSectionId: c.classSectionId, weekday: c.weekday, periodId: c.periodId, after: null }));
    const sets: CellChange[] = slots.map((s) => ({
      classSectionId: s.classSectionId,
      weekday: s.weekday,
      periodId: s.periodId,
      after: { subjectId: s.subjectId, teacherId: s.teacherId, roomId: s.roomId ?? null },
      ...(existing.has(key(s)) ? {} : { expect: null }),
    }));

    try {
      await applyCellChanges(versionId, "manual", [...clears, ...sets], note || "Draft saved in bulk");
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      if (e.code === "conflict") {
        const kind: SlotConflictKind = /^teacher/.test(e.message) ? "teacher" : /^room/.test(e.message) ? "room" : "section";
        const index = Math.max(0, (conflictIndex(e.message) ?? clears.length) - clears.length);
        throw new AppError("conflict", "One of these slots is already booked.", { slots: [`${index}: ${kind} double-booked`] });
      }
      if (e.code === "validation_failed" && /unknown/.test(e.message)) {
        throw new AppError("validation_failed", "A slot references a section, teacher, room, or period outside this institution.", {
          slots: ["Unknown section, teacher, room, or period."],
        });
      }
      throw e;
    }

    await audit(ctx, {
      action: "timetable.save_draft",
      entityType: "timetable_version",
      entityId: versionId,
      after: { slotCount: slots.length, replacedSectionCount: replaceSectionIds?.length ?? 0 },
    });

    return { versionId, slotCount: slots.length };
  },
});

export const publishVersion = defineAction({
  name: "timetable.publish",
  module: "timetable",
  schema: PublishVersionSchema,
  permission: "timetable.manage",
  handler: async ({ versionId, note }: PublishVersionInput, ctx) => {
    const supabase = await createClient();

    // 0141: a draft that still breaks a timetable rule publishes only with a
    // note saying why; an archived version is restored (the definer needs a note).
    const version = await assertVersionInInstitution(supabase, versionId, ctx.institution.id);
    if (version.status === "draft" && !note) {
      const violations = await timetableViolations(ctx, versionId);
      if (violations.length > 0) {
        const message = `This draft breaks ${violations.length} timetable rule${violations.length === 1 ? "" : "s"}. Add a note saying why it is published anyway.`;
        throw new AppError("validation_failed", message, { note: [message] });
      }
    }

    const { data, error } = await supabase.rpc("publish_timetable_version", { p_version_id: versionId, p_note: note || undefined });
    if (error) throwMapped(error);

    return { versionId: data.id as string, status: data.status as "draft" | "published" | "archived" };
  },
});
