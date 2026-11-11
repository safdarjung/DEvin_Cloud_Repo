import "server-only";
// features-18 §D — "Describe a scenario": free text -> simulator slider
// values (same route shape as ../report-remark/route.ts). The model only
// structures the text; every value is clamped server-side to the slider
// ranges (clampScenarioAssumptions) and the person reviews the proposal
// before applying it. Persists nothing.
import { NextResponse } from "next/server";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { runStructured } from "@/lib/ai/gateway";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";
import type { ScenarioAssumptions } from "@/modules/fabric/types";
import { clampScenarioAssumptions, LabScenarioGenerationSchema, LabScenarioRequestSchema } from "@/modules/fabric/lab.schemas";
import { buildLabScenarioPrompt, LAB_SCENARIO_INSTRUCTIONS } from "@/modules/fabric/lab.prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
// Six nullable numbers; lesson 9 — always cap output.
const MAX_OUTPUT_TOKENS = 512;

interface LabScenarioResponseData {
  assumptions: Partial<ScenarioAssumptions>;
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

function json(result: ActionResult<LabScenarioResponseData>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

// Same mapping as report-remark: getTenantContext throws Next control-flow signals.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (isCrossSiteRequest(request)) return json(fail("forbidden", "Cross-site request refused."));

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return json(fail("validation_failed", bodyResult.tooLarge ? "Request body exceeds 4 KB." : "Request body must be JSON."));
  }
  const parsed = LabScenarioRequestSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return json(fail("validation_failed", "Invalid input.", parsed.error.flatten().fieldErrors as Record<string, string[]>));
  }
  const input = parsed.data;

  let ctx: TenantContext;
  try {
    ctx = await getTenantContext(input.institutionSlug);
  } catch (err) {
    const mapped = mapTenantContextError(err);
    if (mapped) return json(mapped);
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/lab-scenario failed to resolve tenant context`, err);
    return json(fail("internal", `Something went wrong. Reference: ${correlationId}`));
  }

  try {
    requirePermission(ctx, "scenario.manage");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }
  if (!isModuleEnabled(ctx, "ai_briefings") || !isAiCapabilityEnabled(ctx, "lab_scenario")) {
    return json(fail("ai_unavailable", "This AI feature is turned off for your role."));
  }

  const generated = await runStructured({
    ctx,
    feature: "lab_scenario",
    agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06); redacted on the cloud path
    schema: LabScenarioGenerationSchema,
    instructions: LAB_SCENARIO_INSTRUCTIONS,
    prompt: buildLabScenarioPrompt(input.text),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!generated.ok) return json(generated);

  return json(
    ok({
      assumptions: clampScenarioAssumptions(generated.data.data),
      provider: generated.data.provider,
      model: generated.data.model,
    }),
  );
}
