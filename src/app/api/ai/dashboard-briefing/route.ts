import "server-only";
// M25-T7 — AI dashboard briefing route: reads the persisted `briefings` row
// first (M19/M25-T4 `ensureBriefing`) and only narrates once a day — later
// readers of an already-narrated row never call the gateway. Request body
// numbers (`DashboardBriefingRequestSchema`) are accepted and ignored until
// Workstream D removes them from `DailyBriefing.tsx`.
import { NextResponse } from "next/server";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { BriefingHeadlineSchema, DashboardBriefingRequestSchema } from "@/modules/ai/dashboard-briefing.schemas";
import { BRIEFING_HEADLINE_INSTRUCTIONS, buildBriefingHeadlinePrompt } from "@/modules/ai/prompts/dashboard-briefing";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import type { BriefRole } from "@/modules/insights/briefing-compose";
import { BRIEF_ROLE_LABEL } from "@/modules/insights/briefing-compose";
import { ensureBriefing, readBriefing, setBriefingHeadline } from "@/modules/insights/briefings";
import type { DailyBrief } from "@/modules/fabric/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

// `BriefingHeadlineSchema.headline` caps at 200 chars (T6) — far less
// headroom than the quiz route's multi-question generation needs.
const MAX_OUTPUT_TOKENS = 256;

interface BriefingResponseData {
  summary: string;
  provider: "local" | "cloud";
  model: string | null;
  fallback: boolean;
  brief: DailyBrief;
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
    requirePermission(ctx, "insight.read");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  if (!isModuleEnabled(ctx, "ai_briefings")) {
    return json(fail("ai_unavailable", "AI features are not available for your institution."));
  }

  try {
    requirePermission(ctx, "ai.generate");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  const ensured = await ensureBriefing(ctx);
  if (!ensured.ok) return json(ensured);

  const { id, provider, brief } = ensured.data;

  // Already narrated (by this call's own `ensureBriefing` read, or by an
  // earlier reader today) — no gateway call, no model column to report.
  if (provider) {
    return json(ok({ summary: brief.headline, provider, model: null, fallback: false, brief }));
  }

  const roleLabel = BRIEF_ROLE_LABEL[brief.role as BriefRole];
  const prompt = buildBriefingHeadlinePrompt({ roleLabel, items: brief.items.map((item) => item.text) });

  const result = await runStructured({
    ctx,
    feature: "dashboard_briefing",
    agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06)
    schema: BriefingHeadlineSchema,
    instructions: BRIEFING_HEADLINE_INSTRUCTIONS,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  // Gateway failure: the row keeps its rules headline; the next call retries.
  if (!result.ok) return json(result);

  const narrated = await setBriefingHeadline(id, result.data.data.headline, result.data.provider);
  if (!narrated) {
    // Another narrator won the race — re-read and return the winning row.
    const latest = await readBriefing(ctx);
    if (latest) {
      return json(
        ok({
          summary: latest.headline,
          provider: latest.generated_by === "cloud_model" ? "cloud" : "local",
          model: null,
          fallback: false,
          brief: latest,
        }),
      );
    }
  }

  const narratedBrief: DailyBrief = {
    ...brief,
    headline: result.data.data.headline,
    generated_by: result.data.provider === "cloud" ? "cloud_model" : "local_model",
  };

  return json(
    ok({
      summary: result.data.data.headline,
      provider: result.data.provider,
      model: result.data.model,
      fallback: result.data.fallback,
      brief: narratedBrief,
    }),
  );
}
