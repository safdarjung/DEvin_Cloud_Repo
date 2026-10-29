import "server-only";
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import type { z } from "zod";
import { fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
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
  const { ctx, feature, schema, instructions, prompt, denyNames, maxOutputTokens } = input;

  if (!hasPermission(ctx, "ai.generate")) {
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
