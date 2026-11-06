import "server-only";
// Student practice quiz generation (Lane E). Student-only (`ai.study`).
// Only the curriculum unit's own text goes to the model (dataClass "general"
// in effect: buildQuizPrompt has no parameter for student data). Persists
// nothing — the student saves a finished attempt through
// `practice.submitAttempt`, which recomputes the score server-side.
import { NextResponse } from "next/server";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { QuizContentSchema } from "@/modules/ai/quiz.schemas";
import { buildQuizPrompt, PRACTICE_QUIZ_INSTRUCTIONS } from "@/modules/ai/prompts/quiz";
import { PracticeGenerationSchema, PracticeQuizRequestSchema, type PracticeQuestion } from "@/modules/practice/schemas";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
// 15 questions + explanations, same bound rationale as the teacher quiz route.
const MAX_OUTPUT_TOKENS = 3072;

interface PracticeQuizResponseData {
  questions: PracticeQuestion[];
  provider: "local" | "cloud";
  model: string;
}

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  quota_exceeded: 429,
  ai_unavailable: 502,
  ai_policy_blocked: 502,
  ai_invalid_output: 502,
  dependency_failed: 502,
};

function json(result: ActionResult<PracticeQuizResponseData>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (isCrossSiteRequest(request)) {
    return json(fail("forbidden", "Cross-site request refused."));
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.tooLarge) return json(fail("validation_failed", "Request body exceeds 4 KB."));
    return json(fail("validation_failed", "Request body must be JSON."));
  }

  const parsedRequest = PracticeQuizRequestSchema.safeParse(bodyResult.data);
  if (!parsedRequest.success) {
    const { fieldErrors } = parsedRequest.error.flatten();
    return json(fail("validation_failed", "Invalid input.", fieldErrors as Record<string, string[]>));
  }
  const input = parsedRequest.data;

  let ctx: TenantContext;
  try {
    ctx = await getTenantContext(input.institutionSlug);
  } catch (err) {
    const mapped = mapTenantContextError(err);
    if (mapped) return json(mapped);
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/practice-quiz failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "ai.study");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  const studentId = ctx.membership.studentId;
  if (ctx.membership.role !== "student" || !studentId) {
    return json(fail("forbidden", "Practice quizzes are for students."));
  }
  if (!isModuleEnabled(ctx, "practice") || !isModuleEnabled(ctx, "ai_student")) {
    return json(fail("ai_unavailable", "Practice quizzes are not available for your institution."));
  }

  const supabase = await createClient();
  try {
    // Student's active section (own enrolment is readable by the student).
    const { data: enrolment, error: enrolmentError } = await supabase
      .from("enrolments")
      .select("class_section_id")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (enrolmentError) throw enrolmentError;
    if (!enrolment) return json(fail("not_found", "Curriculum unit not found."));

    // RLS (curriculum_units_select) already limits a student to their own grade's units.
    const { data: unit, error: unitError } = await supabase
      .from("curriculum_units")
      .select("id, title, description, grade_id, subject_id")
      .eq("id", input.unitId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (unitError) throw unitError;
    if (!unit) return json(fail("not_found", "Curriculum unit not found."));

    // The unit's subject must be taught in the student's own section.
    const { data: assignment, error: assignmentError } = await supabase
      .from("subject_assignments")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .eq("class_section_id", enrolment.class_section_id)
      .eq("subject_id", unit.subject_id)
      .limit(1)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) return json(fail("not_found", "Curriculum unit not found."));

    const [{ data: grade, error: gradeError }, { data: subject, error: subjectError }] = await Promise.all([
      supabase.from("grades").select("display_name").eq("id", unit.grade_id).maybeSingle(),
      supabase.from("subjects").select("name").eq("id", unit.subject_id).maybeSingle(),
    ]);
    if (gradeError || subjectError) throw gradeError ?? subjectError;

    const prompt = buildQuizPrompt({
      unitTitle: unit.title,
      unitDescription: unit.description,
      gradeLabel: grade?.display_name ?? "",
      subjectName: subject?.name ?? "",
      difficulty: input.difficulty,
      questionCount: input.count,
    });

    const result = await runStructured({
      ctx,
      feature: "practice_quiz",
      permission: "ai.study",
      schema: PracticeGenerationSchema,
      instructions: PRACTICE_QUIZ_INSTRUCTIONS,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!result.ok) return json(result);

    // Same strict re-parse as the teacher route: unique options, answer is one of them.
    const strict = QuizContentSchema.safeParse(result.data.data);
    if (!strict.success) {
      return json(fail("ai_invalid_output", "AI returned output that did not match the expected schema after one repair attempt."));
    }

    const questions: PracticeQuestion[] = strict.data.questions.slice(0, input.count).map((q) => ({
      stem: q.stem,
      options: q.options,
      answerIndex: q.options.indexOf(q.answer),
      ...(q.explanation ? { explanation: q.explanation } : {}),
    }));

    return json(ok({ questions, provider: result.data.provider, model: result.data.model }));
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/practice-quiz failed`, err);
    return json(internalError(correlationId));
  }
}
