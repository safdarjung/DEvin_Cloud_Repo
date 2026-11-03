"use server";

// M10-T3 — curriculum.unit.upsert / curriculum.lessonPlan.upsert /
// curriculum.lessonPlan.delete / curriculum.markCovered (M10-tasks.md
// rulings; migration 0072). Upsert semantics mirror
// academics/setup.actions.ts's upsertGrade (update when `id` given, else
// insert). The unit/section pre-check (grade + subject match) is shared by
// lessonPlan.upsert and markCovered via assertUnitMatchesSection below.
// todayInTimezone is copied verbatim from attendance/actions.ts (non-
// exported helper, each "use server" file keeps its own copy per brief).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import {
  CurriculumUnitUpsertSchema,
  LessonPlanDeleteSchema,
  LessonPlanUpsertSchema,
  MarkCoveredSchema,
  type CurriculumUnitUpsertInput,
  type LessonPlanDeleteInput,
  type LessonPlanUpsertInput,
  type MarkCoveredInput,
} from "@/modules/academics/curriculum.schemas";

type CurriculumClient = Awaited<ReturnType<typeof createClient>>;

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

function forbiddenScope(): AppError {
  return new AppError("forbidden", "You are not in the teaching scope for this section and subject.");
}

/** `new Intl.DateTimeFormat` with `timeZone` gives the institution-local calendar date, not the server's. */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

function todayForInstitution(ctx: { institution: { settings: Record<string, unknown> } }): string {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  return todayInTimezone(locale.success ? locale.data.timezone : "Asia/Kolkata");
}

async function loadSectionGrade(
  supabase: CurriculumClient,
  institutionId: string,
  classSectionId: string,
): Promise<{ id: string; gradeId: string }> {
  const { data, error } = await supabase
    .from("class_sections")
    .select("id, grade_id")
    .eq("id", classSectionId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Class section not found.");
  return { id: data.id as string, gradeId: data.grade_id as string };
}

/** Shared by lessonPlan.upsert and markCovered: unit must exist in the institution and match the section's grade. */
async function assertUnitMatchesSection(
  supabase: CurriculumClient,
  institutionId: string,
  curriculumUnitId: string,
  sectionGradeId: string,
): Promise<{ id: string; subjectId: string; gradeId: string }> {
  const { data, error } = await supabase
    .from("curriculum_units")
    .select("id, subject_id, grade_id")
    .eq("id", curriculumUnitId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Curriculum unit not found.");
  if (data.grade_id !== sectionGradeId) {
    throw new AppError("validation_failed", "This curriculum unit does not belong to the section's grade.", {
      curriculumUnitId: ["Unit is not in this section's grade."],
    });
  }
  return { id: data.id as string, subjectId: data.subject_id as string, gradeId: data.grade_id as string };
}

export const upsertUnit = defineAction({
  name: "curriculum.unit.upsert",
  module: "academic_structure",
  schema: CurriculumUnitUpsertSchema,
  permission: "academics.manage",
  handler: async ({ id, gradeId, subjectId, title, description, sequence }: CurriculumUnitUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      grade_id: gradeId,
      subject_id: subjectId,
      title,
      sequence,
      ...(description !== undefined ? { description } : {}),
    };
    const query = id
      ? supabase.from("curriculum_units").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("curriculum_units").insert(row);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A unit with this sequence already exists for this subject and grade.", {
          sequence: ["Sequence already in use for this subject and grade."],
        });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Curriculum unit not found.");

    await audit(ctx, { action: "curriculum.unit.upsert", entityType: "curriculum_unit", entityId: data.id });

    return { id: data.id as string };
  },
});

export const upsertLessonPlan = defineAction({
  name: "curriculum.lessonPlan.upsert",
  module: "lesson_plans",
  schema: LessonPlanUpsertSchema,
  permission: "assignment.manage",
  handler: async (
    { id, classSectionId, subjectId, curriculumUnitId, plannedOn, title, objectives, resources }: LessonPlanUpsertInput,
    ctx,
  ) => {
    const supabase = await createClient();

    // Update: pre-check must run against the row's own persisted
    // class_section_id, never the client-supplied one (M10 security review
    // MEDIUM) — a caller cannot smuggle a different section's grade into
    // the unit/grade pre-check via a mismatched classSectionId.
    let sectionIdForCheck = classSectionId;
    if (id) {
      const { data: existing, error: existingError } = await supabase
        .from("lesson_plans")
        .select("class_section_id")
        .eq("id", id)
        .eq("institution_id", ctx.institution.id)
        .maybeSingle();
      if (existingError) throwMapped(existingError);
      if (!existing) throw new AppError("not_found", "Lesson plan not found.");
      if (existing.class_section_id !== classSectionId) {
        throw new AppError("validation_failed", "classSectionId does not match this lesson plan's section.", {
          classSectionId: ["Cannot move a lesson plan to a different section."],
        });
      }
      sectionIdForCheck = existing.class_section_id as string;
    }

    const section = await loadSectionGrade(supabase, ctx.institution.id, sectionIdForCheck);
    if (curriculumUnitId) {
      const unit = await assertUnitMatchesSection(supabase, ctx.institution.id, curriculumUnitId, section.gradeId);
      if (unit.subjectId !== subjectId) {
        throw new AppError("validation_failed", "This curriculum unit belongs to a different subject.", {
          curriculumUnitId: ["Unit does not match the selected subject."],
        });
      }
    }

    const sharedFields = {
      subject_id: subjectId,
      curriculum_unit_id: curriculumUnitId ?? null,
      planned_on: plannedOn,
      title,
      objectives,
      ...(resources !== undefined ? { resources } : {}),
    };
    // Update never sends class_section_id/created_by — both are frozen by
    // app.guard_lesson_plan_identity, and the brief forbids touching them.
    const query = id
      ? supabase.from("lesson_plans").update(sharedFields).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase
          .from("lesson_plans")
          .insert({ institution_id: ctx.institution.id, class_section_id: classSectionId, created_by: ctx.user.id, ...sharedFields });
    const { data, error } = await query.select("id").maybeSingle();
    if (error) {
      if (isRlsViolation(error)) throw forbiddenScope();
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Lesson plan not found.");

    await audit(ctx, { action: "curriculum.lesson_plan.upsert", entityType: "lesson_plan", entityId: data.id });

    return { id: data.id as string };
  },
});

export const deleteLessonPlan = defineAction({
  name: "curriculum.lessonPlan.delete",
  module: "lesson_plans",
  schema: LessonPlanDeleteSchema,
  permission: "assignment.manage",
  handler: async ({ id }: LessonPlanDeleteInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lesson_plans")
      .delete()
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id");
    if (error) throwMapped(error);
    if (!data || data.length === 0) throw new AppError("not_found", "Lesson plan not found.");

    await audit(ctx, { action: "curriculum.lesson_plan.delete", entityType: "lesson_plan", entityId: id });

    return { id };
  },
});

export const markCovered = defineAction({
  name: "curriculum.markCovered",
  module: "lesson_plans",
  schema: MarkCoveredSchema,
  permission: "assignment.manage",
  handler: async ({ classSectionId, curriculumUnitId, covered, coveredOn, lessonPlanId, notes }: MarkCoveredInput, ctx) => {
    const supabase = await createClient();

    if (!covered) {
      const { data: existing, error: existingError } = await supabase
        .from("curriculum_unit_coverage")
        .select("id")
        .eq("institution_id", ctx.institution.id)
        .eq("class_section_id", classSectionId)
        .eq("curriculum_unit_id", curriculumUnitId)
        .maybeSingle();
      if (existingError) throwMapped(existingError);
      // Row absent is idempotent success — nothing to remove.
      if (!existing) return { id: null as string | null, covered: false };

      const { data: deleted, error: deleteError } = await supabase
        .from("curriculum_unit_coverage")
        .delete()
        .eq("id", existing.id)
        .select("id");
      if (deleteError) throwMapped(deleteError);
      // Row was visible (SELECT policy is staff-wide) but the delete's
      // narrower write-scope `using` clause excluded it: caller is out of scope.
      if (!deleted || deleted.length === 0) throw forbiddenScope();

      await audit(ctx, {
        action: "curriculum.mark_covered",
        entityType: "curriculum_unit_coverage",
        entityId: existing.id as string,
        after: { covered: false },
      });
      return { id: null as string | null, covered: false };
    }

    const section = await loadSectionGrade(supabase, ctx.institution.id, classSectionId);
    const unit = await assertUnitMatchesSection(supabase, ctx.institution.id, curriculumUnitId, section.gradeId);

    if (coveredOn === undefined) {
      throw new AppError("validation_failed", "coveredOn is required when covered is true.", { coveredOn: ["Required."] });
    }
    const today = todayForInstitution(ctx);
    if (coveredOn > today) {
      throw new AppError("validation_failed", "Covered date cannot be in the future.", { coveredOn: ["Cannot be in the future."] });
    }

    const { data, error } = await supabase
      .from("curriculum_unit_coverage")
      .upsert(
        {
          institution_id: ctx.institution.id,
          class_section_id: classSectionId,
          subject_id: unit.subjectId,
          curriculum_unit_id: curriculumUnitId,
          covered_on: coveredOn,
          lesson_plan_id: lessonPlanId ?? null,
          notes: notes ?? null,
          marked_by: ctx.user.id,
        },
        { onConflict: "class_section_id,curriculum_unit_id" },
      )
      .select("id")
      .single();
    if (error) {
      // Covers both the write-scope W violation and a mismatched
      // lessonPlanId (no separate pre-check for the latter, per brief).
      if (isRlsViolation(error)) throw forbiddenScope();
      throwMapped(error);
    }

    await audit(ctx, {
      action: "curriculum.mark_covered",
      entityType: "curriculum_unit_coverage",
      entityId: data.id as string,
      after: { covered: true },
    });
    return { id: data.id as string, covered: true };
  },
});
