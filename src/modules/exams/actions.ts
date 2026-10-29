"use server";

// T-018 — exams module actions (06 §W7, 07 §2.2 exam.*). The four status-
// transition actions and `enterMarks`/`verifyExam` are thin wrappers over
// the security-definer RPCs in 20261028000018_exams_entry.sql, which are
// themselves the authorization/data-integrity boundary (RLS is bypassed
// inside them, same shape as 0009's publish_exam_results/
// apply_recheck_decision) — matching the lead ruling that `enter_marks`
// must be one transaction, not a client-side insert+update pair. `createExam`
// and `createExamPapers` stay direct RLS inserts (0009's exams_insert/
// exam_papers_insert already gate on `app.exam_write_roles()`), with every
// foreign id proven to belong to `ctx.institution` here (CLAUDE.md rule 10).
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import {
  CreateExamPapersSchema,
  CreateExamSchema,
  EnterMarksSchema,
  ExamIdSchema,
  type CreateExamInput,
  type CreateExamPapersInput,
  type EnterMarksInput,
  type ExamIdInput,
} from "./schemas";

type ExamsClient = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function loadTerm(supabase: ExamsClient, institutionId: string, termId: string) {
  const { data, error } = await supabase
    .from("terms")
    .select("id, academic_year_id")
    .eq("id", termId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Term not found.");
  return data;
}

export const createExam = defineAction({
  name: "exam.create",
  schema: CreateExamSchema,
  permission: "exam.manage",
  handler: async (input: CreateExamInput, ctx) => {
    const supabase = await createClient();
    const term = await loadTerm(supabase, ctx.institution.id, input.termId);

    const examsSettings = InstitutionSettingsSchema.shape.exams.safeParse(ctx.institution.settings.exams);
    if (examsSettings.success && !(input.gradingScaleKey in examsSettings.data.grading_scales)) {
      throw new AppError("validation_failed", "Unknown grading scale.", { gradingScaleKey: ["Unknown grading scale."] });
    }

    const { data, error } = await supabase
      .from("exams")
      .insert({
        institution_id: ctx.institution.id,
        academic_year_id: term.academic_year_id,
        term_id: input.termId,
        name: input.name,
        type: input.type,
        grading_scale_key: input.gradingScaleKey,
      })
      .select("id, status")
      .single();
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/exams`);
    return { id: data.id as string, status: data.status as string };
  },
});

export const createExamPapers = defineAction({
  name: "exam.papers.create",
  schema: CreateExamPapersSchema,
  permission: "exam.manage",
  handler: async (input: CreateExamPapersInput, ctx) => {
    const supabase = await createClient();

    const { data: exam, error: examError } = await supabase
      .from("exams")
      .select("id")
      .eq("id", input.examId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (examError) throwMapped(examError);
    if (!exam) throw new AppError("not_found", "Exam not found.");

    const sectionIds = [...new Set(input.papers.map((p) => p.classSectionId))];
    const subjectIds = [...new Set(input.papers.map((p) => p.subjectId))];

    const [sectionsResult, subjectsResult] = await Promise.all([
      supabase.from("class_sections").select("id").eq("institution_id", ctx.institution.id).in("id", sectionIds),
      supabase.from("subjects").select("id").eq("institution_id", ctx.institution.id).in("id", subjectIds),
    ]);
    if (sectionsResult.error) throwMapped(sectionsResult.error);
    if (subjectsResult.error) throwMapped(subjectsResult.error);
    if ((sectionsResult.data ?? []).length !== sectionIds.length || (subjectsResult.data ?? []).length !== subjectIds.length) {
      throw new AppError("not_found", "One or more sections or subjects were not found.");
    }

    const { data, error } = await supabase
      .from("exam_papers")
      .insert(
        input.papers.map((p) => ({
          institution_id: ctx.institution.id,
          exam_id: input.examId,
          class_section_id: p.classSectionId,
          subject_id: p.subjectId,
          max_marks: p.maxMarks,
          pass_marks: p.passMarks,
          held_on: p.heldOn ?? null,
        })),
      )
      .select("id");
    if (error) {
      // Fix round 1 (security review): a repeat (section, subject) pair hits
      // 0009's unique(exam_id, class_section_id, subject_id) constraint and
      // surfaced as an opaque "internal" error (23505 isn't a `code:`-
      // prefixed exception mapSqlError recognizes). Narrowed on the
      // constraint name so an unrelated 23505 elsewhere still falls through
      // to throwMapped's generic handling.
      if (
        (error as { code?: string }).code === "23505" &&
        String((error as { message?: string }).message ?? "").includes("exam_papers_exam_id_class_section_id_subject_id_key")
      ) {
        throw new AppError(
          "validation_failed",
          "One of these sections already has a paper for one of these subjects in this exam.",
          { papers: ["A paper for this section and subject already exists for this exam."] },
        );
      }
      throwMapped(error);
    }

    revalidatePath(`/${ctx.institution.slug}/exams/${input.examId}`);
    return { count: (data ?? []).length };
  },
});

export const openMarksEntry = defineAction({
  name: "exam.marks_entry.open",
  schema: ExamIdSchema,
  permission: "exam.manage",
  handler: async (input: ExamIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("open_marks_entry", {
      p_institution_id: ctx.institution.id,
      p_exam_id: input.examId,
    });
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/exams/${input.examId}`);
    return data as { exam_id: string; status: string };
  },
});

export const closeMarksEntry = defineAction({
  name: "exam.marks_entry.close",
  schema: ExamIdSchema,
  permission: "exam.manage",
  handler: async (input: ExamIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("close_marks_entry", {
      p_institution_id: ctx.institution.id,
      p_exam_id: input.examId,
    });
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/exams/${input.examId}`);
    return data as { exam_id: string; status: string };
  },
});

export const reopenMarksEntry = defineAction({
  name: "exam.marks_entry.reopen",
  schema: ExamIdSchema,
  permission: "exam.manage",
  handler: async (input: ExamIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("reopen_marks_entry", {
      p_institution_id: ctx.institution.id,
      p_exam_id: input.examId,
    });
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/exams/${input.examId}`);
    return data as { exam_id: string; status: string };
  },
});

export const enterMarks = defineAction({
  name: "exam.marks.enter",
  schema: EnterMarksSchema,
  permission: "exam.marks.enter",
  handler: async (input: EnterMarksInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("enter_marks", {
      p_institution_id: ctx.institution.id,
      p_paper_id: input.examPaperId,
      p_rows: input.marks.map((m) => ({
        student_id: m.studentId,
        marks_obtained: m.marksObtained ?? null,
        is_absent: m.isAbsent,
      })),
    });
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/exams`);
    return data as { paper_id: string; entered: number; unchanged: number };
  },
});

export const verifyExam = defineAction({
  name: "exam.verify",
  schema: ExamIdSchema,
  permission: "exam.manage",
  handler: async (input: ExamIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("exam_verification", {
      p_institution_id: ctx.institution.id,
      p_exam_id: input.examId,
    });
    if (error) throwMapped(error);
    return data as {
      missing: Array<{ exam_paper_id: string; class_section_id: string; subject_id: string; student_id: string }>;
      outOfRange: Array<{ exam_paper_id: string; student_id: string; marks_obtained: number; max_marks: number }>;
      summary: { missingCount: number; outOfRangeCount: number; clean: boolean };
    };
  },
});
