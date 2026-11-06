import "server-only";
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, streamText, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import type { z } from "zod";
import { fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import type { Permission } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { resolvePlan, type AiPolicy, type ProviderStep } from "@/lib/ai/policy";
import { redact } from "@/lib/ai/redact";
import { estimateCost } from "@/lib/ai/pricing";
import { acquireConcurrencySlot, aiSettingsFor, checkLimits, logUsage, releaseConcurrencySlot } from "@/lib/ai/usage";
import * as providers from "@/lib/ai/providers";

// 06 §W10 — local 60s, cloud 30s.
const TIMEOUT_MS: Record<ProviderStep, number> = { local: 60_000, cloud: 30_000 };

export interface RunStructuredInput<T> {
  ctx: TenantContext;
  feature: string;
  schema: z.ZodType<T>;
  instructions: string;
  prompt: string;
  /** Names to redact from the prompt before any cloud call (07 §5). */
  denyNames?: readonly string[];
  maxOutputTokens?: number;
  /** Defaults to `ai.generate`; a student-facing caller passes `ai.study`. */
  permission?: Permission;
}

export interface RunStructuredOutput<T> {
  data: T;
  provider: ProviderStep;
  model: string;
  fallback: boolean;
}

function stepModelId(step: ProviderStep): string {
  return step === "local" ? providers.localModelId() : providers.cloudModelId("quality");
}

function isSchemaValidationError(err: unknown): boolean {
  return NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err);
}

function unavailableMessage(step: ProviderStep, aiPolicy: AiPolicy): string {
  return step === "local"
    ? `Local AI engine is not reachable (policy: ${aiPolicy}).`
    : `Cloud AI provider is not reachable (policy: ${aiPolicy}).`;
}

/**
 * 04 §5, 06 §W10/§W11 — the one path every feature uses to call a model.
 * Order: permission → policy plan → quota → rate → concurrency slot →
 * provider call (with one repair retry on invalid output) → usage log →
 * return. Never throws across the action boundary.
 */
export async function runStructured<T>(input: RunStructuredInput<T>): Promise<ActionResult<RunStructuredOutput<T>>> {
  const { ctx, feature, schema, instructions, prompt, denyNames, maxOutputTokens, permission = "ai.generate" } = input;

  if (!hasPermission(ctx, permission)) {
    return fail("forbidden", "You do not have permission to use AI features.");
  }

  const plan = resolvePlan({
    aiPolicy: ctx.institution.ai_policy,
    cloudEnabled: process.env.AI_CLOUD_ENABLED === "true",
    hasCloudKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });

  let limits: Awaited<ReturnType<typeof checkLimits>>;
  try {
    limits = await checkLimits(ctx, feature);
  } catch {
    return fail("dependency_failed", "AI usage limits could not be checked; please try again.");
  }
  if (!limits.ok) {
    await logUsage({
      ctx,
      feature,
      provider: plan[0],
      model: stepModelId(plan[0]),
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
    return fail(limits.code, message);
  }

  const settings = aiSettingsFor(ctx);
  let lastFailure: { code: ErrorCode; message: string } = {
    code: "ai_unavailable",
    message: unavailableMessage(plan[0], ctx.institution.ai_policy),
  };

  for (const step of plan) {
    const isFallback = step !== plan[0];
    const concurrencyLimit = step === "local" ? settings.max_concurrent_local : settings.max_concurrent_cloud;

    if (!acquireConcurrencySlot(ctx.institution.id, step, concurrencyLimit)) {
      lastFailure = { code: "rate_limited", message: "AI concurrency limit reached; please try again shortly." };
      continue;
    }

    const startedAt = Date.now();
    let redactions = 0;
    // Everything sent to a cloud provider is redacted: prompt, instructions,
    // and the repair note (which echoes model output).
    const forStep = (text: string): string => {
      if (step !== "cloud") return text;
      const redacted = redact(text, denyNames);
      redactions += redacted.count;
      return redacted.text;
    };

    try {
      const effectivePrompt = forStep(prompt);
      const effectiveInstructions = forStep(instructions);

      // Cloud provider module is imported here, inside this branch only (C-62).
      const model = step === "local" ? providers.getLocalModel() : await providers.getCloudModel("quality");
      const modelId = stepModelId(step);

      const attempt = (repairNote?: string) =>
        generateText({
          model,
          instructions: repairNote ? `${effectiveInstructions}\n\n${forStep(repairNote)}` : effectiveInstructions,
          prompt: effectivePrompt,
          output: Output.object({ schema }),
          timeout: TIMEOUT_MS[step],
          maxOutputTokens,
        });

      let result;
      try {
        result = await attempt();
      } catch (err) {
        if (!isSchemaValidationError(err)) throw err;
        const detail = err instanceof Error ? err.message : String(err);
        result = await attempt(
          `Your previous response was invalid: ${detail}. Return valid JSON that matches the schema exactly, with no extra text.`,
        );
      }

      const data = result.output;
      const latencyMs = Date.now() - startedAt;
      const costEstimateUsd = estimateCost(step, modelId, result.usage.inputTokens ?? 0, result.usage.outputTokens ?? 0);

      await logUsage({
        ctx,
        feature,
        provider: step,
        model: modelId,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs,
        costEstimateUsd,
        ok: true,
        errorCode: null,
        redactions,
      });

      return ok({ data, provider: step, model: modelId, fallback: isFallback });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const errorCode: ErrorCode = isSchemaValidationError(err) ? "ai_invalid_output" : "ai_unavailable";
      const message =
        errorCode === "ai_invalid_output"
          ? "AI returned output that did not match the expected schema after one repair attempt."
          : unavailableMessage(step, ctx.institution.ai_policy);

      await logUsage({
        ctx,
        feature,
        provider: step,
        model: stepModelId(step),
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        costEstimateUsd: 0,
        ok: false,
        errorCode,
        redactions,
      });

      lastFailure = { code: errorCode, message };
    } finally {
      releaseConcurrencySlot(ctx.institution.id, step);
    }
  }

  return fail(lastFailure.code, lastFailure.message);
}

// D31/D32/GU-05 — the streaming counterpart to `runStructured`, for a
// multi-turn tool-calling agent (not a one-shot structured object). Same
// gate order (permission → policy plan → quota → concurrency → provider),
// same usage-logging contract, same never-throws-across-the-boundary
// promise — but a stream, once started, is committed: unlike
// `runStructured`'s per-step retry ladder, there is no fallback to a
// second provider after the first token, because the caller has already
// started forwarding bytes to the client by then. Nothing calls this yet
// (GU-08, wave 2) — D31's teacher agent deliberately stays on its own D28
// route (plan §9: "not recommended now").
//
// Security review (2026-10-31) before the first caller lands: the cloud
// step is disabled unconditionally below (HIGH-2) — a multi-turn
// transcript's tool results are produced mid-stream, after this function
// has handed off, so there is no safe point left to redact them from, and
// `StreamAgentInput` has no `denyNames` yet either. Re-enable it only once
// a real cloud caller needs it, with `prepareStep` redaction over every
// message/tool-result and a `denyNames` input, not before.
export interface StreamAgentInput<TOOLS extends ToolSet> {
  ctx: TenantContext;
  feature: string;
  /** Caller-named, since a future caller may check a permission other than `ai.generate` (e.g. `ai.study`). */
  permission: Permission;
  /**
   * D32 — required, not optional (HIGH-1 fix: an omitted or mistyped
   * value must never silently fall through to the unrestricted "general"
   * path). `"student_personal"` may run only on a `local_only`
   * institution; there is no cloud path for it yet (free-tier terms
   * unsuitable for minors' data, no paid-tier decision made).
   */
  dataClass: "general" | "student_personal";
  system: string;
  messages: ModelMessage[];
  tools: TOOLS;
  stopWhen?: StopCondition<TOOLS> | StopCondition<TOOLS>[];
  maxOutputTokens?: number;
  toolCallConcurrency?: number;
  /** Required (MEDIUM-1 fix): without the request's own abort signal, a disconnected client's generation keeps running and holding a shared concurrency slot. */
  abortSignal: AbortSignal;
  /**
   * GU-08 security review (H1) — defaults to `ctx.institution.id`, same as
   * `runStructured`. A caller whose feature must not share the
   * institution's own concurrency pool (e.g. the student study chat,
   * which would otherwise compete with every teacher's local AI call for
   * the same two slots) passes its own composite key here — same trick
   * the teacher route already uses for its own bucket, just lifted into
   * this shared function instead of being re-invented per caller.
   */
  concurrencyKey?: string;
  /** M22-T4 — links usage rows to the agent run that caused them. */
  agentRunId?: string;
}

export type StreamAgentResult<TOOLS extends ToolSet> =
  | { ok: true; provider: ProviderStep; modelId: string; stream: ReturnType<typeof streamText<TOOLS>> }
  | { ok: false; error: { code: ErrorCode; message: string } };

// MEDIUM-1 fix: a caller-unspecified cap, same default order of magnitude
// as the teacher route's own `MAX_OUTPUT_TOKENS`, so a stream can't run
// unbounded just because a caller forgot to set one.
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

function streamAgentCorrelationId(): string {
  return crypto.randomUUID();
}

export async function streamAgent<TOOLS extends ToolSet>(
  input: StreamAgentInput<TOOLS>,
): Promise<StreamAgentResult<TOOLS>> {
  const { ctx, feature, permission, dataClass, system, messages, tools, stopWhen, toolCallConcurrency, abortSignal } = input;
  const maxOutputTokens = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const concurrencyKey = input.concurrencyKey ?? ctx.institution.id;
  const agentRunId = input.agentRunId ?? null;

  if (!hasPermission(ctx, permission)) {
    return { ok: false, error: { code: "forbidden", message: "You do not have permission to use AI features." } };
  }

  // D32 — checked before `resolvePlan` even runs: a cloud-policy
  // institution must never reach the cloud provider factory for this
  // data class, not merely be routed away from it. HIGH-1 fix: fails
  // closed on anything other than the literal "general" opt-out, not
  // just on the literal "student_personal" opt-in.
  if (dataClass !== "general" && ctx.institution.ai_policy !== "local_only") {
    return {
      ok: false,
      error: { code: "ai_policy_blocked", message: "This feature is only available on a local-only AI policy for now." },
    };
  }

  const plan = resolvePlan({
    aiPolicy: ctx.institution.ai_policy,
    cloudEnabled: process.env.AI_CLOUD_ENABLED === "true",
    hasCloudKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });

  let limits: Awaited<ReturnType<typeof checkLimits>>;
  try {
    limits = await checkLimits(ctx, feature);
  } catch {
    return { ok: false, error: { code: "dependency_failed", message: "AI usage limits could not be checked; please try again." } };
  }
  if (!limits.ok) {
    await logUsage({
      ctx,
      feature,
      provider: plan[0],
      model: stepModelId(plan[0]),
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costEstimateUsd: 0,
      ok: false,
      errorCode: limits.code,
      redactions: 0,
      agentRunId,
    });
    const message =
      limits.code === "quota_exceeded"
        ? "Daily AI usage quota exceeded for this institution."
        : "Too many AI requests; please slow down and try again.";
    return { ok: false, error: { code: limits.code, message } };
  }

  const settings = aiSettingsFor(ctx);

  for (const step of plan) {
    // HIGH-2 fix: the cloud step is categorically refused here, before a
    // concurrency slot is even acquired — see the function's own header
    // comment. This can empty a `["cloud"]`-only plan (`cloud_allowed`
    // with no local), which is the correct outcome (`ai_unavailable`),
    // not a silent drop to an unredacted call.
    if (step === "cloud") continue;

    const concurrencyLimit = settings.max_concurrent_local;
    if (!acquireConcurrencySlot(concurrencyKey, step, concurrencyLimit)) {
      continue; // try the next step in the plan, same as runStructured
    }

    const modelId = stepModelId(step);
    try {
      // Cloud provider module is never imported in this function today
      // (HIGH-2) — kept as a named step in `plan` only so a future,
      // reviewed cloud path can be re-enabled by removing the guard
      // above, not by restructuring this loop.
      const model = providers.getLocalModel();
      // `step` is always `"local"` here (the cloud guard above `continue`s
      // before this point) — no redaction needed; local data never
      // leaves the school's own server. Kept as its own variable, not a
      // hardcoded 0, so re-enabling the cloud step later is a matter of
      // restoring `redact(system)` on that branch, not rediscovering
      // that `redactions` was ever meant to reflect something real
      // (LOW-2: it was hardcoded 0 even while cloud redaction happened).
      const redacted = { text: system, count: 0 };

      const startedAt = Date.now();
      const accumulatedUsage = { inputTokens: 0, outputTokens: 0 };
      const stream = streamText({
        model,
        system: redacted.text,
        messages,
        tools,
        stopWhen,
        maxOutputTokens,
        toolCallConcurrency,
        abortSignal,
        timeout: TIMEOUT_MS[step],
        onError: ({ error }) => {
          const correlationId = streamAgentCorrelationId();
          console.error(`[${correlationId}] streamAgent (${feature}) step "${step}" failed`, error);
        },
        onStepFinish: (streamStep) => {
          accumulatedUsage.inputTokens += streamStep.usage.inputTokens ?? 0;
          accumulatedUsage.outputTokens += streamStep.usage.outputTokens ?? 0;
        },
      });

      Promise.resolve(stream.totalUsage)
        .then((usage) =>
          logUsage({
            ctx,
            feature,
            provider: step,
            model: modelId,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            latencyMs: Date.now() - startedAt,
            costEstimateUsd: estimateCost(step, modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
            ok: true,
            errorCode: null,
            redactions: redacted.count,
            agentRunId,
          }),
        )
        .catch(() =>
          logUsage({
            ctx,
            feature,
            provider: step,
            model: modelId,
            inputTokens: accumulatedUsage.inputTokens,
            outputTokens: accumulatedUsage.outputTokens,
            latencyMs: Date.now() - startedAt,
            costEstimateUsd: estimateCost(step, modelId, accumulatedUsage.inputTokens, accumulatedUsage.outputTokens),
            ok: false,
            errorCode: "ai_unavailable",
            redactions: redacted.count,
            agentRunId,
          }),
        )
        .finally(() => releaseConcurrencySlot(concurrencyKey, step));

      return { ok: true, provider: step, modelId, stream };
    } catch {
      // Setup failed before any token streamed (e.g. provider not
      // configured) — safe to try the next step, per this function's own
      // "fallback only before the first token" rule.
      releaseConcurrencySlot(concurrencyKey, step);
      continue;
    }
  }

  return {
    ok: false,
    error: { code: "ai_unavailable", message: unavailableMessage(plan[0], ctx.institution.ai_policy) },
  };
}
