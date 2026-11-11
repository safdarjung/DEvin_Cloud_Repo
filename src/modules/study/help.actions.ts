"use server";

// Study help writes (migration 0140). Same split as actions.ts: student
// actions are `ai.study` on their own rows; teacher actions are
// `resource.manage` (assigning is `assignment.manage`) and RLS lets a teacher
// write only their own material and share/assign only to sections they
// teach. AI output reaches a table only when a person saves it (rule 6);
// mock exams are practice and never touch marks.
import { defineAction } from "@/lib/actions/define-action";
import { AppError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { createAssignment, publishAssignment } from "@/modules/academics/assignments.actions";
import { FORMAT_LABELS, contentSchema } from "@/modules/study/formats";
import { insertMaterial, throwMapped } from "@/modules/study/material-write";
import { getStudyMaterial } from "@/modules/study/queries";
import {
  AnswerQuestionSchema,
  AskQuestionSchema,
  AssignMaterialSchema,
  FileConsentSchema,
  SaveMockSchema,
  SaveVariantSchema,
  SaveWorksheetSchema,
  type SaveVariantInput,
} from "@/modules/study/schemas";
import { WorksheetContentSchema, worksheetAssignmentText } from "@/modules/study/worksheet";

type Client = Awaited<ReturnType<typeof createClient>>;

async function giveConsent(ctx: TenantContext): Promise<{ given: true }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("study_ai_consents")
    .upsert({ institution_id: ctx.institution.id, user_id: ctx.user.id, kind: "file_reading" }, { onConflict: "institution_id,user_id,kind", ignoreDuplicates: true });
  if (error) throwMapped(error);
  await audit(ctx, { action: "study.file_consent.given", entityType: "study_ai_consents", entityId: ctx.user.id });
  return { given: true };
}

export const giveFileReadingConsent = defineAction({
  name: "study.fileConsent.give",
  module: "ai_student",
  schema: FileConsentSchema,
  permission: "ai.study",
  handler: async (_input, ctx) => giveConsent(ctx),
});

export const giveTeacherFileReadingConsent = defineAction({
  name: "study.teacher.fileConsent.give",
  module: "ai_teacher",
  schema: FileConsentSchema,
  permission: "resource.manage",
  handler: async (_input, ctx) => giveConsent(ctx),
});

export const saveMockExam = defineAction({
  name: "study.mock.save",
  module: "ai_student",
  schema: SaveMockSchema,
  permission: "ai.study",
  handler: async (input, ctx) => {
    if (!ctx.membership.studentId) throw new AppError("forbidden", "Mock exams are for students.");
    const ids = new Set(input.content.units.map((u) => u.id));
    if (input.focusUnitIds.some((id) => !ids.has(id))) throw new AppError("validation_failed", "Units do not match the paper.");
    const supabase = await createClient();
    const id = await insertMaterial(
      supabase,
      ctx,
      { format: "mock_exam", title: input.title, subjectId: input.subjectId, sourceKind: "mock_exam", content: input.content, focusUnitIds: input.focusUnitIds },
      "student",
    );
    return { id };
  },
});

/** The base must be readable by the caller (RLS) and an original; the copy takes its format and metadata from it. */
async function saveVariant(input: SaveVariantInput, ctx: TenantContext, ownerRole: "student" | "teacher"): Promise<{ id: string; sectionIds: string[] }> {
  const base = await getStudyMaterial(ctx, input.baseId);
  if (!base || base.variantOf) throw new AppError("not_found", "The original material was not found.");
  if (base.language === input.language) throw new AppError("validation_failed", "Pick the other language.");
  if (ownerRole === "student" && base.format === "worksheet") throw new AppError("forbidden", "Worksheets belong to teachers.");
  const parsed = contentSchema(base.format).safeParse(input.content);
  if (!parsed.success) throw new AppError("validation_failed", "The translation does not match the material's format.", { content: ["Does not match the format"] });
  const supabase = await createClient();
  const id = await insertMaterial(
    supabase,
    ctx,
    {
      format: base.format,
      title: input.title,
      subjectId: base.subjectId ?? undefined,
      unitId: base.unitId ?? undefined,
      sourceKind: base.sourceKind,
      resourceId: base.resourceId ?? undefined,
      content: parsed.data,
      sourceMaterialId: base.sourceMaterialId ?? undefined,
      focusUnitIds: base.focusUnitIds,
      language: input.language,
      variantOf: base.id,
    },
    ownerRole,
  );
  // A teacher's translation of their own shared material reaches the same sections.
  let sectionIds: string[] = [];
  if (ownerRole === "teacher" && base.isMine && base.format !== "worksheet") {
    const { data, error } = await supabase.from("study_material_sections").select("class_section_id").eq("material_id", base.id);
    if (error) throwMapped(error);
    sectionIds = (data ?? []).map((r) => r.class_section_id);
    if (sectionIds.length) {
      const { error: sError } = await supabase
        .from("study_material_sections")
        .insert(sectionIds.map((sid) => ({ material_id: id, institution_id: ctx.institution.id, class_section_id: sid })));
      if (sError) throwMapped(sError);
    }
  }
  return { id, sectionIds };
}

export const saveStudyVariant = defineAction({
  name: "study.material.saveVariant",
  module: "ai_student",
  schema: SaveVariantSchema,
  permission: "ai.study",
  handler: async (input, ctx) => {
    if (!ctx.membership.studentId) throw new AppError("forbidden", "The study studio is for students.");
    return saveVariant(input, ctx, "student");
  },
});

export const saveTeacherStudyVariant = defineAction({
  name: "study.teacher.material.saveVariant",
  module: "ai_teacher",
  schema: SaveVariantSchema,
  permission: "resource.manage",
  handler: async (input, ctx) => {
    const saved = await saveVariant(input, ctx, "teacher");
    await audit(ctx, { action: "study.material.variant", entityType: "study_materials", entityId: saved.id, after: { language: input.language, sectionCount: saved.sectionIds.length } });
    return saved;
  },
});

export const saveWorksheet = defineAction({
  name: "study.teacher.worksheet.save",
  module: "ai_teacher",
  schema: SaveWorksheetSchema,
  permission: "resource.manage",
  handler: async (input, ctx) => {
    const supabase = await createClient();
    // Never shared to a section (0140 policy): homework gets the questions as text via study.teacher.assign.
    const id = await insertMaterial(supabase, ctx, { ...input, format: "worksheet" }, "teacher");
    await audit(ctx, { action: "study.worksheet.save", entityType: "study_materials", entityId: id });
    return { id };
  },
});

async function unitFitsSection(unitId: string, sectionId: string, ctx: TenantContext): Promise<boolean> {
  const supabase = await createClient();
  const [unit, section] = await Promise.all([
    supabase.from("curriculum_units").select("grade_id").eq("id", unitId).eq("institution_id", ctx.institution.id).maybeSingle(),
    supabase.from("class_sections").select("grade_id").eq("id", sectionId).eq("institution_id", ctx.institution.id).maybeSingle(),
  ]);
  if (unit.error || section.error) throwMapped(unit.error ?? section.error);
  return Boolean(unit.data && section.data && unit.data.grade_id === section.data.grade_id);
}

async function shareToSection(supabase: Client, ctx: TenantContext, materialId: string, sectionId: string): Promise<void> {
  const { data, error } = await supabase.from("study_material_sections").select("class_section_id").eq("material_id", materialId).eq("class_section_id", sectionId).maybeSingle();
  if (error) throwMapped(error);
  if (data) return;
  const { error: iError } = await supabase.from("study_material_sections").insert({ material_id: materialId, institution_id: ctx.institution.id, class_section_id: sectionId });
  if (iError) throwMapped(iError);
}

/**
 * Homework through the EXISTING assignments actions (assignment.create, then
 * assignment.publish when asked), so due dates, submissions and everything
 * downstream work as for any assignment. A worksheet goes in as text (one
 * level or all three, never the key); any other studio item is shared with the
 * section and linked through assignments.study_material_id.
 */
export const assignStudyMaterial = defineAction({
  name: "study.teacher.assign",
  module: "assignments",
  schema: AssignMaterialSchema,
  permission: "assignment.manage",
  handler: async (input, ctx) => {
    const material = await getStudyMaterial(ctx, input.materialId);
    if (!material || !material.isMine || material.ownerRole !== "teacher") throw new AppError("not_found", "That material was not found.");
    const subjectId = input.subjectId ?? material.subjectId;
    if (!subjectId) throw new AppError("validation_failed", "Choose the subject for this homework.", { subjectId: ["Required"] });

    const isWorksheet = material.format === "worksheet";
    let instructions: string;
    if (isWorksheet) {
      const ws = WorksheetContentSchema.safeParse(material.content);
      if (!ws.success) throw new AppError("validation_failed", "This worksheet is not complete.");
      instructions = worksheetAssignmentText(ws.data, input.level ?? "all");
    } else {
      const supabase = await createClient();
      await shareToSection(supabase, ctx, material.id, input.sectionId);
      instructions = `Study material from your teacher: "${material.title}". Open it from this assignment, work through it, then submit what your teacher asks for. AI-made and teacher-reviewed; practice only.`;
    }

    // Link the unit only when it is this section's grade and subject (assignment.create refuses any other).
    const linkUnit = material.unitId && material.subjectId === subjectId ? await unitFitsSection(material.unitId, input.sectionId, ctx) : false;
    const created = await createAssignment(ctx.institution.slug, {
      classSectionId: input.sectionId,
      subjectId,
      ...(linkUnit && material.unitId ? { curriculumUnitId: material.unitId } : {}),
      title: (material.title.startsWith(`${FORMAT_LABELS[material.format]}:`) ? material.title : `${FORMAT_LABELS[material.format]}: ${material.title}`).slice(0, 200),
      instructions,
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      aiGenerated: true,
      ...(isWorksheet ? {} : { studyMaterialId: material.id }),
    });
    if (!created.ok) throw new AppError(created.error.code, created.error.message, created.error.fieldErrors);
    if (input.publish) {
      const published = await publishAssignment(ctx.institution.slug, { assignmentId: created.data.id });
      if (!published.ok) throw new AppError(published.error.code, `Saved as a draft assignment, not published: ${published.error.message}`);
    }
    await audit(ctx, { action: "study.material.assigned", entityType: "study_materials", entityId: material.id, after: { assignmentId: created.data.id, published: input.publish } });
    return { assignmentId: created.data.id, published: input.publish };
  },
});

export const askStudyQuestion = defineAction({
  name: "study.question.ask",
  module: "ai_student",
  schema: AskQuestionSchema,
  permission: "ai.study",
  handler: async (input, ctx) => {
    const studentId = ctx.membership.studentId;
    if (!studentId) throw new AppError("forbidden", "Only a student asks a study question.");
    const supabase = await createClient();
    const { data: enrolment, error } = await supabase
      .from("enrolments")
      .select("class_section_id")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!enrolment) throw new AppError("invalid_state", "You are not in a class section this year.");
    // RLS (0140) proves the student, the enrolment, the subject in that section and the material's school.
    const { data, error: iError } = await supabase
      .from("study_questions")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        class_section_id: enrolment.class_section_id,
        subject_id: input.subjectId,
        context_kind: input.contextKind,
        material_id: input.materialId ?? null,
        context_excerpt: input.contextExcerpt ?? null,
        question: input.question,
      })
      .select("id")
      .single();
    if (iError) {
      if (iError.code === "42501") throw new AppError("forbidden", "Ask about a subject taught in your own class.");
      throwMapped(iError);
    }
    return { id: data.id };
  },
});

export const answerStudyQuestion = defineAction({
  name: "study.question.answer",
  module: "ai_teacher",
  schema: AnswerQuestionSchema,
  permission: "resource.manage",
  handler: async ({ questionId, answer }, ctx) => {
    const supabase = await createClient();
    // RLS: only the teacher of that (section, subject) can see or update it; the trigger stamps who and when.
    const { data, error } = await supabase.from("study_questions").update({ answer }).eq("id", questionId).eq("institution_id", ctx.institution.id).select("id");
    if (error) throwMapped(error);
    if (!data?.length) throw new AppError("not_found", "That question was not found.");
    await audit(ctx, { action: "study.question.answer", entityType: "study_questions", entityId: questionId });
    return { id: questionId };
  },
});
