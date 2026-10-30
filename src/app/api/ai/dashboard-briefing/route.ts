import "server-only";
// T-0NN — AI dashboard briefing route (04 §3 "Route Handlers /api/ai/*";
// mirrors src/app/api/ai/quiz/route.ts's pattern). Input is the SAME
// institution-wide aggregates `DashboardPage` already computed via
// `getDashboardData` — this route re-queries nothing, so no PII and no new
// DB read ever enters it or the prompt (CLAUDE.md rule 6).
import { NextResponse } from "next/server";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import {
  DashboardBriefingOutputSchema,
  DashboardBriefingRequestSchema,
  type DashboardBriefingOutput,
} from "@/modules/ai/dashboard-briefing.schemas";
import { buildDashboardBriefingPrompt, DASHBOARD_BRIEFING_INSTRUCTIONS } from "@/modules/ai/prompts/dashboard-briefing";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

// A 2-3 sentence summary needs far less headroom than the quiz route's
// multi-question generation (MAX_OUTPUT_TOKENS = 2048 there). 512 is already
// generous for a 500-char capped `summary` field and is cheaper per call.
const MAX_OUTPUT_TOKENS = 512;

interface BriefingResponseData {
  summary: string;
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

function json(result: ActionResult<BriefingResponseData>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// Same reasoning as the quiz route: `getTenantContext` is written for page
// rendering (redirect()/notFound() throws); this is a JSON API route, so
// those control-flow throws are mapped to the envelope instead.
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

  const parsedRequest = DashboardBriefingRequestSchema.safeParse(bodyResult.data);
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
    console.error(`[${correlationId}] /api/ai/dashboard-briefing failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "dashboard.view");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  const prompt = buildDashboardBriefingPrompt(input);

  const result = await runStructured({
    ctx,
    feature: "dashboard_briefing",
    schema: DashboardBriefingOutputSchema,
    instructions: DASHBOARD_BRIEFING_INSTRUCTIONS,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!result.ok) {
    return json(result);
  }

  const output: DashboardBriefingOutput = result.data.data;

  return json(
    ok({
      summary: output.summary,
      provider: result.data.provider,
      model: result.data.model,
      fallback: result.data.fallback,
    }),
  );
}
