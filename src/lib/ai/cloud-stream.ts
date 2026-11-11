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
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";
import type { ErrorCode } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { acquireConcurrencySlot, aiSettingsFor, checkLimits, logUsage, releaseConcurrencySlot } from "@/lib/ai/usage";
import { estimateCost } from "@/lib/ai/pricing";
import {
  agentModelId,
  classifyAiError,
  cloudModelWithFallback,
  configuredCloudKeys,
  cloudProviderPlan,
  streamErrorText,
  type CloudModel,
} from "@/lib/ai/provider-fallback";
import { RESULT_RESERVE_TOKENS, TOKEN_CEILING, ceilingFor, planToolBudget, type ToolBudgetHints } from "@/lib/ai/tool-budget";
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
  /** Tool budget hints (tool-budget.ts); omitted: every tool is one group and no text to match. */
  budget?: ToolBudgetHints;
}

export interface StreamExtras {
  /** Estimated first-step prompt tokens (chars/4) after the tool budget. */
  estimatedTokens: number;
  /** `onError` for `toUIMessageStreamResponse`: an envelope with a category message, never provider text. */
  errorText: (error: unknown) => string;
}

export type CloudAgentResult<TOOLS extends ToolSet> =
  | ({ ok: true; modelId: string; stream: ReturnType<typeof streamText<TOOLS>> } & StreamExtras)
  | { ok: false; error: { code: ErrorCode; message: string } };

export async function streamCloudAgent<TOOLS extends ToolSet>(
  input: CloudAgentInput<TOOLS>,
): Promise<CloudAgentResult<TOOLS>> {
  const { ctx, feature, system, tools, abortSignal, notConfiguredMessage } = input;
  const redactionsAt = (): number => (typeof input.redactions === "function" ? input.redactions() : input.redactions ?? 0);
  const agentRunId = input.agentRunId ?? null;
  const budgetAt = (ceiling: number) =>
    planToolBudget({ texts: [], ...input.budget, system, messages: input.messages, tools, ceiling });
  const keys = configuredCloudKeys();
  // Z.ai is budgeted to its own ceiling first; that size picks its one retry (Groq only when it fits).
  const zaiTokens = keys.zai ? budgetAt(TOKEN_CEILING.zai).estimatedTokens + RESULT_RESERVE_TOKENS : undefined;
  // Only providers with a key: the routing pick yields to the other when its key is missing.
  const providers = cloudProviderPlan({ mode: "cloud", preferred: input.provider, keys, requestTokens: zaiTokens });
  const provider = providers?.primary ?? input.provider;
  const fallback = providers?.fallback ?? null;
  const last = providers?.last ?? null;
  const modelId = agentModelId(provider);

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
  let cloud: CloudModel;
  try {
    if (!providers) throw new Error("no cloud provider key configured");
    cloud = await cloudModelWithFallback(provider, fallback, last);
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

  // Budget against the smaller of the two ceilings: a step may land on the fallback.
  const plan = budgetAt(ceilingFor(fallback ? [provider, fallback] : [provider]));
  const logContext = { feature, provider, fallback, estimatedTokens: plan.estimatedTokens };
  console.info("[ai-budget]", { ...logContext, tools: plan.activeTools.length, groups: plan.groups.slice(0, 6) });
  const usedModel = () => cloud.modelsUsed().join("+");

  const stream = streamText({
    model: cloud.model,
    system,
    messages: plan.messages,
    tools: tolerateNullOptionals(plan.tools),
    activeTools: plan.activeTools,
    prepareStep: plan.prepareStep,
    // The SDK default logs the whole provider error, request body included.
    onError: ({ error }) => console.error("[ai-stream] provider error", { ...logContext, ...classifyAiError(error) }),
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
        model: usedModel(),
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        costEstimateUsd: estimateCost("cloud", usedModel(), usage.inputTokens ?? 0, usage.outputTokens ?? 0),
        ok: true,
        errorCode: null,
        redactions: redactionsAt(),
        agentRunId,
      }),
    )
    .catch((err: unknown) => {
      // Category only: the raw error carries the request body (prompt, tool results).
      const info = classifyAiError(err);
      console.error("[ai-stream] stream failed", { ...logContext, ...info });
      return logUsage({
        ctx,
        feature,
        provider: "cloud",
        model: usedModel(),
        inputTokens: accumulatedUsage.inputTokens,
        outputTokens: accumulatedUsage.outputTokens,
        latencyMs: Date.now() - startedAt,
        costEstimateUsd: estimateCost("cloud", usedModel(), accumulatedUsage.inputTokens, accumulatedUsage.outputTokens),
        ok: false,
        errorCode: info.kind === "busy" ? "rate_limited" : "ai_unavailable",
        redactions: redactionsAt(),
        agentRunId,
      });
    })
    .finally(() => releaseConcurrencySlot(concurrencyId, "cloud"));

  return {
    ok: true,
    modelId,
    stream,
    estimatedTokens: plan.estimatedTokens,
    errorText: (error: unknown) => streamErrorText(error),
  };
}
