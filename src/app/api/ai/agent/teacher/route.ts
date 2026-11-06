import "server-only";
// T-0NN — teacher tool-calling chat agent route (D28: a parallel path,
// deliberately out of band from runStructured/resolvePlan/gateway.ts's
// local/cloud institution policy — see 12-decision-log.md ADR D28 for the
// full rationale. D29 adds Groq as a second, routine-tier provider,
// routed by `pickAgentProvider` — see that ADR for the routing rule and
// its honest limits).
// Shares the quiz/report-remark routes' cross-site guard, body cap, and
// tenant-context/permission-error mapping; shares the gateway's own quota,
// concurrency, and usage-logging discipline (`checkLimits`,
// `acquireConcurrencySlot`/`releaseConcurrencySlot`, `logUsage`) without
// touching the gateway module itself.
import { NextResponse } from "next/server";
import { z } from "zod";
import { convertToModelMessages, type UIMessage } from "ai";
import { AppError, fail, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { pickAgentProvider } from "@/modules/ai/agent/provider-routing";
import { cloudStreamErrorText, streamCloudAgent } from "@/modules/ai/agent/cloud-stream";
import { teacherTools } from "@/modules/ai/agent/teacher-tools";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { UIMessageRequestSchema, latestUserText } from "@/lib/ai/ui-message-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEATURE = "teacher_agent";

// Chat bodies carry the running message history (unlike the quiz/remark
// routes' single-shot ~8 KB payloads), so this is a larger cap than
// theirs — still bounded, never unbounded.
const MAX_BODY_BYTES = 64 * 1024;

// Fix round 1 (security review, HIGH): a loose `z.record(unknown)` part
// schema let a client smuggle in a `file` part with an arbitrary https
// URL — the AI SDK downloads it server-side (cap ~2 GiB) before this
// route's own 64 KB body cap ever applies, a DoS/cost vector against this
// server.
//
// Fix round 3 (live bug, D28): the first two fix rounds hand-maintained an
// ALLOWLIST of exact part types (text/step-start/tool-*) — twice, a real
// SDK-emitted type round-tripped through assistant history and 422'd (first
// TextUIPart's own `state`/`providerMetadata` fields under `.strict()`,
// then a whole missing type, `reasoning`, which Gemini emits and ai
// 7.0.155's UIMessagePart union always allowed: text, step-start, reasoning,
// custom, dynamic-tool, tool-*). Extracted to `@/lib/ai/ui-message-schema`
// (GU-08) so the student route reuses the same fixed boundary instead of
// risking this exact bug a fourth time, independently, in a second file.

const TeacherAgentRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    messages: z.array(UIMessageRequestSchema).min(1).max(50),
  })
  .passthrough();

// D29 — provider-agnostic wording: a single system prompt serves either
// cloud provider the request was routed to (pickAgentProvider), so it
// must stay accurate for both, not name one specifically.
const SYSTEM_PROMPT =
  "You are an AI assistant for teachers at this school, running on a cloud AI provider — " +
  "not the school's local AI. Everything the teacher types, plus anything you look up (students, " +
  "curriculum units, attendance patterns, exam results), is sent to that provider. " +
  "You can look up a student by name or admission number, find a curriculum unit you teach, check a " +
  "student's attendance pattern this term, look up a student's exam results, list a student's published " +
  "assignments (you cannot say whether they submitted one — that isn't tracked), and draft (never save) " +
  "a quiz or a report-card remark. " +
  "Every quiz or remark you produce is a DRAFT ONLY: say so plainly, and tell the teacher they must " +
  "review and save it themselves (Assignments for quizzes, the student's exam result for remarks) " +
  "before it has any effect. You never write marks, payments, access, or welfare decisions. " +
  "If a lookup fails or is out of your scope, say so plainly instead of guessing.";

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

// Same shape as the quiz/report-remark routes — `getTenantContext` throws
// Next.js control-flow signals for page rendering; this is a JSON/stream
// API, so they're mapped to the envelope instead of an HTML redirect/404.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
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

  const parsedRequest = TeacherAgentRequestSchema.safeParse(bodyResult.data);
  if (!parsedRequest.success) {
    const { fieldErrors } = parsedRequest.error.flatten();
    return json(fail("validation_failed", "Invalid input.", fieldErrors as Record<string, string[]>));
  }
  const input = parsedRequest.data;
  const provider = pickAgentProvider(latestUserText(input.messages));

  let ctx: TenantContext;
  try {
    ctx = await getTenantContext(input.institutionSlug);
  } catch (err) {
    const mapped = mapTenantContextError(err);
    if (mapped) return json(mapped);
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/agent/teacher failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "ai.generate");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  // D28 scopes this agent to the teacher role only — other roles holding
  // `ai.generate` (owner/principal/admin) don't have a tool set built yet.
  if (ctx.membership.role !== "teacher") {
    return json(fail("forbidden", "The AI assistant is not available for your role yet."));
  }

  // D30 — entitlement check: separate from the permission/role checks
  // above, which govern *who* inside the institution can use the feature.
  // This governs whether the institution's plan includes it at all.
  if (!isFeatureEnabled(ctx, "teacher_ai_agent")) {
    return json(fail("ai_unavailable", "The AI assistant is not included in this school's plan."));
  }

  const tools = await teacherTools(ctx);
  const uiMessages = input.messages as unknown as UIMessage[];
  const modelMessages = await convertToModelMessages(uiMessages);

  // M24-T3 — checkLimits → concurrency slot → model factory → streamText →
  // usage logging → slot release now live in the shared cloud-stream
  // module (byte-identical behavior); this route keeps only its own gates
  // and tool/message building above.
  const cloudResult = await streamCloudAgent({
    ctx,
    feature: FEATURE,
    provider,
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    abortSignal: request.signal,
    notConfiguredMessage: "The teacher assistant is not configured. Contact your administrator.",
  });
  if (!cloudResult.ok) {
    return json(fail(cloudResult.error.code, cloudResult.error.message));
  }

  return cloudResult.stream.toUIMessageStreamResponse({ onError: cloudStreamErrorText });
}
