import "server-only";
// F-BE-19 — Laya visual router bridge (04 §3 "Route Handlers /api/ai/*"
// pattern, mirrors /api/ai/attendance-insight/route.ts). Laya is a local
// classifier bridge, not an LLM — it answers yes/no probability questions
// about UI state so the client can pick a chart/table/diagram/text variant.
// Not a gateway.ts call (06 §W6/CLAUDE.md rule 6 covers model generation
// that produces content a human saves; this never writes marks, payments,
// access, or welfare decisions — it only picks a UI shape). Demo must never
// break: any failure reaching or parsing the bridge returns `{ok:true,
// data:null}` at 200, never a 5xx. Never logs env values or request state.
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_QUESTIONS = 6;
const BRIDGE_TIMEOUT_MS = 2000;

const NoulQuestionSchema = z
  .object({
    type: z.literal("noul"),
    instructions: z.string().trim().min(1).max(300),
    criteria: z
      .object({ true: z.string().max(300).optional(), false: z.string().max(300).optional() })
      .strict()
      .optional(),
  })
  .strict();

const GenuiRouteRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    state: z.string().max(2000),
    questions: z.record(z.string(), NoulQuestionSchema).refine((q) => Object.keys(q).length <= MAX_QUESTIONS, {
      message: `At most ${MAX_QUESTIONS} questions.`,
    }),
  })
  .strict();

type GenuiRouteResponseData = Record<string, { noul: number }> | null;

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
};

function json(result: ActionResult<GenuiRouteResponseData>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// Same control-flow mapping as attendance-insight/route.ts — getTenantContext
// is written for page rendering (redirect()/notFound()), not a JSON route.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

/**
 * Calls the Laya bridge. Any failure — env unset, timeout, non-200
 * response, or a body that isn't the expected shape — resolves to `null`
 * rather than throwing, so the caller always has a safe demo fallback.
 */
async function callLayaBridge(
  state: string,
  questions: z.infer<typeof GenuiRouteRequestSchema>["questions"],
): Promise<Record<string, { noul: number }> | null> {
  const bridgeUrl = process.env.LAYA_BRIDGE_URL;
  if (!bridgeUrl) return null;

  try {
    const res = await fetch(bridgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, questions }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("answers" in body)) return null;
    const answers = (body as { answers: unknown }).answers;
    if (typeof answers !== "object" || answers === null) return null;

    const result: Record<string, { noul: number }> = {};
    for (const [id, value] of Object.entries(answers as Record<string, unknown>)) {
      const noul = (value as { noul?: unknown } | null)?.noul;
      if (typeof noul !== "number" || !Number.isFinite(noul)) return null;
      result[id] = { noul };
    }
    return result;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  // DBT-29: cookie-authenticated — refuse cross-site callers.
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

  const parsedRequest = GenuiRouteRequestSchema.safeParse(bodyResult.data);
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
    console.error(`[${correlationId}] /api/ai/genui-route failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "ai.generate");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  const answers = await callLayaBridge(input.state, input.questions);
  return json(ok(answers));
}
