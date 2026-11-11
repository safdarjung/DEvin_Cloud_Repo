import "server-only";
// T-036 — AI quiz generation route (04 §3 "Route Handlers /api/ai/*":
// Node, cookie session + `ai.generate`; 06 §W6). Persists nothing — the
// gateway writes only `ai_usage_events` metadata; saving a draft goes
// through `createAssignment` from the client (QuizReviewEditor), which has
// its own full validation and scope check. This route cannot write
// assignments.
import { NextResponse } from "next/server";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { QuizContentSchema, QuizGenerationSchema, QuizRequestSchema, type QuizContent } from "@/modules/ai/quiz.schemas";
import { buildQuizPrompt, QUIZ_GENERATION_INSTRUCTIONS } from "@/modules/ai/prompts/quiz";
import { canGenerateQuizForUnit } from "@/modules/ai/quiz-scope";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fix round 1 (security review, LOW — no body-size cap); helper shared with
// the public enquiry route since DBT-29 (src/lib/http/request.ts).
const MAX_BODY_BYTES = 8 * 1024;

interface QuizResponseData {
  content: QuizContent;
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
}

// Phase 1b production requirement: every request MUST bound output length
// so a stuck/rambling generation can't run unbounded against the local
// model (see T-036-report.md "Phase 1b" — an unbounded string field during
// bisection ran for 7+ minutes pinning the GPU before being cut off). 2048
// matches `scripts/ai-bench/bench.ts`'s own `MAX_TOKENS.quiz` cap, which is
// already proven enough headroom for `questionCount` up to 15 at
// `GENERATION_MAX_STRING_LENGTH`-sized fields.
const MAX_OUTPUT_TOKENS = 2048;

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

function json(result: ActionResult<QuizResponseData>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// `getTenantContext` is written for page rendering: no session → `redirect()`,
// no membership → `notFound()`, both Next.js control-flow throws (04 §4).
// This is a JSON API route, not a page render, so those signals are caught
// here and mapped to the envelope instead of being allowed to produce an
// HTML redirect/404 for an API caller.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  // DBT-29: cookie-authenticated and cost-bearing — refuse cross-site callers.
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

  const parsedRequest = QuizRequestSchema.safeParse(bodyResult.data);
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
    console.error(`[${correlationId}] /api/ai/quiz failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "ai.generate");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  if (!isModuleEnabled(ctx, "ai_teacher")) {
    return json(fail("ai_unavailable", "AI features are not available for your institution."));
  }

  if (!isAiCapabilityEnabled(ctx, "quiz_generator")) {
    return json(fail("ai_unavailable", "This AI feature is turned off for your role."));
  }

  const supabase = await createClient();

  const { data: unit, error: unitError } = await supabase
    .from("curriculum_units")
    .select("id, title, description, grade_id, subject_id")
    .eq("id", input.curriculumUnitId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (unitError) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/quiz failed to load curriculum unit`, unitError);
    return json(internalError(correlationId));
  }
  // `not_found` for a unit outside the caller's institution too — existence
  // of a unit in another tenant is never revealed (06 §1.1).
  if (!unit) {
    return json(fail("not_found", "Curriculum unit not found."));
  }

  let allowed: boolean;
  try {
    allowed = await canGenerateQuizForUnit(supabase, ctx, unit.grade_id, unit.subject_id);
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/quiz scope check failed`, err);
    return json(internalError(correlationId));
  }
  if (!allowed) {
    return json(fail("forbidden", "You do not teach this subject in this grade."));
  }

  const [{ data: grade, error: gradeError }, { data: subject, error: subjectError }] = await Promise.all([
    supabase.from("grades").select("display_name").eq("id", unit.grade_id).maybeSingle(),
    supabase.from("subjects").select("name").eq("id", unit.subject_id).maybeSingle(),
  ]);
  if (gradeError || subjectError) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/quiz failed to load grade/subject`, gradeError ?? subjectError);
    return json(internalError(correlationId));
  }

  const prompt = buildQuizPrompt({
    unitTitle: unit.title,
    unitDescription: unit.description,
    gradeLabel: grade?.display_name ?? "",
    subjectName: subject?.name ?? "",
    difficulty: input.difficulty,
    questionCount: input.questionCount,
  });

  const result = await runStructured({
    ctx,
    feature: "quiz_generation",
    agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06)
    schema: QuizGenerationSchema,
    strictSchema: QuizContentSchema,
    instructions: QUIZ_GENERATION_INSTRUCTIONS,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!result.ok) {
    return json(result);
  }

  // Lead ruling (DBT-27): the generation schema has no refinements, so a
  // model can still produce a duplicate option or an answer that isn't one
  // of the options. Strict-parsing with the real `QuizContentSchema` here
  // is what actually enforces those invariants before anything reaches the
  // teacher's editor.
  const strict = QuizContentSchema.safeParse(result.data.data);
  if (!strict.success) {
    return json(
      fail("ai_invalid_output", "AI returned output that did not match the expected schema after one repair attempt."),
    );
  }

  return json(
    ok({
      content: strict.data,
      provider: result.data.provider,
      model: result.data.model,
      fallback: result.data.fallback,
    }),
  );
}
