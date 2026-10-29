"use server";

// T-022 — assignments module actions (06 §W6 Create / Review+save, 07 §2
// assignment.manage). Teacher scope (CLAUDE.md "prove it in the action") is
// re-checked here even though RLS (assignments_insert/_update, 0005) already
// enforces section-level scope — this app-level check additionally proves
// the subject, which RLS does not (logged as debt for T-042; see
// assertTeacherScope below).
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import {
  CreateAssignmentSchema,
  PublishAssignmentSchema,
  UpdateAssignmentSchema,
  splitQuizContent,
  type CreateAssignmentInput,
  type PublishAssignmentInput,
  type UpdateAssignmentInput,
} from "./assignments.schemas";
import { managesWholeSection, teachesSubjectInSection } from "./teacher-scope";

type AcademicsClient = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

interface SectionRow {
  id: string;
  grade_id: string;
  class_teacher_id: string | null;
}

async function loadSection(supabase: AcademicsClient, institutionId: string, classSectionId: string): Promise<SectionRow> {
  const { data, error } = await supabase
    .from("class_sections")
    .select("id, grade_id, class_teacher_id")
    .eq("id", classSectionId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Class section not found.");
  return data;
}

async function assertSubjectInInstitution(supabase: AcademicsClient, institutionId: string, subjectId: string): Promise<void> {
  const { data, error } = await supabase
    .from("subjects")
    .select("id")
    .eq("id", subjectId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Subject not found.");
}

async function assertCurriculumUnitMatches(
  supabase: AcademicsClient,
  institutionId: string,
  curriculumUnitId: string,
  subjectId: string,
  gradeId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("curriculum_units")
    .select("id, subject_id, grade_id")
    .eq("id", curriculumUnitId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data || data.subject_id !== subjectId || data.grade_id !== gradeId) {
    throw new AppError("validation_failed", "Curriculum unit does not match the section's grade and subject.");
  }
}

// Stricter than app.teaches_section (0001), which is section-scoped only —
// RLS still allows a teacher to insert/update an assignment for ANY subject
// in a section they teach, even one they don't personally teach (logged as
// debt for T-042; migrations are off limits here). This app-level check
// additionally proves the subject. Scope rule itself lives in
// teacher-scope.ts, shared with assignments.queries.ts.
async function assertTeacherScope(
  supabase: AcademicsClient,
  ctx: TenantContext,
  section: Pick<SectionRow, "class_teacher_id">,
  classSectionId: string,
  subjectId: string,
): Promise<void> {
  if (managesWholeSection(ctx, section.class_teacher_id)) return;

  const staffId = ctx.membership.staffId;
  if (staffId) {
    let taught: boolean;
    try {
      taught = await teachesSubjectInSection(supabase, ctx.institution.id, classSectionId, subjectId, staffId);
    } catch (error) {
      throwMapped(error);
    }
    if (taught) return;
  }

  throw new AppError("forbidden", "You do not teach this subject in this section.");
}

export const createAssignment = defineAction({
  name: "assignment.create",
  schema: CreateAssignmentSchema,
  permission: "assignment.manage",
  handler: async (input: CreateAssignmentInput, ctx) => {
    if (!ctx.membership.staffId) {
      throw new AppError("forbidden", "Only staff can create assignments.");
    }

    const supabase = await createClient();
    const section = await loadSection(supabase, ctx.institution.id, input.classSectionId);
    await assertSubjectInInstitution(supabase, ctx.institution.id, input.subjectId);
    if (input.curriculumUnitId) {
      await assertCurriculumUnitMatches(
        supabase,
        ctx.institution.id,
        input.curriculumUnitId,
        input.subjectId,
        section.grade_id,
      );
    }
    await assertTeacherScope(supabase, ctx, section, input.classSectionId, input.subjectId);

    // DBT-21: answers/explanations never go into `assignments.content` —
    // split before the insert, same split updateAssignment uses below.
    const split = input.content ? splitQuizContent(input.content) : null;

    const { data, error } = await supabase
      .from("assignments")
      .insert({
        institution_id: ctx.institution.id,
        class_section_id: input.classSectionId,
        subject_id: input.subjectId,
        curriculum_unit_id: input.curriculumUnitId ?? null,
        title: input.title,
        instructions: input.instructions ?? null,
        content: split?.stored ?? null,
        due_at: input.dueAt ?? null,
        created_by: ctx.membership.staffId,
        ai_generated: input.aiGenerated ?? false,
      })
      .select("id")
      .single();
    if (error) throwMapped(error);

    if (split) {
      const { error: keyError } = await supabase
        .from("assignment_answer_keys")
        .insert({ institution_id: ctx.institution.id, assignment_id: data.id as string, answers: split.answers });
      if (keyError) throwMapped(keyError);
    }

    revalidatePath(`/${ctx.institution.slug}/assignments`);
    return { id: data.id as string };
  },
});

export const updateAssignment = defineAction({
  name: "assignment.update",
  schema: UpdateAssignmentSchema,
  permission: "assignment.manage",
  handler: async (input: UpdateAssignmentInput, ctx) => {
    const supabase = await createClient();
    const { data: existing, error: fetchError } = await supabase
      .from("assignments")
      .select("id, class_section_id, subject_id, status")
      .eq("id", input.assignmentId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (fetchError) throwMapped(fetchError);
    if (!existing) throw new AppError("not_found", "Assignment not found.");
    if (existing.status !== "draft") {
      throw new AppError("invalid_state", "Only draft assignments can be edited.");
    }

    const section = await loadSection(supabase, ctx.institution.id, existing.class_section_id);
    await assertTeacherScope(supabase, ctx, section, existing.class_section_id, existing.subject_id);

    if (input.curriculumUnitId) {
      await assertCurriculumUnitMatches(
        supabase,
        ctx.institution.id,
        input.curriculumUnitId,
        existing.subject_id,
        section.grade_id,
      );
    }

    // DBT-21: split before the patch — `assignments.content` never carries
    // answers/explanations, same split createAssignment uses above.
    const split = input.content !== undefined ? splitQuizContent(input.content) : null;

    const patch = {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.instructions !== undefined && { instructions: input.instructions }),
      ...(input.dueAt !== undefined && { due_at: input.dueAt }),
      ...(input.content !== undefined && { content: split?.stored ?? null }),
      ...(input.curriculumUnitId !== undefined && { curriculum_unit_id: input.curriculumUnitId }),
      ...(input.aiGenerated !== undefined && { ai_generated: input.aiGenerated }),
    };

    if (Object.keys(patch).length > 0) {
      const { data: updated, error } = await supabase
        .from("assignments")
        .update(patch)
        .eq("id", input.assignmentId)
        .eq("institution_id", ctx.institution.id)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();
      if (error) throwMapped(error);
      // Lost the race with a publish between the status check above and
      // this update — 0 rows matched, not success.
      if (!updated) throw new AppError("invalid_state", "Only draft assignments can be edited.");

      if (split) {
        const { error: keyError } = await supabase
          .from("assignment_answer_keys")
          .upsert(
            { institution_id: ctx.institution.id, assignment_id: input.assignmentId, answers: split.answers },
            { onConflict: "assignment_id" },
          );
        if (keyError) throwMapped(keyError);
      }
    }

    revalidatePath(`/${ctx.institution.slug}/assignments/${input.assignmentId}`);
    return { id: input.assignmentId };
  },
});

export const publishAssignment = defineAction({
  name: "assignment.publish",
  schema: PublishAssignmentSchema,
  permission: "assignment.manage",
  handler: async (input: PublishAssignmentInput, ctx) => {
    const supabase = await createClient();
    const { data: existing, error: fetchError } = await supabase
      .from("assignments")
      .select("id, class_section_id, subject_id, status, content")
      .eq("id", input.assignmentId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (fetchError) throwMapped(fetchError);
    if (!existing) throw new AppError("not_found", "Assignment not found.");
    if (existing.status !== "draft") {
      throw new AppError("invalid_state", "Only draft assignments can be published.");
    }

    const section = await loadSection(supabase, ctx.institution.id, existing.class_section_id);
    await assertTeacherScope(supabase, ctx, section, existing.class_section_id, existing.subject_id);

    // Fix round 1 (review MED): createAssignment/updateAssignment write
    // `assignments` and `assignment_answer_keys` in two separate statements
    // (not a transaction) — a failure between them can leave a quiz with
    // questions but no (or a stale) answer key, which `publishAssignment`
    // previously never checked. A published assignment with questions and
    // no matching answers is unrecoverable once live, so this is checked
    // here, not left to the two-write race's "known limit" comment.
    const questionCount = (existing.content as { questions?: unknown[] } | null)?.questions?.length ?? 0;
    if (questionCount > 0) {
      const { data: keyRow, error: keyError } = await supabase
        .from("assignment_answer_keys")
        .select("answers")
        .eq("assignment_id", input.assignmentId)
        .eq("institution_id", ctx.institution.id)
        .maybeSingle();
      if (keyError) throwMapped(keyError);
      const answerCount = (keyRow?.answers as { questions?: unknown[] } | null)?.questions?.length ?? 0;
      if (answerCount !== questionCount) {
        throw new AppError("validation_failed", "Answer key missing or out of date — re-save the draft");
      }
    }

    const { data: published, error } = await supabase
      .from("assignments")
      .update({ status: "published" })
      .eq("id", input.assignmentId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    // Lost the race with another publish/edit between the status check
    // above and this update — 0 rows matched. Report invalid_state and
    // skip the audit write; do not report success for a write that did
    // not happen.
    if (!published) throw new AppError("invalid_state", "Only draft assignments can be published.");

    // Never put free-form content (title/instructions/quiz text) in the
    // audit row (CLAUDE.md rule) — ids and status only.
    await audit(ctx, {
      action: "assignment.published",
      entityType: "assignment",
      entityId: input.assignmentId,
      before: { status: "draft" },
      after: { status: "published" },
    });

    revalidatePath(`/${ctx.institution.slug}/assignments`);
    revalidatePath(`/${ctx.institution.slug}/assignments/${input.assignmentId}`);
    return { id: input.assignmentId };
  },
});
