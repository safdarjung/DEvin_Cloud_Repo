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
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import {
  CreateExamPapersSchema,
  CreateExamSchema,
  DecideRecheckSchema,
  EnterMarksSchema,
  ExamIdSchema,
  RecheckIdSchema,
  RequestRecheckSchema,
  SaveResultRemarkSchema,
  type CreateExamInput,
  type CreateExamPapersInput,
  type DecideRecheckInput,
  type EnterMarksInput,
  type ExamIdInput,
  type RecheckIdInput,
  type RequestRecheckInput,
  type SaveResultRemarkInput,
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

export const publishExamResults = defineAction({
  name: "exam.result.publish",
  schema: ExamIdSchema,
  permission: "exam.result.publish",
  handler: async (input: ExamIdInput, ctx) => {
    const supabase = await createClient();

    // The exam id is proven to belong to ctx.institution before the RPC
    // call (CLAUDE.md rule 10) — app.publish_exam_results (0009/0018) takes
    // only p_exam_id, not an institution id, so this check is the only
    // thing standing between a guessed exam id and another institution's
    // results.
    const { data: exam, error: examError } = await supabase
      .from("exams")
      .select("id")
      .eq("id", input.examId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (examError) throwMapped(examError);
    if (!exam) throw new AppError("not_found", "Exam not found.");

    const { data, error } = await supabase.rpc("publish_exam_results", { p_exam_id: input.examId });
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/exams/${input.examId}`);
    revalidatePath(`/${ctx.institution.slug}/exams/${input.examId}/results`);
    return data as { exam_id: string; result_count: number };
  },
});

// T-020 — recheck workflow (06 §W8). All three RPCs
// (20261028000022_recheck_rpcs.sql) do their own role/ownership/state
// checks and bypass RLS as `security definer` — same shape as
// enterMarks/publishExamResults above; these actions never touch
// `recheck_requests`/`marks`/`results` directly.
export const requestRecheck = defineAction({
  name: "exam.recheck.request",
  schema: RequestRecheckSchema,
  permission: "exam.recheck.request",
  handler: async (input: RequestRecheckInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("request_recheck", {
      p_institution_id: ctx.institution.id,
      p_result_id: input.resultId,
      p_exam_paper_id: input.examPaperId,
      p_reason: input.reason,
    });
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/portal/results`);
    revalidatePath(`/${ctx.institution.slug}/exams/rechecks`);
    return data as { request_id: string; status: string };
  },
});

export const startRecheckReview = defineAction({
  name: "exam.recheck.review",
  schema: RecheckIdSchema,
  permission: "exam.recheck.review",
  handler: async (input: RecheckIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("start_recheck_review", {
      p_institution_id: ctx.institution.id,
      p_request_id: input.requestId,
    });
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/exams/rechecks`);
    revalidatePath(`/${ctx.institution.slug}/exams/rechecks/${input.requestId}`);
    return data as { request_id: string; status: string };
  },
});

export const decideRecheck = defineAction({
  name: "exam.recheck.decide",
  schema: DecideRecheckSchema,
  permission: "exam.recheck.decide",
  handler: async (input: DecideRecheckInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("apply_recheck_decision", {
      p_request_id: input.requestId,
      p_decision: input.decision,
      // The generated RPC Args type doesn't reflect SQL nullability for
      // scalar params — same cast precedent as admissions/finance actions
      // (e.g. src/modules/admissions/actions.ts's p_note/p_roll_no).
      p_new_marks: (input.newMarks ?? null) as number,
      p_note: (input.note ?? null) as string,
    });
    if (error) throwMapped(error);
    revalidatePath(`/${ctx.institution.slug}/exams/rechecks`);
    revalidatePath(`/${ctx.institution.slug}/exams/rechecks/${input.requestId}`);
    revalidatePath(`/${ctx.institution.slug}/portal/results`);
    return data as { request_id: string; decision: string; marks_id?: string; result_id?: string; decision_id: string };
  },
});

// T-0NN — result remarks (07 §2.2 exam.marks.enter). `result_remarks`
// (0047) is mutable (rule 5 does not apply — editorial commentary, not a
// mark), but a Postgrest upsert would set `created_by = excluded.created_by`
// on every column in the payload including on the UPDATE path, which trips
// 0047's created_by-immutability guard trigger the moment a *different*
// in-scope teacher (or exam_controller) edits an existing remark. Select-
// then-branch instead: UPDATE never touches `created_by`; only a fresh
// INSERT sets it. RLS (result_remarks_insert/_update) is the real write-
// scope enforcement either way; this action only proves the result belongs
// to the caller's institution first (rule 10).
//
// Fix round 1 (independent security review):
//   LOW-1 — the `results` lookup now also requires `superseded_by is null`
//   (app-layer mirror of 0048's RLS fix), so writing against a
//   since-superseded result version reports a clean `not_found` instead of
//   a raw RLS-policy-violation error, and the remark can never be orphaned
//   against a version a recheck has already replaced.
//   MED-3 — any in-scope teacher/controller can overwrite another's saved
//   remark with no audit trail before this fix. `audit()` now runs on
//   every save (create or update), recording the real actor + timestamp via
//   `record_audit_event` — never the remark text itself (no free-form user
//   content in audit before/after/metadata). Chosen over adding an
//   `updated_by` column: smaller change, no RLS/schema touch.
export const saveResultRemark = defineAction({
  name: "exam.remark.save",
  schema: SaveResultRemarkSchema,
  permission: "exam.marks.enter",
  handler: async (input: SaveResultRemarkInput, ctx) => {
    const supabase = await createClient();

    const { data: result, error: resultError } = await supabase
      .from("results")
      .select("id")
      .eq("id", input.resultId)
      .eq("institution_id", ctx.institution.id)
      .is("superseded_by", null)
      .maybeSingle();
    if (resultError) throwMapped(resultError);
    if (!result) throw new AppError("not_found", "Result not found.");

    const { data: existing, error: existingError } = await supabase
      .from("result_remarks")
      .select("id")
      .eq("result_id", input.resultId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (existingError) throwMapped(existingError);

    let saved: { id: string; remark: string };
    if (existing) {
      const { data, error } = await supabase
        .from("result_remarks")
        .update({ remark: input.remark })
        .eq("id", existing.id)
        .select("id, remark")
        .single();
      if (error) throwMapped(error);
      saved = { id: data.id as string, remark: data.remark as string };
    } else {
      const { data, error } = await supabase
        .from("result_remarks")
        .insert({
          institution_id: ctx.institution.id,
          result_id: input.resultId,
          remark: input.remark,
          created_by: ctx.user.id,
        })
        .select("id, remark")
        .single();
      if (error) throwMapped(error);
      saved = { id: data.id as string, remark: data.remark as string };
    }

    await audit(ctx, {
      action: "exam.remark.save",
      entityType: "result_remark",
      entityId: saved.id,
      metadata: { resultId: input.resultId, created: !existing },
    });

    return saved;
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
