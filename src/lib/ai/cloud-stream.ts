import "server-only";
// M24-T3 — the D28/D29 cloud stream extracted from the teacher route
// (checkLimits → concurrency slot → model factory → streamText → usage
// logging → slot release), unchanged in behavior, so a second cloud agent
// (the M24 school-wide assistant, T6) shares it instead of re-copying it.
// The caller keeps its own gates (parse, role/feature checks, tool
// building, message conversion) — this module starts at `checkLimits`.
// T3a (ai-roles) — moved under `src/lib/ai/` so `gateway.ts`'s new
// `streamChat` can import it (rule 6: every model call goes through the
// gateway); existing callers (executor.ts, the 3 agent routes) just
// updated their import path, no behavior change.
import { tolerateNullOptionals } from "@/lib/ai/tool-nulls";
import { APICallError, stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { ErrorCode } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { acquireConcurrencySlot, aiSettingsFor, checkLimits, logUsage, releaseConcurrencySlot } from "@/lib/ai/usage";
import { estimateCost } from "@/lib/ai/pricing";
import { geminiModelId, getGeminiModel, getGroqModel, groqModelId } from "@/lib/ai/providers";
import type { AgentProvider } from "@/modules/ai/agent/provider-routing";

// Matches the quiz/remark routes' own output cap, scaled down: these
// agents' replies are short chat turns, not multi-question quiz content.
const MAX_OUTPUT_TOKENS = 1024;

export interface CloudAgentInput<TOOLS extends ToolSet> {
  ctx: TenantContext;
  feature: string;
  provider: AgentProvider;
  system: string;
  messages: ModelMessage[];
  tools: TOOLS;
  abortSignal: AbortSignal;
  /** A fixed count, or a thunk read at usage-log time (T3a: lets `streamChat`'s tool-result redaction, which happens during the stream, count toward the logged total). */
  redactions?: number | (() => number);
  notConfiguredMessage: string;
  /** Agent runs (M22): usage rows carry the run id so the run's cost is attributable. */
  agentRunId?: string;
}

export type CloudAgentResult<TOOLS extends ToolSet> =
  | { ok: true; modelId: string; stream: ReturnType<typeof streamText<TOOLS>> }
  | { ok: false; error: { code: ErrorCode; message: string } };

function resolveAgentModel(provider: AgentProvider): { modelId: string; getModel: () => Promise<LanguageModel> } {
  return provider === "groq"
    ? { modelId: groqModelId(), getModel: getGroqModel }
    : { modelId: geminiModelId(), getModel: getGeminiModel };
}

export async function streamCloudAgent<TOOLS extends ToolSet>(
  input: CloudAgentInput<TOOLS>,
): Promise<CloudAgentResult<TOOLS>> {
  const { ctx, feature, provider, system, messages, tools, abortSignal, notConfiguredMessage } = input;
  const redactionsAt = (): number => (typeof input.redactions === "function" ? input.redactions() : input.redactions ?? 0);
  const agentRunId = input.agentRunId ?? null;
  const { modelId, getModel } = resolveAgentModel(provider);

  let limits: Awaited<ReturnType<typeof checkLimits>>;
  try {
    limits = await checkLimits(ctx, feature);
  } catch {
    return {
      ok: false,
      error: { code: "dependency_failed", message: "AI usage limits could not be checked; please try again." },
    };
  }
  if (!limits.ok) {
    await logUsage({
      ctx,
      feature,
      provider: "cloud",
      model: modelId,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costEstimateUsd: 0,
      ok: false,
      errorCode: limits.code,
      redactions: redactionsAt(),
      agentRunId,
    });
    const message =
      limits.code === "quota_exceeded"
        ? "Daily AI usage quota exceeded for this institution."
        : "Too many AI requests; please slow down and try again.";
    return { ok: false, error: { code: limits.code, message } };
  }

  // Fix round 1 (security review, LOW-2, carried over from the teacher
  // route): a distinct key per institution+provider so this agent's
  // concurrency never shares a slot with the Anthropic gateway's own
  // `cloud` features — `acquireConcurrencySlot`'s key is
  // `${institutionId}:${step}`, so baking the provider into the id
  // argument (rather than widening `ProviderStep`, which belongs to
  // gateway.ts's policy types this module must not touch) gets a
  // separate bucket for free.
  const concurrencyId = `${ctx.institution.id}:${provider}`;

  const settings = aiSettingsFor(ctx);
  if (!acquireConcurrencySlot(concurrencyId, "cloud", settings.max_concurrent_cloud)) {
    return { ok: false, error: { code: "rate_limited", message: "AI concurrency limit reached; please try again shortly." } };
  }

  const startedAt = Date.now();
  let model: LanguageModel;
  try {
    model = await getModel();
  } catch {
    releaseConcurrencySlot(concurrencyId, "cloud");
    await logUsage({
      ctx,
      feature,
      provider: "cloud",
      model: modelId,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      costEstimateUsd: 0,
      ok: false,
      errorCode: "ai_unavailable",
      redactions: redactionsAt(),
      agentRunId,
    });
    return { ok: false, error: { code: "ai_unavailable", message: notConfiguredMessage } };
  }

  // Fix round 1 (security review, LOW-1, carried over): a mid-stream
  // failure must not lose the tokens already spent on completed steps
  // from quota accounting — accumulated here from `onStepFinish` and used
  // as the logged total in the `.catch` branch below, instead of 0s.
  const accumulatedUsage = { inputTokens: 0, outputTokens: 0 };

  const stream = streamText({
    model,
    system,
    messages,
    tools: tolerateNullOptionals(tools),
    stopWhen: stepCountIs(6),
    // Fix round 1 (security review, MED, carried over): `stepCountIs(6)`
    // bounds the number of steps, not the cost of any one of them —
    // Gemini defaults to ~65k output tokens/step, and an unbounded step
    // could fan out many tool calls in parallel.
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    toolCallConcurrency: 1,
    abortSignal,
    onStepFinish: (step) => {
      accumulatedUsage.inputTokens += step.usage.inputTokens ?? 0;
      accumulatedUsage.outputTokens += step.usage.outputTokens ?? 0;
    },
  });

  // Logged once per full turn from the stream's final usage, alongside the
  // response rather than before it — never blocks the stream. `totalUsage`
  // is only a `PromiseLike`, so it's wrapped in `Promise.resolve()` to get
  // `.catch`/`.finally`.
  Promise.resolve(stream.totalUsage)
    .then((usage) =>
      logUsage({
        ctx,
        feature,
        provider: "cloud",
        model: modelId,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        costEstimateUsd: estimateCost("cloud", modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
        ok: true,
        errorCode: null,
        redactions: redactionsAt(),
        agentRunId,
      }),
    )
    .catch((err: unknown) => {
      const correlationId = crypto.randomUUID();
      console.error(`[${correlationId}] streamCloudAgent stream failed (feature=${feature})`, err);
      return logUsage({
        ctx,
        feature,
        provider: "cloud",
        model: modelId,
        inputTokens: accumulatedUsage.inputTokens,
        outputTokens: accumulatedUsage.outputTokens,
        latencyMs: Date.now() - startedAt,
        costEstimateUsd: estimateCost("cloud", modelId, accumulatedUsage.inputTokens, accumulatedUsage.outputTokens),
        ok: false,
        errorCode: "ai_unavailable",
        redactions: redactionsAt(),
        agentRunId,
      });
    })
    .finally(() => releaseConcurrencySlot(concurrencyId, "cloud"));

  return { ok: true, modelId, stream };
}

/**
 * Stream `onError` for the cloud agent routes: the SDK default sends a bare "An error
 * occurred.". Returns a category only, never the provider's message (it can echo request data).
 */
export function cloudStreamErrorText(error: unknown): string {
  const cause = (error as { lastError?: unknown } | null)?.lastError ?? error; // RetryError wraps the last attempt
  const status = APICallError.isInstance(cause) ? cause.statusCode : undefined;
  console.error("[ai-stream] provider error", { name: cause instanceof Error ? cause.name : typeof cause, status });
  if (status === 401 || status === 403) return "The AI provider rejected the configured API key.";
  if (status === 404) return "The configured AI model was not found.";
  if (status === 429) return "The AI provider is rate-limiting requests; try again in a minute.";
  return "The AI provider could not answer right now; please try again.";
}
