import "server-only";
// New — teacher attendance-pattern-insight route (04 §3 "Route Handlers
// /api/ai/*", 06 §W6; mirrors /api/ai/quiz/route.ts's own pattern).
// Informational only: never changes grading/status/attendance records.
//
// Input is ALREADY anonymized before it reaches this route — index + plain
// counts/booleans, built server-side by
// `buildAnonymizedAttendancePatterns` (modules/attendance/queries.ts). No
// student name, email, or phone number can reach this handler at all, so
// there is nothing here for `denyNames`/`redact` to strip.
import { NextResponse } from "next/server";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import {
  AttendanceInsightGenerationSchema,
  AttendanceInsightRequestSchema,
  type AttendanceInsightItem,
} from "@/modules/ai/attendance-insight.schemas";
import { ATTENDANCE_INSIGHT_INSTRUCTIONS, buildAttendanceInsightPrompt } from "@/modules/ai/prompts/attendance-insight";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Array of up to 60 small objects; well under this.
const MAX_BODY_BYTES = 16 * 1024;

// Fix round 1 (security review, LOW-2): 1024 could not actually fit the
// schema's own worst case — up to 60 items, each up to a 150-char `note`
// plus JSON punctuation (`{"index":59,"note":"..."}", ~175 bytes) — a full
// section failed closed with `ai_invalid_output` well before the model
// finished. ~175 bytes / ~4 chars-per-token ≈ 44 tokens/item × 60 items ≈
// 2,625 tokens; set here with headroom rather than shrinking the array cap,
// since 60 matches real section sizes (AttendanceRegister's own comment
// notes "45-row sections").
const MAX_OUTPUT_TOKENS = 4096;

interface AttendanceInsightResponseData {
  items: AttendanceInsightItem[];
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

function json(result: ActionResult<AttendanceInsightResponseData>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// Same control-flow mapping as /api/ai/quiz/route.ts — `getTenantContext`
// is written for page rendering (redirect()/notFound()), not a JSON route.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

/**
 * Mirrors `isClassTeacherOrAdmin` in `src/modules/attendance/actions.ts`
 * (that file's own narrowing: the section's own class teacher, or
 * owner/principal/admin — narrower than `attendance.read`'s RLS/permission
 * grant alone). Duplicated here, not imported, because `actions.ts` is a
 * `"use server"` module whose exports must all be async server actions —
 * it cannot export a plain sync helper.
 */
function isClassTeacherOrAdmin(ctx: TenantContext, classTeacherId: string | null): boolean {
  if (ctx.membership.role === "owner" || ctx.membership.role === "principal" || ctx.membership.role === "admin") {
    return true;
  }
  return Boolean(ctx.membership.staffId && classTeacherId === ctx.membership.staffId);
}

export async function POST(request: Request): Promise<NextResponse> {
  // DBT-29: cookie-authenticated and cost-bearing — refuse cross-site callers.
  if (isCrossSiteRequest(request)) {
    return json(fail("forbidden", "Cross-site request refused."));
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.tooLarge) {
      return json(fail("validation_failed", "Request body exceeds 16 KB."));
    }
    return json(fail("validation_failed", "Request body must be JSON."));
  }

  const parsedRequest = AttendanceInsightRequestSchema.safeParse(bodyResult.data);
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
    console.error(`[${correlationId}] /api/ai/attendance-insight failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "attendance.read");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  if (!isModuleEnabled(ctx, "ai_briefings")) {
    return json(fail("ai_unavailable", "AI features are not available for your institution."));
  }

  const supabase = await createClient();
  const { data: section, error: sectionError } = await supabase
    .from("class_sections")
    .select("id, class_teacher_id")
    .eq("id", input.classSectionId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (sectionError) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/attendance-insight failed to load section`, sectionError);
    return json(internalError(correlationId));
  }
  // `not_found` for a section outside the caller's institution too —
  // existence of a section in another tenant is never revealed (06 §1.1).
  if (!section) {
    return json(fail("not_found", "Class section not found."));
  }
  if (!isClassTeacherOrAdmin(ctx, section.class_teacher_id)) {
    return json(fail("forbidden", "You are not the class teacher of this section."));
  }

  const result = await runStructured({
    ctx,
    feature: "attendance_pattern_insight",
    agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06)
    schema: AttendanceInsightGenerationSchema,
    instructions: ATTENDANCE_INSIGHT_INSTRUCTIONS,
    prompt: buildAttendanceInsightPrompt(input.students),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!result.ok) {
    return json(result);
  }

  return json(
    ok({
      items: result.data.data.items,
      provider: result.data.provider,
      model: result.data.model,
      fallback: result.data.fallback,
    }),
  );
}
