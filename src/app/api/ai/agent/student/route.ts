import "server-only";
// GU-08 — student study chat route. Unlike the teacher route (D28, its own
// parallel path), this one goes through the shared gateway entry point,
// `streamAgent` (GU-05): D32 requires `dataClass: "student_personal"`,
// which `streamAgent` itself hard-blocks to `local_only` institutions and
// refuses the cloud step for unconditionally (no safe redaction path for
// a multi-turn transcript exists yet) — this route does not re-implement
// either of those checks.
//
// DBT-37 fix (security review, MEDIUM — the teacher route's accepted-risk
// shape was NOT reasonable to carry over unchanged for minors on a small
// local model with weak refusal training): `stripToUserText` below keeps
// only `user`/`assistant` roles and only `text` parts, dropping every
// `tool-*`/`reasoning`/`step-start` part before the history ever reaches
// the model. A forged `assistant` turn is the most effective jailbreak
// against a small model, needs only same-origin devtools replay (passes
// `isCrossSiteRequest`), and — unlike the teacher agent — no adult ever
// sees the exchange afterward (D32: student-only, ever). This needs no
// persistence (GU-09 doesn't exist yet): it is a pure filter on each
// request's own echoed history, not a rebuild from stored state.
import { NextResponse } from "next/server";
import { z } from "zod";
import { convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { AppError, fail, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { streamAgent } from "@/lib/ai/gateway";
import { UIMessageRequestSchema } from "@/lib/ai/ui-message-schema";
import { composeStudentInstructions } from "@/modules/ai/prompts/student-skills";
import { getStudentPreferences } from "@/modules/ai/student-preferences";
import { studentTools } from "@/modules/ai/agent/student-tools";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEATURE = "student_study";

// Same scaled-down cap as the teacher route's own short chat turns.
const MAX_OUTPUT_TOKENS = 1024;
const MAX_BODY_BYTES = 64 * 1024;

const StudentAgentRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    messages: z.array(UIMessageRequestSchema).min(1).max(50),
  })
  .passthrough();

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

function json(result: ActionResult<never>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// Same shape as the teacher/quiz/remark routes — `getTenantContext` throws
// Next.js control-flow signals for page rendering; this is a stream API,
// so they're mapped to the envelope instead of an HTML redirect/404.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

// DBT-37 fix — see the module header comment. Only `text` parts of
// `user`/`assistant` messages survive; a message left with zero parts is
// dropped entirely rather than forwarded empty.
function stripToUserText(messages: z.infer<typeof StudentAgentRequestSchema>["messages"]): UIMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part): part is { type: "text"; text: string } => part.type === "text"),
    }))
    .filter((message) => message.parts.length > 0) as unknown as UIMessage[];
}

export async function POST(request: Request): Promise<Response> {
  // DBT-29: cookie-authenticated and cost-bearing — refuse cross-site callers.
  if (isCrossSiteRequest(request)) {
    return json(fail("forbidden", "Cross-site request refused."));
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.tooLarge) {
      return json(fail("validation_failed", `Request body exceeds ${MAX_BODY_BYTES / 1024} KB.`));
    }
    return json(fail("validation_failed", "Request body must be JSON."));
  }

  const parsedRequest = StudentAgentRequestSchema.safeParse(bodyResult.data);
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
    console.error(`[${correlationId}] /api/ai/agent/student failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "ai.study");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  // Unlike the teacher route's own extra role check: `ai.study` is held
  // only by the student role (07 §2.2), so no other role can ever reach
  // past the permission check above — no second check is redundant here.

  // D30/D33 — entitlement: separate from the permission check above,
  // which governs who inside the institution can use the feature at all.
  if (!isFeatureEnabled(ctx, "student_ai_study")) {
    return json(fail("ai_unavailable", "The study assistant is not included in this school's plan."));
  }

  const strippedMessages = stripToUserText(input.messages);
  if (strippedMessages.length === 0) {
    return json(fail("validation_failed", "No readable text in this message."));
  }

  let preferences: Awaited<ReturnType<typeof getStudentPreferences>>;
  let tools: Awaited<ReturnType<typeof studentTools>>;
  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  try {
    const visualsEnabled = isFeatureEnabled(ctx, "student_ai_visuals");
    [preferences, tools, modelMessages] = await Promise.all([
      getStudentPreferences(ctx),
      studentTools(ctx, { visualsEnabled }),
      convertToModelMessages(strippedMessages),
    ]);
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/agent/student failed to prepare the request`, err);
    return json(internalError(correlationId));
  }

  const streamed = await streamAgent({
    ctx,
    feature: FEATURE,
    permission: "ai.study",
    dataClass: "student_personal",
    system: composeStudentInstructions(preferences.skills, preferences.style),
    messages: modelMessages,
    tools,
    // 3, not 6 (the teacher agent's cap): this agent has only two tools,
    // so a long tool-fanout step budget isn't needed (H1 fix).
    stopWhen: stepCountIs(3),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    toolCallConcurrency: 1,
    abortSignal: request.signal,
    // H1 fix: a dedicated bucket so students never compete with teachers'
    // `runStructured` calls for the institution's own local-AI slots.
    concurrencyKey: `${ctx.institution.id}:student`,
  });

  if (!streamed.ok) return json(fail(streamed.error.code, streamed.error.message));

  return streamed.stream.toUIMessageStreamResponse();
}
