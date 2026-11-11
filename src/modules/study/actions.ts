"use server";

// Study studio writes (migration 0138). Student actions are `ai.study`
// (student only) on their own rows; teacher actions are `resource.manage`
// and RLS lets only a teacher save teacher material and share it with a
// section they teach. AI output reaches these tables only when a person
// saves it (rule 6). Quiz scores here are practice: nothing writes marks or
// results. Student actions are not audited with content (D32 spirit: no
// staff reader of a student's study material).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { createClient } from "@/lib/supabase/server";
import { istDay } from "@/modules/practice/scoring";
import { allocatePlan, capacityFromTimetable, type PlanItem } from "@/modules/study/planner";
import { AI_POINTS_PER_SHORT, answersFitQuestions, autoMark } from "@/modules/study/quiz";
import {
  LogSessionSchema,
  MaterialIdSchema,
  ReviewCardSchema,
  SaveMaterialSchema,
  SavePlanSchema,
  SubmitQuizSchema,
  TeacherSaveMaterialSchema,
  TogglePlanItemSchema,
} from "@/modules/study/schemas";
import { insertMaterial } from "@/modules/study/material-write";
import { DeckStateSchema, reviewCard } from "@/modules/study/srs";
import { timetableForStudent } from "@/modules/timetable/queries";

type Client = Awaited<ReturnType<typeof createClient>>;
type JsonValue = NonNullable<Json>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function ownStudentId(ctx: TenantContext): string {
  if (!ctx.membership.studentId) throw new AppError("forbidden", "The study studio is for students.");
  return ctx.membership.studentId;
}

// ---------------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------------

export const saveStudyMaterial = defineAction({
  name: "study.material.save",
  module: "ai_student",
  schema: SaveMaterialSchema,
  permission: "ai.study",
  handler: async (input, ctx) => {
    ownStudentId(ctx);
    const supabase = await createClient();
    return { id: await insertMaterial(supabase, ctx, input, "student") };
  },
});

export const deleteStudyMaterial = defineAction({
  name: "study.material.delete",
  module: "ai_student",
  schema: MaterialIdSchema,
  permission: "ai.study",
  handler: async ({ materialId }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("study_materials")
      .delete()
      .eq("institution_id", ctx.institution.id)
      .eq("id", materialId)
      .eq("user_id", ctx.user.id)
      .select("id");
    if (error) throwMapped(error);
    if (!data?.length) throw new AppError("not_found", "That item was not found.");
    return { id: materialId };
  },
});

export const reviewStudyCard = defineAction({
  name: "study.deck.review",
  module: "ai_student",
  schema: ReviewCardSchema,
  permission: "ai.study",
  handler: async ({ materialId, cardId, grade }, ctx) => {
    const studentId = ownStudentId(ctx);
    const supabase = await createClient();
    // RLS: own decks and decks shared with the student's section only.
    const { data: deck, error } = await supabase
      .from("study_materials")
      .select("id, format, content")
      .eq("institution_id", ctx.institution.id)
      .eq("id", materialId)
      .maybeSingle();
    if (error) throwMapped(error);
    const cards = (deck?.content as { cards?: { id: string }[] } | null)?.cards ?? [];
    if (!deck || deck.format !== "flashcards" || !cards.some((c) => c.id === cardId)) throw new AppError("not_found", "That card was not found.");

    const { data: progress, error: pError } = await supabase
      .from("study_deck_progress")
      .select("state, reviews")
      .eq("material_id", materialId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (pError) throwMapped(pError);
    const parsed = DeckStateSchema.safeParse(progress?.state ?? {});
    const states = parsed.success ? parsed.data : {};
    const next = reviewCard(states[cardId], grade, istDay(new Date()));
    const state = { ...states, [cardId]: next } as JsonValue;
    const now = new Date().toISOString();

    // shortcut: read-modify-write of one JSON row; two reviews racing from the same student can drop one. Fine for one person drilling.
    const { error: wError } = progress
      ? await supabase
          .from("study_deck_progress")
          .update({ state, reviews: progress.reviews + 1, last_reviewed_at: now })
          .eq("material_id", materialId)
          .eq("student_id", studentId)
      : await supabase
          .from("study_deck_progress")
          .insert({ material_id: materialId, institution_id: ctx.institution.id, student_id: studentId, state, reviews: 1, last_reviewed_at: now });
    if (wError) throwMapped(wError);
    return { cardId, next };
  },
});

export const submitStudyQuiz = defineAction({
  name: "study.quiz.submit",
  module: "ai_student",
  schema: SubmitQuizSchema,
  permission: "ai.study",
  handler: async (input, ctx) => {
    const studentId = ownStudentId(ctx);
    if (!answersFitQuestions(input.questions, input.answers)) throw new AppError("validation_failed", "Each answer must match its question.");
    const marked = autoMark(input.questions, input.answers);
    if (input.aiChecks.length !== 0 && input.aiChecks.length !== marked.shortCount) {
      throw new AppError("validation_failed", "AI checks must cover every short answer.");
    }
    // Unanswered short answers score 0 whatever the client sent.
    const shortVerdicts = marked.verdicts.filter((_, i) => input.questions[i]!.type === "short");
    const aiPoints = input.aiChecks.reduce((n, c, i) => n + (shortVerdicts[i] === "ai_check" ? c.score : 0), 0);
    const aiMax = input.aiChecks.length ? marked.shortCount * AI_POINTS_PER_SHORT : 0;
    if (marked.autoMax + aiMax === 0) throw new AppError("validation_failed", "Answer at least one question to save this quiz.");

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("study_quiz_attempts")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        material_id: input.materialId ?? null,
        subject_id: input.subjectId ?? null,
        curriculum_unit_id: input.unitId ?? null,
        title: input.title,
        difficulty: input.difficulty,
        questions: input.questions as JsonValue,
        answers: input.answers as JsonValue,
        ai_checks: input.aiChecks as JsonValue,
        auto_score: marked.autoScore,
        auto_max: marked.autoMax,
        ai_points: aiPoints,
        ai_max: aiMax,
        duration_seconds: input.durationSeconds,
      })
      .select("id")
      .single();
    if (error) throwMapped(error);
    const { error: sError } = await supabase.from("study_sessions").insert({
      institution_id: ctx.institution.id,
      student_id: studentId,
      activity: "quiz",
      minutes: Math.min(240, Math.max(1, Math.round(input.durationSeconds / 60))),
      subject_id: input.subjectId ?? null,
      material_id: input.materialId ?? null,
    });
    if (sError) throwMapped(sError);
    return { attemptId: data.id, autoScore: marked.autoScore, autoMax: marked.autoMax, aiPoints, aiMax, verdicts: marked.verdicts };
  },
});

/** Free minutes per weekday from the student's real timetable (periods per day), when the timetable module is on. */
async function freeMinutes(ctx: TenantContext, studentId: string, minutesPerDay: number): Promise<Record<number, number> | undefined> {
  if (!isModuleEnabled(ctx, "timetable")) return undefined;
  const slots = await timetableForStudent(ctx, studentId);
  const periods: Record<number, number> = {};
  for (const s of slots) periods[s.weekday % 7] = (periods[s.weekday % 7] ?? 0) + 1;
  return capacityFromTimetable(periods, minutesPerDay);
}

export const saveStudyPlan = defineAction({
  name: "study.plan.save",
  module: "ai_student",
  schema: SavePlanSchema,
  permission: "ai.study",
  handler: async (input, ctx) => {
    const studentId = ownStudentId(ctx);
    const today = istDay(new Date());
    if (input.targetDate <= today) throw new AppError("validation_failed", "Pick a date after today.", { targetDate: ["Pick a date after today."] });
    const items = allocatePlan({
      today,
      targetDate: input.targetDate,
      minutesPerDay: input.minutesPerDay,
      topics: input.topics,
      freeMinutesByWeekday: await freeMinutes(ctx, studentId, input.minutesPerDay),
    });
    if (items.length === 0) throw new AppError("validation_failed", "No study time fits before that date. Pick a later date or more minutes.");

    const supabase = await createClient();
    const { error: aError } = await supabase
      .from("study_plans")
      .update({ status: "archived" })
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .eq("status", "active");
    if (aError) throwMapped(aError);
    const { data, error } = await supabase
      .from("study_plans")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        title: input.title,
        exam_label: input.examLabel ?? null,
        start_date: today,
        target_date: input.targetDate,
        minutes_per_day: input.minutesPerDay,
        items: items as unknown as JsonValue,
      })
      .select("id")
      .single();
    if (error) throwMapped(error);
    return { planId: data.id, items: items.length };
  },
});

export const toggleStudyPlanItem = defineAction({
  name: "study.plan.toggleItem",
  module: "ai_student",
  schema: TogglePlanItemSchema,
  permission: "ai.study",
  handler: async ({ planId, index, done }, ctx) => {
    const studentId = ownStudentId(ctx);
    const supabase = await createClient();
    const { data: plan, error } = await supabase
      .from("study_plans")
      .select("items")
      .eq("institution_id", ctx.institution.id)
      .eq("id", planId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (error) throwMapped(error);
    const items = (plan?.items ?? []) as unknown as PlanItem[];
    if (!plan || !items[index]) throw new AppError("not_found", "That plan item was not found.");
    const next = items.map((item, i) => (i === index ? { ...item, done } : item));
    const { error: uError } = await supabase.from("study_plans").update({ items: next as unknown as JsonValue }).eq("id", planId).eq("student_id", studentId);
    if (uError) throwMapped(uError);
    return { planId, index, done };
  },
});

export const logStudySession = defineAction({
  name: "study.session.log",
  module: "ai_student",
  schema: LogSessionSchema,
  permission: "ai.study",
  handler: async (input, ctx) => {
    const studentId = ownStudentId(ctx);
    const supabase = await createClient();
    const { error } = await supabase.from("study_sessions").insert({
      institution_id: ctx.institution.id,
      student_id: studentId,
      activity: input.activity,
      minutes: input.minutes,
      subject_id: input.subjectId ?? null,
      material_id: input.materialId ?? null,
    });
    if (error) throwMapped(error);
    return { minutes: input.minutes };
  },
});

// ---------------------------------------------------------------------------
// Teacher (RLS: teacher role, own material, sections they teach)
// ---------------------------------------------------------------------------

async function addSections(supabase: Client, ctx: TenantContext, materialId: string, sectionIds: readonly string[]): Promise<void> {
  if (sectionIds.length === 0) return;
  const { error } = await supabase
    .from("study_material_sections")
    .insert(sectionIds.map((id) => ({ material_id: materialId, institution_id: ctx.institution.id, class_section_id: id })));
  if (error) throwMapped(error);
}

export const saveTeacherStudyMaterial = defineAction({
  name: "study.teacher.material.save",
  module: "ai_teacher",
  schema: TeacherSaveMaterialSchema,
  permission: "resource.manage",
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const id = await insertMaterial(supabase, ctx, input, "teacher");
    const sectionIds = [...new Set(input.sectionIds)];
    try {
      await addSections(supabase, ctx, id, sectionIds);
    } catch (err) {
      // A refused share (a section the teacher does not teach) must not leave an unshared copy behind.
      await supabase.from("study_materials").delete().eq("id", id).eq("user_id", ctx.user.id);
      throw err;
    }
    await audit(ctx, { action: "study.material.share", entityType: "study_materials", entityId: id, after: { format: input.format, sectionCount: sectionIds.length } });
    return { id };
  },
});

export const deleteTeacherStudyMaterial = defineAction({
  name: "study.teacher.material.delete",
  module: "ai_teacher",
  schema: MaterialIdSchema,
  permission: "resource.manage",
  handler: async ({ materialId }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("study_materials")
      .delete()
      .eq("institution_id", ctx.institution.id)
      .eq("id", materialId)
      .eq("user_id", ctx.user.id)
      .eq("owner_role", "teacher")
      .select("id");
    if (error) throwMapped(error);
    if (!data?.length) throw new AppError("not_found", "That material was not found.");
    await audit(ctx, { action: "study.material.delete", entityType: "study_materials", entityId: materialId });
    return { id: materialId };
  },
});
