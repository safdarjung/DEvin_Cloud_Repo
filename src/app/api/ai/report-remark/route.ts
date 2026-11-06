import "server-only";
// T-0NN — AI report-card remark draft route (04 §3 "Route Handlers
// /api/ai/*": Node, cookie session + `ai.generate`; 06 §W10), same shape
// as src/app/api/ai/quiz/route.ts. Persists nothing — saving the edited
// draft goes through `saveResultRemark` (src/modules/exams/actions.ts),
// which has its own full validation and scope check. This route cannot
// write a remark on its own.
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { uuid } from "@/lib/schemas/common";
import { RemarkGenerationSchema } from "@/modules/ai/remark.schemas";
import { buildRemarkPrompt, REMARK_GENERATION_INSTRUCTIONS } from "@/modules/ai/prompts/remark";
import { canDraftRemarkForResult } from "@/modules/ai/remark-scope";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

// Matches the quiz route's constant (T-036: unbounded output pinned the
// local model's GPU for 7+ minutes during bisection; see that route's
// comment). The remark field is capped at 500 chars either way (lesson 9).
const MAX_OUTPUT_TOKENS = 2048;

const RemarkRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    resultId: uuid,
  })
  .strict();

interface RemarkResponseData {
  remark: string;
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
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

function json(result: ActionResult<RemarkResponseData>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// Same shape as the quiz route — `getTenantContext` throws Next.js
// control-flow signals for page rendering; this is a JSON API, so they're
// mapped to the envelope instead of becoming an HTML redirect/404.
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
    if (bodyResult.tooLarge) {
      return json(fail("validation_failed", "Request body exceeds 8 KB."));
    }
    return json(fail("validation_failed", "Request body must be JSON."));
  }

  const parsedRequest = RemarkRequestSchema.safeParse(bodyResult.data);
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
    console.error(`[${correlationId}] /api/ai/report-remark failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "exam.marks.enter");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  if (!isModuleEnabled(ctx, "ai_teacher")) {
    return json(fail("ai_unavailable", "AI features are not available for your institution."));
  }

  const supabase = await createClient();

  const { data: result, error: resultError } = await supabase
    .from("results")
    .select("student_id, snapshot, percentage, grade, exams(name)")
    .eq("id", input.resultId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (resultError) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/report-remark failed to load result`, resultError);
    return json(internalError(correlationId));
  }
  // `not_found` for a result outside the caller's institution too —
  // existence of a result in another tenant is never revealed (06 §1.1).
  if (!result) {
    return json(fail("not_found", "Result not found."));
  }

  let allowed: boolean;
  try {
    allowed = await canDraftRemarkForResult(supabase, ctx, result.student_id);
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/report-remark scope check failed`, err);
    return json(internalError(correlationId));
  }
  if (!allowed) {
    return json(fail("forbidden", "You do not teach this student."));
  }

  const snapshot = result.snapshot as {
    subjects: Array<{
      subject_id: string;
      marks_obtained: number | null;
      max_marks: number;
      is_absent: boolean;
      grade: string | null;
    }>;
  };
  const subjectIds = [...new Set(snapshot.subjects.map((s) => s.subject_id))];
  const { data: subjects, error: subjectsError } =
    subjectIds.length > 0
      ? await supabase.from("subjects").select("id, name").eq("institution_id", ctx.institution.id).in("id", subjectIds)
      : { data: [], error: null };
  if (subjectsError) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/report-remark failed to load subjects`, subjectsError);
    return json(internalError(correlationId));
  }
  const subjectNameById = new Map((subjects ?? []).map((s) => [s.id, s.name]));

  const exam = result.exams as { name: string } | null;

  // Only subject names/marks/grade cross the AI boundary (07 §5) — never
  // the student's name, admission number, or any other identifier. The
  // draft refers to the student only via the literal `{studentLabel}`
  // placeholder, substituted client-side.
  const prompt = buildRemarkPrompt({
    examName: exam?.name ?? "",
    overallGrade: result.grade,
    percentage: result.percentage,
    subjects: snapshot.subjects.map((s) => ({
      subjectName: subjectNameById.get(s.subject_id) ?? "",
      marksObtained: s.marks_obtained,
      maxMarks: s.max_marks,
      isAbsent: s.is_absent,
      grade: s.grade,
    })),
  });

  const generated = await runStructured({
    ctx,
    feature: "result_remark_draft",
    agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06)
    schema: RemarkGenerationSchema,
    instructions: REMARK_GENERATION_INSTRUCTIONS,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!generated.ok) {
    return json(generated);
  }

  return json(
    ok({
      remark: generated.data.data.remark,
      provider: generated.data.provider,
      model: generated.data.model,
      fallback: generated.data.fallback,
    }),
  );
}
