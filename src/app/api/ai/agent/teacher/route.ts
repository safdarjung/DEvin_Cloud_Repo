import "server-only";
// T-0NN — teacher tool-calling chat agent route (D28: a parallel, Gemini-only
// path, deliberately out of band from runStructured/resolvePlan/gateway.ts's
// local/cloud institution policy — see 12-decision-log.md ADR D28 for the
// full rationale and the measured latency numbers behind that choice).
// Shares the quiz/report-remark routes' cross-site guard, body cap, and
// tenant-context/permission-error mapping; shares the gateway's own quota,
// concurrency, and usage-logging discipline (`checkLimits`,
// `acquireConcurrencySlot`/`releaseConcurrencySlot`, `logUsage`) without
// touching the gateway module itself.
import { NextResponse } from "next/server";
import { z } from "zod";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { AppError, fail, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { acquireConcurrencySlot, aiSettingsFor, checkLimits, logUsage, releaseConcurrencySlot } from "@/lib/ai/usage";
import { estimateCost } from "@/lib/ai/pricing";
import { geminiModelId, getGeminiModel } from "@/lib/ai/providers";
import { teacherTools } from "@/modules/ai/agent/teacher-tools";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEATURE = "teacher_agent";

// Matches the quiz/remark routes' own output cap, scaled down: this agent's
// replies are short chat turns, not multi-question quiz content.
const MAX_OUTPUT_TOKENS = 1024;

// Chat bodies carry the running message history (unlike the quiz/remark
// routes' single-shot ~8 KB payloads), so this is a larger cap than
// theirs — still bounded, never unbounded.
const MAX_BODY_BYTES = 64 * 1024;

// Fix round 1 (security review, HIGH): a loose `z.record(unknown)` part
// schema let a client smuggle in a `file` part with an arbitrary https
// URL — the AI SDK downloads it server-side (cap ~2 GiB) before this
// route's own 64 KB body cap ever applies, a DoS/cost vector against this
// server. Only the part shapes this agent actually produces/consumes are
// allowed; everything else (file, data-*, reasoning, source-url, ...) is
// rejected outright.
const TOOL_NAMES = ["findStudent", "findCurriculumUnit", "getAttendancePattern", "generateQuiz", "draftResultRemark"] as const;

const UIMessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(4000) }).strict(),
  z.object({ type: z.literal("step-start") }).strict(),
  ...TOOL_NAMES.map((name) => z.object({ type: z.literal(`tool-${name}` as const) }).passthrough()),
]);
const UIMessageRequestSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(UIMessagePartSchema).min(1).max(50),
  })
  .passthrough();

const TeacherAgentRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    messages: z.array(UIMessageRequestSchema).min(1).max(50),
  })
  .passthrough();

const SYSTEM_PROMPT =
  "You are an AI assistant for teachers at this school, running on Google Gemini (cloud) — " +
  "not the school's local AI. Everything the teacher types, plus anything you look up (students, " +
  "curriculum units, attendance patterns, exam results), is sent to Google. " +
  "You can look up a student by name or admission number, find a curriculum unit you teach, check a " +
  "student's attendance pattern this term, and draft (never save) a quiz or a report-card remark. " +
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

  let limits: Awaited<ReturnType<typeof checkLimits>>;
  try {
    limits = await checkLimits(ctx, FEATURE);
  } catch {
    return json(fail("dependency_failed", "AI usage limits could not be checked; please try again."));
  }
  if (!limits.ok) {
    await logUsage({
      ctx,
      feature: FEATURE,
      provider: "cloud",
      model: geminiModelId(),
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costEstimateUsd: 0,
      ok: false,
      errorCode: limits.code,
      redactions: 0,
    });
    const message =
      limits.code === "quota_exceeded"
        ? "Daily AI usage quota exceeded for this institution."
        : "Too many AI requests; please slow down and try again.";
    return json(fail(limits.code, message));
  }

  // Fix round 1 (security review, LOW-2): a distinct key per institution so
  // this Gemini agent's concurrency never shares a slot with the Anthropic
  // gateway's own `cloud` features — `acquireConcurrencySlot`'s key is
  // `${institutionId}:${step}`, so baking the extra segment into the id
  // argument (rather than widening `ProviderStep`, which belongs to
  // gateway.ts's policy types this packet must not touch) gets a separate
  // bucket for free.
  const concurrencyId = `${ctx.institution.id}:gemini`;

  const settings = aiSettingsFor(ctx);
  if (!acquireConcurrencySlot(concurrencyId, "cloud", settings.max_concurrent_cloud)) {
    return json(fail("rate_limited", "AI concurrency limit reached; please try again shortly."));
  }

  const startedAt = Date.now();
  let model;
  try {
    model = await getGeminiModel();
  } catch {
    releaseConcurrencySlot(concurrencyId, "cloud");
    await logUsage({
      ctx,
      feature: FEATURE,
      provider: "cloud",
      model: geminiModelId(),
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      costEstimateUsd: 0,
      ok: false,
      errorCode: "ai_unavailable",
      redactions: 0,
    });
    return json(fail("ai_unavailable", "The teacher assistant is not configured. Contact your administrator."));
  }

  const tools = await teacherTools(ctx);
  const uiMessages = input.messages as unknown as UIMessage[];
  const modelMessages = await convertToModelMessages(uiMessages);

  // Fix round 1 (security review, LOW-1): a mid-stream failure must not
  // lose the tokens already spent on completed steps from quota
  // accounting — accumulated here from `onStepFinish` and used as the
  // logged total in the `.catch` branch below, instead of hardcoded 0s.
  const accumulatedUsage = { inputTokens: 0, outputTokens: 0 };

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(6),
    // Fix round 1 (security review, MED): `stepCountIs(6)` bounds the
    // number of steps, not the cost of any one of them — Gemini defaults
    // to ~65k output tokens/step, and an unbounded step could fan out
    // many tool calls in parallel (e.g. "draft remarks for all 40
    // students" issuing 40 nested `runStructured` calls at once).
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    toolCallConcurrency: 1,
    abortSignal: request.signal,
    onStepFinish: (step) => {
      accumulatedUsage.inputTokens += step.usage.inputTokens ?? 0;
      accumulatedUsage.outputTokens += step.usage.outputTokens ?? 0;
    },
  });

  // Logged once per full turn from the stream's final usage, alongside the
  // response rather than before it — never blocks the stream. `totalUsage`
  // is only a `PromiseLike`, so it's wrapped in `Promise.resolve()` to get
  // `.catch`/`.finally`.
  Promise.resolve(result.totalUsage)
    .then((usage) =>
      logUsage({
        ctx,
        feature: FEATURE,
        provider: "cloud",
        model: geminiModelId(),
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        costEstimateUsd: estimateCost("cloud", geminiModelId(), usage.inputTokens ?? 0, usage.outputTokens ?? 0),
        ok: true,
        errorCode: null,
        redactions: 0,
      }),
    )
    .catch((err: unknown) => {
      const correlationId = crypto.randomUUID();
      console.error(`[${correlationId}] /api/ai/agent/teacher stream failed`, err);
      return logUsage({
        ctx,
        feature: FEATURE,
        provider: "cloud",
        model: geminiModelId(),
        inputTokens: accumulatedUsage.inputTokens,
        outputTokens: accumulatedUsage.outputTokens,
        latencyMs: Date.now() - startedAt,
        costEstimateUsd: estimateCost("cloud", geminiModelId(), accumulatedUsage.inputTokens, accumulatedUsage.outputTokens),
        ok: false,
        errorCode: "ai_unavailable",
        redactions: 0,
      });
    })
    .finally(() => releaseConcurrencySlot(concurrencyId, "cloud"));

  return result.toUIMessageStreamResponse();
}
