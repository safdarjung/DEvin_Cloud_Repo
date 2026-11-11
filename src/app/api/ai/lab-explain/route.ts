import "server-only";
// features-18 §D — "Explain with AI" for Analysis lab panels, a twin
// section, or a simulator result. Body is { kind, ref } only: the numbers
// are re-read server-side under the caller's permissions/RLS
// (labExplainData) and only name-free aggregates reach the model. The
// model narrates; if its text holds a number that is not in its input
// (findUnsupportedNumbers), the deterministic captions are returned
// instead. Persists nothing.
import { NextResponse } from "next/server";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { runStructured } from "@/lib/ai/gateway";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";
import { labExplainData, requireLabAccess, type LabExplainData } from "@/modules/fabric/lab.queries";
import {
  findUnsupportedNumbers,
  LabExplainGenerationSchema,
  LabExplainRequestSchema,
  type LabExplainResponse,
} from "@/modules/fabric/lab.schemas";
import { buildLabExplainPrompt, LAB_EXPLAIN_INSTRUCTIONS } from "@/modules/fabric/lab.prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
// 5 x 200 + 300 chars of JSON; lesson 9 — always cap output.
const MAX_OUTPUT_TOKENS = 1024;

const RULES_CAVEAT =
  "These are patterns in group averages, not proof of cause; check with the staff who know these groups.";
const NOTHING_TO_EXPLAIN = "No group has 5 or more students with data here yet, so there is nothing to explain.";

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

function json(result: ActionResult<LabExplainResponse>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(where: string, err: unknown): ActionResult<never> {
  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}] /api/ai/lab-explain ${where}`, err);
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// Same mapping as report-remark: getTenantContext throws Next control-flow signals.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

function rules(bullets: string[]): ActionResult<LabExplainResponse> {
  return ok({ bullets: bullets.length > 0 ? bullets : [NOTHING_TO_EXPLAIN], caveat: RULES_CAVEAT, source: "rules", provider: null, model: null });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (isCrossSiteRequest(request)) return json(fail("forbidden", "Cross-site request refused."));

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return json(fail("validation_failed", bodyResult.tooLarge ? "Request body exceeds 4 KB." : "Request body must be JSON."));
  }
  const parsed = LabExplainRequestSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return json(fail("validation_failed", "Invalid input.", parsed.error.flatten().fieldErrors as Record<string, string[]>));
  }
  const input = parsed.data;

  let ctx: TenantContext;
  try {
    ctx = await getTenantContext(input.institutionSlug);
  } catch (err) {
    return json(mapTenantContextError(err) ?? internalError("failed to resolve tenant context", err));
  }

  try {
    if (input.kind === "scenario") requirePermission(ctx, "scenario.manage");
    else requireLabAccess(ctx);
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }
  if (!isModuleEnabled(ctx, "ai_briefings") || !isAiCapabilityEnabled(ctx, "lab_explain")) {
    return json(fail("ai_unavailable", "This AI feature is turned off for your role."));
  }

  let facts: LabExplainData | null;
  try {
    facts = await labExplainData(ctx, input);
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    return json(internalError("failed to load analysis", err));
  }
  if (!facts) return json(fail("not_found", "No analysis for this section (fewer than 5 students, or no data yet)."));
  if (Array.isArray(facts.data) && facts.data.length === 0) return json(rules([]));

  const { prompt, dataText } = buildLabExplainPrompt(input.kind, facts.data);
  // No agentCloud: the institution's ai_policy decides (local_only never reaches a cloud provider).
  const generated = await runStructured({
    ctx,
    feature: "lab_explain",
    schema: LabExplainGenerationSchema,
    instructions: LAB_EXPLAIN_INSTRUCTIONS,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!generated.ok) return json(generated);

  const { bullets, caveat } = generated.data.data;
  if (findUnsupportedNumbers([...bullets, caveat].join("\n"), dataText).length > 0) return json(rules(facts.fallback));

  return json(ok({ bullets, caveat, source: "ai", provider: generated.data.provider, model: generated.data.model }));
}
